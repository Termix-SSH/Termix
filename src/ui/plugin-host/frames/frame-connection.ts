/**
 * The shell's end of every plugin frame.
 *
 * Frames all have the origin "null", so a message is matched to its frame by
 * the window that sent it, never by origin. A frame that says hello gets a
 * port; every call it makes is checked here before anything happens.
 */

import { toast } from "sonner";
import { authApi, getBackendUrl } from "@/main-axios";
import {
  PLUGIN_SETTINGS_CHANGED_EVENT,
  type PluginSummary,
} from "@/api/plugins-api";
import i18n from "@/i18n/i18n";
import {
  isFrameMessage,
  type FrameInit,
  type FrameRole,
  type WireComponent,
} from "@/plugin-frame/protocol";
import { FramePort } from "@/plugin-frame/rpc";
import { decodeIconValue } from "@/plugin-frame/frame-icons";
import { getPluginStoreState, knownPluginIds } from "../plugin-store";
import { shell, shellHost } from "../shell-bridge";
import { getTabType } from "@/shell/tab-registry";
import { toggleCompanion } from "@/shell/companions";
import { invokeAction } from "@/shell/action-registry";
import { runKeybindingAction } from "@/shell/keybinding-registry";
import { patchOpenTab } from "@/api/open-tabs-api";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import type { Tab } from "@/types/ui-types";
import {
  checkCoreRequest,
  frameHeaders,
  scopeCoreResponse,
} from "./frame-policy";
import {
  frameChangeFor,
  frameStateFor,
  getSharedState,
  hostsFor,
  onSharedStateChange,
} from "./frame-state";
import { frameToken } from "./frame-token";
import { readFrameStorage, writeFrameStorage } from "./frame-storage";
import { setUiPreferenceFromFrame } from "./frame-ui-preferences";

export interface FrameEvents {
  /** A view's current props, sent with its boot data. */
  getProps?: () => Record<string, unknown>;
  onEvent?: (name: string, data: unknown) => void;
  onReady?: () => void;
  onFailed?: (message: string) => void;
}

export interface FrameConnection {
  pluginId: string;
  role: FrameRole;
  key?: string;
  iframe: HTMLIFrameElement;
  port: FramePort | null;
  events: FrameEvents;
  /** Last time the user pressed a key or clicked in the frame. */
  lastInteraction: number;
  close: () => void;
}

const connections = new Set<FrameConnection>();
let listening = false;

function summaryOf(pluginId: string): PluginSummary | undefined {
  return getPluginStoreState().records.get(pluginId)?.summary;
}

function manifestUses(pluginId: string): string[] {
  const uses = (summaryOf(pluginId)?.contributes as { uses?: unknown } | null)
    ?.uses;
  return Array.isArray(uses) ? uses.filter((u) => typeof u === "string") : [];
}

/** Actions a frame may run: its own, and the ones its manifest says it uses. */
export function mayInvokeAction(pluginId: string, actionId: string): boolean {
  if (typeof actionId !== "string") return false;
  return (
    actionId.startsWith(`${pluginId}.`) ||
    manifestUses(pluginId).includes(actionId)
  );
}

/** A tab a plugin may close or patch: one of its own tab types. */
function ownsTabType(pluginId: string, type: unknown): boolean {
  return typeof type === "string" && getTabType(type)?.pluginId === pluginId;
}

/** The server root as a frame reaches it, like https://host/base. */
export function frameBaseUrl(): string {
  return new URL(getBackendUrl(""), window.location.href).href.replace(
    /\/+$/,
    "",
  );
}

/** Where a frame page loads from. */
export function frameUrl(
  pluginId: string,
  hash: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(hash)) {
    if (value !== undefined) params.set(name, value);
  }
  return `${frameBaseUrl()}/plugin-assets/${encodeURIComponent(pluginId)}/_frame/frame.html#${params.toString()}`;
}

function onMessage(event: MessageEvent) {
  if (!isFrameMessage(event.data)) return;
  for (const connection of connections) {
    if (event.source !== connection.iframe.contentWindow) continue;
    if (event.data.t === "hello") {
      // A frame that reloaded says hello again and gets a new port.
      if (
        event.data.role !== connection.role ||
        (connection.role === "view" && event.data.key !== connection.key)
      ) {
        return;
      }
      connection.port?.close();
      connection.port = createPort(connection, event.source as Window);
      return;
    }
    connection.port?.receive(event.data);
    return;
  }
}

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("message", onMessage);
}

