/**
 * Wire format between a plugin worker and the main-thread broker.
 *
 * Everything crossing this boundary must be structured-cloneable. That is not
 * just a serialisation detail: it is the reason a plugin cannot be handed a db
 * handle, an ssh2 Client or a live socket by accident. Live objects stay in the
 * main thread and the worker refers to them by opaque handle strings.
 */

export interface PluginRequest {
  /** Correlates a reply to its request. Worker-generated, monotonic. */
  id: number;
  /** Dotted ctx path, e.g. "hosts.get" or "storage.set". */
  method: string;
  args: unknown[];
}

export interface PluginResponseOk {
  id: number;
  ok: true;
  value: unknown;
}

export interface PluginResponseErr {
  id: number;
  ok: false;
  error: { message: string; code?: string };
}

export type PluginResponse = PluginResponseOk | PluginResponseErr;

/** Main thread -> worker, pushed rather than requested. */
export interface PluginPush {
  kind: "event" | "http" | "timer";
  /** Event topic, route key, or timer id depending on kind. */
  key: string;
  payload: unknown;
  /** Set when the push expects a reply (an HTTP route invocation). */
  replyTo?: number;
}

/** First message the worker receives, before any plugin code runs. */
export interface PluginBootstrapData {
  pluginId: string;
  pluginDir: string;
  entryPath: string;
  manifest: unknown;
}

export function isPluginRequest(value: unknown): value is PluginRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "number" &&
    typeof v.method === "string" &&
    Array.isArray(v.args)
  );
}

export function isPluginResponse(value: unknown): value is PluginResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "number" && typeof v.ok === "boolean";
}
