/**
 * createMockCtx({ sandbox: true }): the same fake ctx, with the rules a
 * plugin's own process puts on it (plugin API 2), so a test finds what would
 * break before the plugin runs in Termix:
 *
 *   - only plain data, functions, streams' chunks (Buffers), Dates, Maps,
 *     Sets, Errors and URLs may be passed to or returned from ctx; a class
 *     instance throws SANDBOX_VALUE;
 *   - schedules, event topics and registry keys must be listed in the
 *     manifest's sandbox block, else SANDBOX_UNDECLARED;
 *   - the methods core can't serve to a plugin process throw
 *     SANDBOX_UNSUPPORTED;
 *   - db.client() has no transaction(): use ctx.db.batch();
 *   - routes need string paths;
 *   - a login method may only set cookies named tmxp_<id>_*.
 */
import type { PluginContext } from "../backend.js";
import type { PluginManifest } from "../manifest.js";

const REFUSED: Record<string, string> = {
  "hosts.locks.provide": "core reads host locks synchronously",
  "hosts.status.provide": "core reads host status synchronously",
  "sync.provide": "the sync engine runs in process",
};
const REFUSED_PREFIXES: string[] = [];

export class SandboxRuleError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/** A Drizzle table crosses by name; core uses its own copy of it. */
function isDrizzleTable(value: object): boolean {
  return (
    (value as Record<symbol, unknown>)[Symbol.for("drizzle:IsDrizzleTable")] ===
      true ||
    typeof (value as Record<symbol, unknown>)[Symbol.for("drizzle:Name")] ===
      "string"
  );
}

function isAllowedInstance(value: object): boolean {
  return (
    isDrizzleTable(value) ||
    value instanceof Date ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    value instanceof Error ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof URL ||
    value instanceof RegExp
  );
}