/** Starts talking to a frame element once its page says hello. */
export function connectFrame(
  iframe: HTMLIFrameElement,
  pluginId: string,
  role: FrameRole,
  key: string | undefined,
  events: FrameEvents,
): FrameConnection {
  listen();
  let stopState: (() => void) | null = null;
  const connection: FrameConnection = {
    pluginId,
    role,
    key,
    iframe,
    port: null,
    events,
    lastInteraction: 0,
    close: () => {
      connections.delete(connection);
      stopState?.();
      connection.port?.close();
      connection.port = null;
    },
  };
  connections.add(connection);
  stopState = onSharedStateChange((changed) => {
    connection.port?.emit("state", frameChangeFor(pluginId, changed));
  });
  return connection;
}

/** Sends one event to every open frame of a plugin, or of every plugin. */
export function broadcastToFrames(
  name: string,
  data: unknown,
  pluginId?: string,
): void {
  for (const connection of connections) {
    if (pluginId && connection.pluginId !== pluginId) continue;
    connection.port?.emit(name, data);
  }
}

function createPort(connection: FrameConnection, target: Window): FramePort {
  return new FramePort({
    post: (message) => target.postMessage(message, "*"),
    onCall: (method, args) => handleCall(connection, method, args),
    onEvent: (name, data) => handleEvent(connection, name, data),
    fnPrefix: "s",
    icon: (ref) => decodeIconValue(ref),
    component: (ref: WireComponent) => ref,
  });
}

function recentlyUsed(connection: FrameConnection): boolean {
  return Date.now() - connection.lastInteraction < 5_000;
}

const MAX_TOASTS_PER_MINUTE = 20;
const toastTimes = new Map<string, number[]>();

function allowToast(pluginId: string): boolean {
  const now = Date.now();
  const times = (toastTimes.get(pluginId) ?? []).filter(
    (time) => now - time < 60_000,
  );
  if (times.length >= MAX_TOASTS_PER_MINUTE) return false;
  times.push(now);
  toastTimes.set(pluginId, times);
  return true;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function coreRequest(pluginId: string, request: unknown) {
  const input = (request ?? {}) as {
    method?: unknown;
    path?: unknown;
    headers?: unknown;
    body?: unknown;
  };
  const method = String(input.method ?? "GET").toUpperCase();
  const check = checkCoreRequest(pluginId, method, String(input.path ?? ""));
  if (!check.ok) {
    return {
      status: 403,
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(
        JSON.stringify({ error: "Not available to plugin views" }),
      ).buffer,
    };
  }
  const headers = frameHeaders(
    (input.headers ?? {}) as Record<string, unknown>,
  );
  const body =
    input.body instanceof ArrayBuffer && method !== "GET" && method !== "HEAD"
      ? input.body
      : undefined;
  const response = await authApi.request({
    method,
    url: `${check.path}${check.query}`,
    headers,
    data: body,
    responseType: "arraybuffer",
    validateStatus: () => true,
    transformRequest: [(data: unknown) => data],
  });
  let out = response.data as ArrayBuffer;
  const type = String(response.headers["content-type"] ?? "");
  if (type.includes("json") && out.byteLength > 0 && response.status < 300) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(out)) as unknown;
      out = new TextEncoder().encode(
        JSON.stringify(scopeCoreResponse(pluginId, check.path, parsed)),
      ).buffer as ArrayBuffer;
    } catch {
      // Not JSON after all; pass it on as it is.
    }
  }
  return {
    status: response.status,
    headers: type ? { "content-type": type } : {},
    body: out,
  };
}

/** The handle calls a companion may make, and what each needs. */
const HANDLE_METHODS: Record<string, "terminal-input" | null> = {
  focus: null,
  fit: null,
  refresh: null,
  notifyResize: null,
  reconnect: null,
  reconnectIfDisconnected: null,
  isConnected: null,
  sendInput: "terminal-input",
  paste: "terminal-input",
};

export function mayCallHandle(pluginId: string, method: unknown): boolean {
  if (typeof method !== "string" || !Object.hasOwn(HANDLE_METHODS, method)) {
    return false;
  }
  if (HANDLE_METHODS[method] !== "terminal-input") return true;
  const uses = manifestUses(pluginId);
  return (
    uses.includes("terminal.sendToActive") ||
    uses.includes("terminal.sendToSession")
  );
}

