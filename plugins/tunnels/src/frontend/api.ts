import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import type {
  C2STunnelPreset,
  TunnelConnectRequest,
  TunnelConnection,
  TunnelStatus,
} from "../shared/types";

export type TunnelStatusMap = Record<string, TunnelStatus>;

let client: PluginApiClient | null = null;
let remoteClient: PluginApiClient | null = null;
let openStream: ((init: RequestInit) => Promise<Response>) | null = null;

export interface TunnelsTransport {
  /** app.fetch for the status stream, which carries core's auth. */
  stream?: (init: RequestInit) => Promise<Response>;
  /** The connected remote server's client, on the desktop app. */
  remote?: PluginApiClient | null;
}

/** Set from activate with app.api, cleared on deactivate. */
export function setTunnelsApi(
  api: PluginApiClient | null,
  transport: TunnelsTransport = {},
): void {
  client = api;
  remoteClient = api ? (transport.remote ?? null) : null;
  openStream = api ? (transport.stream ?? null) : null;
}

function api(): PluginApiClient {
  if (!client) throw new Error("The tunnels plugin is not active");
  return client;
}

/**
 * The server's own reason for a failed call, or the fallback. The routes
 * always answer { error: string }.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { error?: unknown } } })
    ?.response?.data;
  if (typeof data?.error === "string" && data.error) return data.error;
  return fallback;
}

// Tunnel status is a process-local, in-memory view, so reading it is always
// safe. connectTunnel/disconnectTunnel/cancelTunnel always target the local
// embedded backend: they address a host by numeric id, and a synced host has
// a different numeric id in each database (only its syncId matches), so
// routing them to a remote backend would need a local-to-remote id lookup
// that does not exist yet.

export async function getTunnelStatuses(): Promise<TunnelStatusMap> {
  const response = await api().get<TunnelStatusMap>("/status");
  return response.data || {};
}

/**
 * Local statuses win a name collision with remote ones, since every control
 * targets the local backend.
 */
export function mergeTunnelStatuses(
  local: TunnelStatusMap,
  remote: TunnelStatusMap,
): TunnelStatusMap {
  return { ...remote, ...local };
}

export interface ServerSentEvent {
  event: string;
  data: string;
}

/** Splits a text/event-stream body into events. Returns what is left over. */
export function parseServerSentEvents(
  buffer: string,
  onEvent: (event: ServerSentEvent) => void,
): string {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length > 0) onEvent({ event, data: data.join("\n") });
  }
  return rest;
}

function streamUrl(): string | null {
  const base = (client as unknown as { defaults?: { baseURL?: string } })
    ?.defaults?.baseURL;
  if (base === undefined) return null;
  return `${base.replace(/\/$/, "")}/plugin-api/tunnels/status/stream`;
}

export interface SubscribeOptions {
  /** Replaces the default fetch, for tests. */
  fetchImpl?: typeof fetch;
  /** Statuses from a connected remote server, polled and merged in. */
  fetchRemote?: () => Promise<TunnelStatusMap>;
  pollIntervalMs?: number;
}

/**
 * Live tunnel statuses over the plugin's event stream, reconnecting after a
 * drop. Falls back to polling when the stream URL cannot be worked out.
 */
export function subscribeTunnelStatuses(
  onStatuses: (statuses: TunnelStatusMap) => void,
  onError?: () => void,
  options: SubscribeOptions = {},
): () => void {
  const controller = new AbortController();
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  let latestLocal: TunnelStatusMap = {};
  let latestRemote: TunnelStatusMap = {};
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const emit = () => onStatuses(mergeTunnelStatuses(latestLocal, latestRemote));

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        resolve();
      }, ms);
      timers.add(timer);
    });

  // A test hands in fetchImpl and a base URL; the app hands in app.fetch.
  const url = options.fetchImpl ? streamUrl() : null;
  const connect: ((init: RequestInit) => Promise<Response>) | null = url
    ? (init) => fetchImpl(url, { credentials: "include", ...init })
    : openStream;
  const fetchRemote =
    options.fetchRemote ??
    (remoteClient
      ? async () => {
          const response = await remoteClient!.get<TunnelStatusMap>("/status");
          return response.data || {};
        }
      : undefined);

  void (async () => {
    while (!controller.signal.aborted) {
      if (!connect) {
        try {
          latestLocal = await getTunnelStatuses();
          emit();
        } catch {
          onError?.();
        }
        await wait(pollIntervalMs);
        continue;
      }

      try {
        const response = await connect({
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error("stream failed");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer = parseServerSentEvents(
            buffer + decoder.decode(value, { stream: true }),
            (event) => {
              if (event.event !== "statuses") return;
              try {
                latestLocal = JSON.parse(event.data) as TunnelStatusMap;
                emit();
              } catch {
                onError?.();
              }
            },
          );
        }
        if (!controller.signal.aborted) onError?.();
      } catch {
        if (!controller.signal.aborted) onError?.();
      }
      if (!controller.signal.aborted) await wait(1000);
    }
  })();

  if (fetchRemote) {
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          latestRemote = await fetchRemote();
          emit();
        } catch {
          // A remote that is down just contributes nothing.
        }
        await wait(pollIntervalMs);
      }
    })();
  }

  return () => {
    controller.abort();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
}

export async function connectTunnel(
  request: TunnelConnectRequest,
): Promise<void> {
  await api().post("/connect", request);
}

export async function disconnectTunnel(tunnelName: string): Promise<void> {
  await api().post("/disconnect", { tunnelName });
}

export async function cancelTunnel(tunnelName: string): Promise<void> {
  await api().post("/cancel", { tunnelName });
}

export async function getC2STunnelPresets(): Promise<C2STunnelPreset[]> {
  const response = await api().get<C2STunnelPreset[]>("/presets");
  return response.data || [];
}

export async function createC2STunnelPreset(data: {
  name: string;
  config: TunnelConnection[];
  platform?: string;
  computerName?: string;
}): Promise<C2STunnelPreset> {
  const response = await api().post<C2STunnelPreset>("/presets", data);
  return response.data;
}

export async function updateC2STunnelPreset(
  id: number,
  data: Partial<{
    name: string;
    config: TunnelConnection[];
    platform: string;
    computerName: string;
  }>,
): Promise<C2STunnelPreset> {
  const response = await api().put<C2STunnelPreset>(`/presets/${id}`, data);
  return response.data;
}

export async function deleteC2STunnelPreset(id: number): Promise<void> {
  await api().delete(`/presets/${id}`);
}