/** Throws when a value could not cross between a plugin process and core. */
export function assertCrossable(
  value: unknown,
  where: string,
  depth = 0,
): void {
  if (depth > 32) {
    throw new SandboxRuleError(
      `${where} nests too deep to cross`,
      "SANDBOX_VALUE",
    );
  }
  if (value === null || typeof value !== "object") return;
  if (isAllowedInstance(value)) {
    if (value instanceof Map) {
      for (const [k, v] of value) {
        assertCrossable(k, where, depth + 1);
        assertCrossable(v, where, depth + 1);
      }
    }
    if (value instanceof Set) {
      for (const v of value) assertCrossable(v, where, depth + 1);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertCrossable(item, where, depth + 1);
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new SandboxRuleError(
      `${where}: a ${proto?.constructor?.name ?? "class"} value can't cross between a plugin process and core. Pass plain data.`,
      "SANDBOX_VALUE",
    );
  }
  for (const item of Object.values(value)) {
    if (typeof item !== "function") assertCrossable(item, where, depth + 1);
  }
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const ANSWERED_IN_PROCESS = new Set(["http.baseUrl", "currentActor"]);

const ASYNC_CHECKED = new Set(["ssh.prepare", "ssh.openTransport"]);

/** What of a result crosses: core sends a process's exit Promise its own way. */
function crossing(dotted: string, value: unknown): unknown {
  return dotted === "process.run" && isPlain(value)
    ? { ...value, exited: undefined }
    : value;
}

/** Results that are core objects in the fake (routers, clients) pass as they are. */
const PASS_THROUGH = new Set([
  "http.router",
  "rbac.require",
  "db.define",
  "db.client",
  "db.refs",
  "ssh.connect",
  "ssh.withConnection",
  "ssh.jumpChain",
  "ssh.prepare",
  "ssh.openTransport",
  "desktop.local.pluginFetch",
  "desktop.local.fs.openRead",
  "desktop.local.fs.openDownload",
  "desktop.local.pty.spawn",
  "fetch",
  "services.get",
  "registry.consume",
  "audit.exportBatches",
]);

function wrapDb(client: unknown): unknown {
  if (!client || typeof client !== "object") return client;
  return new Proxy(client as object, {
    get(target, property, receiver) {
      if (property === "transaction") {
        return () => {
          throw new SandboxRuleError(
            "db.transaction() is not available in a plugin process. Use ctx.db.batch() for writes that must land together.",
            "SANDBOX_UNSUPPORTED",
          );
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function wrapRouter(router: unknown): unknown {
  if (!router || typeof router !== "object") return router;
  return new Proxy(router as object, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (
        typeof value === "function" &&
        typeof property === "string" &&
        [
          "get",
          "post",
          "put",
          "patch",
          "delete",
          "all",
          "use",
          "head",
          "options",
        ].includes(property)
      ) {
        return (...args: unknown[]) => {
          if (args[0] instanceof RegExp) {
            throw new SandboxRuleError(
              "Routes in a plugin process need string paths, not regular expressions",
              "SANDBOX_UNSUPPORTED",
            );
          }
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  });
}

/** Cookies a plugin process may set and read start with this. */
export function cookiePrefix(pluginId: string): string {
  return `tmxp_${pluginId.replace(/[^A-Za-z0-9]/g, "_")}_`;
}

type Hook = (...args: unknown[]) => unknown;

/**
 * A login method whose hooks refuse cookies outside the plugin's own names,
 * the way core drops them for a plugin process.
 */
function ownCookiesOnly(
  method: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  const guard = (name: unknown) => {
    if (typeof name !== "string" || !name.startsWith(prefix)) {
      throw new SandboxRuleError(
        `A plugin process may only set cookies named ${prefix}*, got "${String(name)}"`,
        "SANDBOX_VALUE",
      );
    }
  };
  const out = { ...method };
  for (const key of ["start", "callback", "verify"]) {
    const hook = method[key];
    if (typeof hook !== "function") continue;
    out[key] = (request: Record<string, unknown>, ...rest: unknown[]) => {
      const res = request?.res as Record<string, Hook> | undefined;
      const wrapped = res
        ? {
            ...request,
            res: {
              ...res,
              cookie: (name: unknown, ...more: unknown[]) => {
                guard(name);
                return res.cookie?.call(res, name, ...more);
              },
              clearCookie: (name: unknown, ...more: unknown[]) => {
                guard(name);
                return res.clearCookie?.call(res, name, ...more);
              },
            },
          }
        : request;
      return (hook as Hook)(wrapped, ...rest);
    };
  }
  return out;
}

/**
 * The plugin's own ssh2 client, its socket and a stream it brought stay in
 * the plugin process; the rest of the options must cross.
 */
function checkOwnClientCall(dotted: string, args: unknown[]): void {
  const [host, second, third] = args;
  assertCrossable(host, `ctx.${dotted} argument 1`);
  if (dotted === "ssh.prepare") {
    const {
      client: _client,
      hostKeySocket: _socket,
      ...rest
    } = (isPlain(second) ? second : {}) as Record<string, unknown>;
    assertCrossable(withoutFunctions(rest), `ctx.${dotted} options`);
    return;
  }
  const config = (isPlain(second) ? second : {}) as Record<string, unknown>;
  if (typeof config.host !== "string" || !config.host) {
    throw new SandboxRuleError(
      "ctx.ssh.openTransport needs the config from ctx.ssh.prepare",
      "SANDBOX_VALUE",
    );
  }
  assertCrossable(
    withoutFunctions((isPlain(third) ? third : {}) as Record<string, unknown>),
    `ctx.${dotted} options`,
  );
}

function withoutFunctions(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "function") continue;
    out[key] = isPlain(item)
      ? withoutFunctions(item as Record<string, unknown>)
      : item;
  }
  return out;
}

/** The fake ctx with a plugin process's rules on top. */
export function sandboxContext<T extends PluginContext>(
  ctx: T,
  manifest: Partial<PluginManifest>,
): T {
  const sandbox = manifest.sandbox ?? {};
  const schedules = new Set((sandbox.schedules ?? []).map((s) => s.id));
  const events = new Set(sandbox.events ?? []);
  const registry = new Set(sandbox.registry ?? []);

  const check = (dotted: string, args: unknown[]) => {
    if (dotted === "audit.record" && isPlain(args[0])) {
      // The runtime sends only the address and agent of a request.
      const entry = args[0] as Record<string, unknown>;
      if (entry.request !== undefined) {
        const req = entry.request as {
          ip?: string;
          headers?: Record<string, unknown>;
        };
        args[0] = {
          ...entry,
          request: {
            ip: req?.ip,
            headers: { "user-agent": req?.headers?.["user-agent"] },
          },
        };
      }
    }
    const reason =
      (/\.(setCookie|clearCookie)$/.test(dotted)
        ? "needs the live HTTP response"
        : undefined) ??
      REFUSED[dotted] ??
      (REFUSED_PREFIXES.some((p) => dotted.startsWith(p))
        ? "not available to plugin processes yet"
        : null);
    if (reason) {
      throw new SandboxRuleError(
        `ctx.${dotted} is not available to sandboxed plugins: ${reason}`,
        "SANDBOX_UNSUPPORTED",
      );
    }
    if (dotted === "auth.registerLoginMethod" && isPlain(args[0])) {
      args[0] = ownCookiesOnly(
        args[0] as Record<string, unknown>,
        cookiePrefix(manifest.id ?? ""),
      );
    }
    if (dotted === "schedule.every") {
      const id = (args[2] as { id?: string } | undefined)?.id;
      if (!id || !schedules.has(id)) {
        throw new SandboxRuleError(
          `ctx.schedule.every needs an id listed in the manifest's sandbox.schedules (got "${id ?? ""}")`,
          "SANDBOX_UNDECLARED",
        );
      }
    }
    if (dotted === "events.on" && !events.has(String(args[0]))) {
      throw new SandboxRuleError(
        `ctx.events.on("${String(args[0])}") needs the topic listed in the manifest's sandbox.events`,
        "SANDBOX_UNDECLARED",
      );
    }
    if (dotted === "registry.provide" && !registry.has(String(args[0]))) {
      throw new SandboxRuleError(
        `ctx.registry.provide("${String(args[0])}") needs the key listed in the manifest's sandbox.registry`,
        "SANDBOX_UNDECLARED",
      );
    }
    // Answered inside the plugin process, so its arguments never cross.
    if (ANSWERED_IN_PROCESS.has(dotted)) return;
    if (dotted === "ssh.prepare" || dotted === "ssh.openTransport") {
      checkOwnClientCall(dotted, args);
      return;
    }
    args.forEach((arg, index) => {
      if (typeof arg !== "function") {
        assertCrossable(arg, `ctx.${dotted} argument ${index + 1}`);
      }
    });
  };

  const wrap = (
    source: Record<string, unknown>,
    prefix: string,
  ): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      const dotted = prefix ? `${prefix}.${key}` : key;
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor?.get) {
        // A getter stays lazy: the fake may throw until it is configured.
        Object.defineProperty(out, key, {
          enumerable: true,
          get: () => source[key],
        });
        continue;
      }
      const value = source[key];
      if (typeof value === "function") {
        out[key] = (...args: unknown[]) => {
          try {
            check(dotted, args);
          } catch (error) {
            // These are async in a plugin process, so the refusal rejects.
            if (ASYNC_CHECKED.has(dotted)) return Promise.reject(error);
            throw error;
          }
          const result = (value as (...a: unknown[]) => unknown).apply(
            source,
            args,
          );
          if (PASS_THROUGH.has(dotted)) {
            if (dotted === "db.client") {
              return Promise.resolve(result).then(wrapDb);
            }
            if (dotted === "http.router") return wrapRouter(result);
            return result;
          }
          if (
            result &&
            typeof (result as Promise<unknown>).then === "function"
          ) {
            return (result as Promise<unknown>).then((resolved) => {
              if (typeof resolved !== "function") {
                assertCrossable(
                  crossing(dotted, resolved),
                  `ctx.${dotted} result`,
                );
              }
              return resolved;
            });
          }
          if (typeof result !== "function") {
            assertCrossable(crossing(dotted, result), `ctx.${dotted} result`);
          }
          return result;
        };
      } else if (isPlain(value) && prefix.split(".").length < 4) {
        out[key] = wrap(value, dotted);
      } else {
        // Getters and plain values (pluginId, manifest, db.dialect).
        Object.defineProperty(out, key, {
          enumerable: true,
          get: () => source[key],
        });
      }
    }
    return out;
  };
  return wrap(ctx as unknown as Record<string, unknown>, "") as unknown as T;
}