async function handleCall(
  connection: FrameConnection,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const { pluginId } = connection;
  switch (method) {
    case "init":
      return buildInit(connection);
    case "token":
      return frameToken(pluginId);
    case "http":
      return coreRequest(pluginId, args[0]);
    case "toast": {
      const [kind, message] = args;
      if (!allowToast(pluginId) || typeof message !== "string") return;
      const text = message.slice(0, 500);
      if (kind === "success") toast.success(text);
      else if (kind === "error") toast.error(text);
      else if (kind === "warning") toast.warning(text);
      else toast.info(text);
      return;
    }
    case "confirm": {
      const options = (args[0] ?? {}) as Record<string, unknown>;
      return shell.confirm!({
        title: String(options.title ?? "").slice(0, 300),
        description:
          typeof options.description === "string"
            ? options.description.slice(0, 2000)
            : undefined,
        confirmLabel:
          typeof options.confirmLabel === "string"
            ? options.confirmLabel.slice(0, 60)
            : undefined,
        cancelLabel:
          typeof options.cancelLabel === "string"
            ? options.cancelLabel.slice(0, 60)
            : undefined,
        destructive: options.destructive !== false,
      });
    }
    case "openUrl": {
      const [url] = args;
      if (!isHttpUrl(url)) throw new Error("Only web links can be opened");
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    case "download": {
      const [blob, name] = args;
      if (!(blob instanceof Blob)) throw new Error("Not a file");
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = String(name ?? "download").slice(0, 200);
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 30_000);
      return;
    }
    case "clipboard.write": {
      await navigator.clipboard.writeText(String(args[0] ?? ""));
      return;
    }
    case "clipboard.read": {
      // Only right after the user did something in the frame.
      if (!recentlyUsed(connection)) throw new Error("Not allowed now");
      return navigator.clipboard.readText();
    }
    case "tabs.openTab": {
      const [hostId, type, options] = args;
      if (typeof type !== "string") throw new Error("Bad tab type");
      const host = hostId == null ? null : (shellHost(String(hostId)) ?? null);
      shell.openTab(host, type, plainOptions(options));
      return;
    }
    case "tabs.openSingletonTab": {
      const [type, options] = args;
      if (typeof type !== "string") throw new Error("Bad tab type");
      shell.openSingletonTab(type, plainOptions(options));
      return;
    }
    case "tabs.connectHost": {
      const [hostId, type] = args;
      const host = shellHost(String(hostId));
      if (!host) throw new Error("No such host");
      shell.connectHost(host, typeof type === "string" ? type : undefined);
      return;
    }
    case "tabs.closeTab": {
      const [tabId] = args;
      if (typeof tabId !== "string") throw new Error("Bad tab");
      const record = findTab(tabId);
      if (!record || !ownsTabType(pluginId, record.type)) {
        throw new Error("A plugin can only close its own tabs");
      }
      shell.closeTab(tabId);
      return;
    }
    case "tabs.openRailView": {
      const [id] = args;
      if (typeof id !== "string") throw new Error("Bad view");
      shell.openRailView(id);
      return;
    }
    case "tabs.applyLayout": {
      const { tabsApi } = await import("../shell-bridge");
      const [layout, options] = args;
      return tabsApi.applyLayout(
        layout as { version: number },
        plainOptions(options) as { name?: string },
      );
    }
    case "tabs.patch": {
      const [instanceId, updates] = args;
      const record = findTab(String(instanceId));
      if (!record || !ownsTabType(pluginId, record.type)) {
        throw new Error("A plugin can only change its own tabs");
      }
      await patchOpenTab(String(instanceId), plainOptions(updates));
      return;
    }
    case "companion.toggle": {
      const [tab, id] = args;
      if (!tab || typeof tab !== "object") throw new Error("Bad tab");
      toggleCompanion(
        tab as Tab,
        typeof id === "string" ? `${pluginId}.${id}` : undefined,
      );
      return;
    }
    case "invokeAction": {
      const [id, ...rest] = args;
      if (!mayInvokeAction(pluginId, String(id))) {
        throw new Error(
          `${String(id)} is not one of this plugin's actions or in its manifest uses`,
        );
      }
      return invokeAction(String(id), ...rest);
    }
    case "hosts.list":
      return hostsFor(
        pluginId,
        (await getSSHHosts()) as unknown as Record<string, unknown>[],
      );
    case "hosts.changed":
      window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
      return;
    case "hostPassword":
      throw new Error("Saved passwords are not available to plugin views");
    case "keybinding.run": {
      const [action, context] = args;
      const type = (action as { type?: unknown } | null)?.type;
      const declared = (
        (
          summaryOf(pluginId)?.contributes as {
            keybindingActions?: { id?: string }[];
          } | null
        )?.keybindingActions ?? []
      ).some((entry) => entry?.id === type);
      if (!declared) throw new Error("Not this plugin's keybinding action");
      return runKeybindingAction(action as never, context as never);
    }
    case "uiPreferences.set": {
      const [name, value] = args;
      if (typeof name !== "string") throw new Error("Bad preference");
      setUiPreferenceFromFrame(pluginId, name, value);
      return;
    }
    default:
      throw new Error(`Unknown call ${method}`);
  }
}

