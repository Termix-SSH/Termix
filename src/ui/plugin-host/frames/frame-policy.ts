/**
 * What a plugin frame may ask the shell to fetch from core for it. A frame
 * calls its own plugin's routes directly with its token; this list is the
 * only other way in: its own settings and the core reads the SDK hooks and
 * UI kit make. Everything else answers 403 and never reaches the server.
 *
 * The list lives in frame-core-rules.json, which the mobile app copies.
 */

import RULE_FILE from "./frame-core-rules.json";

type Method = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

interface Rule {
  methods: Method[];
  path: (pluginId: string) => RegExp;
}

const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface CoreRuleEntry {
  methods: string[];
  path: string;
  why?: string;
}

/** The shared list, also read by the mobile app. */
export const CORE_RULES: CoreRuleEntry[] = RULE_FILE.rules;

const RULES: Rule[] = CORE_RULES.map((entry) => ({
  methods: entry.methods as Method[],
  path: (id) => new RegExp(entry.path.split("{id}").join(esc(id))),
}));

export type PolicyResult =
  { ok: true; path: string; query: string } | { ok: false; reason: string };

/** Checks a core request a frame asked for. `target` is path plus query. */
export function checkCoreRequest(
  pluginId: string,
  method: string,
  target: string,
): PolicyResult {
  if (typeof target !== "string" || !target.startsWith("/")) {
    return { ok: false, reason: "not a server path" };
  }
  const [path, ...rest] = target.split("?");
  const query = rest.length ? `?${rest.join("?")}` : "";
  // Encoded slashes and dots could step out of a prefix once decoded.
  if (/%2f|%5c|%2e/i.test(path) || path.includes("\\") || path.includes("//")) {
    return { ok: false, reason: "path" };
  }
  if (path.split("/").some((part) => part === "." || part === "..")) {
    return { ok: false, reason: "path" };
  }
  const verb = String(method).toUpperCase() as Method;
  const allowed = RULES.some(
    (rule) => rule.methods.includes(verb) && rule.path(pluginId).test(path),
  );
  return allowed
    ? { ok: true, path, query }
    : { ok: false, reason: `${verb} ${path}` };
}

/** Headers a frame may not set: the shell owns the login and the proxy. */
const OWNED =
  /^(authorization|cookie|host|origin|referer|user-agent|proxy-|cf-access-|x-termix-|x-electron-|x-admin-|sec-)/i;

export function frameHeaders(
  headers: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [name, value] of Object.entries(headers)) {
    if (!OWNED.test(name) && typeof value === "string") out[name] = value;
  }
  return out;
}

const HOST_LIST = /^\/host\/db\/host(\/\d+)?$/;

/** What a plugin may learn about installed plugins: no admin fields. */
const PLUGIN_FIELDS = [
  "id",
  "name",
  "version",
  "enabled",
  "state",
  "icon",
  "description",
  "docs",
  "contributes",
  "dependencies",
  "optionalDependencies",
  "frontend",
  "frontendIsolation",
] as const;

function scopePluginList(body: unknown): unknown {
  if (!Array.isArray(body)) return [];
  return body.map((entry) => {
    const plugin = (entry ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const field of PLUGIN_FIELDS) {
      if (plugin[field] !== undefined) out[field] = plugin[field];
    }
    return out;
  });
}

/**
 * Host records leave the shell carrying only the asking plugin's settings,
 * the same as the SDK's host hooks give. The plugin list leaves without the
 * admin fields.
 */
export function scopeCoreResponse(
  pluginId: string,
  path: string,
  body: unknown,
): unknown {
  if (path === "/plugins") return scopePluginList(body);
  if (!HOST_LIST.test(path)) return body;
  const scope = (host: unknown) => {
    if (!host || typeof host !== "object") return host;
    const record = { ...(host as Record<string, unknown>) };
    const settings = record.pluginSettings as
      Record<string, unknown> | undefined;
    record.pluginSettings =
      settings && settings[pluginId] ? { [pluginId]: settings[pluginId] } : {};
    return record;
  };
  return Array.isArray(body) ? body.map(scope) : scope(body);
}
