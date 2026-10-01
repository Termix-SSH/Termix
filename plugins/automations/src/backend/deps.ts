import type { PluginServices } from "@termix/plugin-sdk/backend";
import type { DockerEventKind } from "../types.js";

/*
 * Other plugins, as automations reaches them. Every call runs as the current
 * actor (the automation's owner, set by the engine with ctx.asUser). A
 * missing provider answers an empty handle, so each method is probed before
 * it is called.
 */

export interface SnippetsAccessV1 {
  list?: () => Promise<Array<{ id: number; name: string; isNote?: boolean }>>;
  get: (id: number) => Promise<{
    id: number;
    name: string;
    content: string;
    isNote: boolean;
  } | null>;
  resolveCommand: (
    id: number,
    vars: { ip?: string; username?: string; port?: number; name?: string },
    inputValues?: Record<string, string>,
  ) => Promise<string | null>;
}

export interface FleetsAccessV1 {
  list: () => Promise<Array<{ id: number; name: string }>>;
  members: (
    fleetId: number,
  ) => Promise<Array<{ id: number; name: string | null; ip: string }>>;
}

export interface TunnelsAccessV1 {
  start: (name: string) => Promise<void>;
  stop: (name: string) => Promise<void>;
}

export interface DockerContainersV1 {
  action: (
    hostId: number,
    container: string,
    action: "start" | "stop" | "restart",
  ) => Promise<void>;
}

export interface DockerEvent {
  hostId: number;
  container: string;
  event: DockerEventKind;
}

export interface DockerEventsV1 {
  subscribe: (
    hostId: number,
    listener: (event: DockerEvent) => void,
  ) => Promise<() => void>;
}

export interface MetricsViewersV1 {
  register: (
    hostId: number,
  ) => Promise<{ viewerSessionId: string } | { skipped: true; reason: string }>;
  heartbeat: (viewerSessionId: string) => boolean;
  unregister: (hostId: number, viewerSessionId: string) => void;
}

/** Provided by the wake-on-lan plugin. It resolves the host's MAC itself. */
export interface WakeOnLanV1 {
  wake: (hostId: number) => Promise<void>;
}

/** The plugin id behind each service, for "needs <plugin>" messages. */
export const PROVIDERS = {
  snippets: "snippets.access",
  fleets: "fleets.access",
  tunnels: "tunnels.access",
  docker: "docker.containers",
  "docker-events": "docker.events",
  "host-metrics": "host-metrics.viewers",
  "wake-on-lan": "wake-on-lan.send",
} as const;

export type ProviderKey = keyof typeof PROVIDERS;

/** The plugin a provider key belongs to. */
export function pluginOf(key: ProviderKey): string {
  return key === "docker-events" ? "docker" : key;
}

export type Deps = ReturnType<typeof createDeps>;

export function createDeps(services: PluginServices) {
  function handle<T extends object>(name: string): Partial<T> {
    try {
      return services.get<T>(name) as Partial<T>;
    } catch {
      return {};
    }
  }

  return {
    /** Which providers are running now. */
    available(key: ProviderKey): boolean {
      return services.providers(PROVIDERS[key]).length > 0;
    },
    providers(): Record<ProviderKey, boolean> {
      const result = {} as Record<ProviderKey, boolean>;
      for (const key of Object.keys(PROVIDERS) as ProviderKey[]) {
        result[key] = services.providers(PROVIDERS[key]).length > 0;
      }
      return result;
    },
    snippets: () => handle<SnippetsAccessV1>(PROVIDERS.snippets),
    fleets: () => handle<FleetsAccessV1>(PROVIDERS.fleets),
    tunnels: () => handle<TunnelsAccessV1>(PROVIDERS.tunnels),
    docker: () => handle<DockerContainersV1>(PROVIDERS.docker),
    dockerEvents: () => handle<DockerEventsV1>(PROVIDERS["docker-events"]),
    viewers: () => handle<MetricsViewersV1>(PROVIDERS["host-metrics"]),
    wakeOnLan: () => handle<WakeOnLanV1>(PROVIDERS["wake-on-lan"]),
  };
}