function findTab(tabId: string): { type?: string } | undefined {
  return getSharedState().tabs.find(
    (tab) =>
      tab.id === tabId || (tab as { instanceId?: string }).instanceId === tabId,
  ) as { type?: string } | undefined;
}

/** Plain data only; anything else in an options object is dropped. */
function plainOptions(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function handleEvent(connection: FrameConnection, name: string, data: unknown) {
  switch (name) {
    case "storage": {
      const entry = data as { key?: unknown; value?: unknown } | null;
      if (typeof entry?.key !== "string") return;
      writeFrameStorage(
        connection.pluginId,
        entry.key,
        typeof entry.value === "string" ? entry.value : null,
      );
      return;
    }
    case "pointer":
    case "focus":
      connection.lastInteraction = Date.now();
      connection.events.onEvent?.(name, data);
      return;
    case "key":
      connection.lastInteraction = Date.now();
      forwardKey(data);
      return;
    case "ready":
      connection.events.onReady?.();
      return;
    case "settingsChanged": {
      const detail = (data ?? {}) as { scope?: unknown; hostId?: unknown };
      if (!["admin", "user", "host"].includes(String(detail.scope))) return;
      window.dispatchEvent(
        new CustomEvent(PLUGIN_SETTINGS_CHANGED_EVENT, {
          detail: {
            pluginId: connection.pluginId,
            scope: detail.scope,
            hostId:
              typeof detail.hostId === "number" ? detail.hostId : undefined,
          },
        }),
      );
      return;
    }
    case "failed":
      connection.events.onFailed?.(String(data ?? "failed"));
      return;
    default:
      connection.events.onEvent?.(name, data);
  }
}

/** Replays a key the frame left alone on the shell, for its shortcuts. */
function forwardKey(data: unknown) {
  const key = data as Record<string, unknown> | null;
  if (!key || typeof key.key !== "string") return;
  const event = new KeyboardEvent("keydown", {
    key: key.key,
    code: typeof key.code === "string" ? key.code : "",
    ctrlKey: key.ctrlKey === true,
    metaKey: key.metaKey === true,
    altKey: key.altKey === true,
    shiftKey: key.shiftKey === true,
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
}

async function buildInit(connection: FrameConnection): Promise<FrameInit> {
  const { pluginId } = connection;
  const summary = summaryOf(pluginId);
  if (!summary) throw new Error("Plugin is not running");
  return {
    pluginId,
    role: connection.role,
    key: connection.key,
    baseUrl: frameBaseUrl(),
    assetVersion: summary.assetVersion ?? null,
    css: !!summary.css,
    manifest: {
      id: summary.id,
      name: summary.name,
      version: summary.version,
      icon: summary.icon,
      docs: summary.docs,
      dependencies: summary.dependencies,
      optionalDependencies: summary.optionalDependencies,
      contributes: summary.contributes ?? undefined,
      capabilities: summary.capabilities ?? [],
    },
    token: await frameToken(pluginId),
    language: i18n.language || "en",
    locales: summary.locales ?? [],
    pluginIds: knownPluginIds(),
    state: frameStateFor(pluginId),
    storage: readFrameStorage(pluginId),
    guest: false,
    props: connection.events.getProps?.(),
  };
}

/** Test seam. */
export function resetFrameConnections(): void {
  for (const connection of [...connections]) connection.close();
  toastTimes.clear();
}
