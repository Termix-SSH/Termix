/**
 * What a plugin frame may ask the shell to fetch from core for it. A frame
 * calls its own plugin's routes directly with its token; this list is the
 * only other way in: its own settings and the core reads the SDK hooks and
 * UI kit make. Everything else answers 403 and never reaches the server.
 *
 * Kept in step with the mobile app's bridge-policy.ts.
 */

type Method = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

interface Rule {
  methods: Method[];
  path: (pluginId: string) => RegExp;
}

const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const READ: Method[] = ["GET", "HEAD"];

const RULES: Rule[] = [
  {
    methods: ["GET", "PUT"],
    path: (id) =>
      new RegExp(`^/plugins/${esc(id)}/settings/(admin|user|host/\\d+)$`),
  },
  { methods: READ, path: () => /^\/users\/me$/ },
  // Your own sessions and keys. Revoking other people's stays out of frames.
  { methods: READ, path: () => /^\/users\/(sessions|api-keys\/mine)$/ },
  { methods: ["DELETE"], path: () => /^\/users\/api-keys\/mine\/[\w-]+$/ },
  { methods: ["POST"], path: () => /^\/users\/api-keys\/mine\/revoke-all$/ },
  { methods: READ, path: () => /^\/users\/admin-holds(\/settings)?$/ },
  { methods: READ, path: () => /^\/rbac\/permissions\/me$/ },
  { methods: READ, path: () => /^\/user-preferences$/ },
  { methods: READ, path: () => /^\/(health|version)$/ },
  { methods: READ, path: () => /^\/dashboard\/(uptime|activity\/recent)$/ },
  { methods: READ, path: () => /^\/host\/db\/host(\/\d+)?$/ },
  { methods: READ, path: () => /^\/host\/(folders|policy)$/ },
  { methods: READ, path: () => /^\/host\/status(\/\d+|\/settings)?$/ },
  { methods: READ, path: () => /^\/credentials$/ },
  // Actions go through the server's own gate. Deciding approvals stays out.
  {
    methods: READ,
    path: () =>
      /^\/operations\/(catalog|runs|events|timeline|signals|resources)(\/|$)/,
  },
  {
    methods: ["POST"],
    path: (id) => new RegExp(`^/operations/${esc(id)}\\.[a-z0-9.-]+/run$`),
  },
  { methods: ["POST"], path: () => /^\/dashboard\/activity\/log$/ },
];

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

/**
 * Host records leave the shell carrying only the asking plugin's settings,
 * the same as the SDK's host hooks give.
 */
export function scopeCoreResponse(
  pluginId: string,
  path: string,
  body: unknown,
): unknown {
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
