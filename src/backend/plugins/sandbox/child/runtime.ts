/**
 * The plugin process. Builds a ctx whose every method is a call to core,
 * imports the plugin and runs its activate.
 *
 * What stays here instead of crossing: the plugin's own Express router (core
 * forwards matched requests), its table objects (built from the same
 * definitions), currentActor() and the disposables bag. ssh2 clients,
 * sockets and the database stay in core and are reached through handles.
 */
// First, before anything a plugin could load: Electron ignores --import.
import "./harden.js";
import { AsyncLocalStorage } from "node:async_hooks";
import os from "node:os";
import { EventEmitter } from "node:events";
import http from "node:http";
import { PassThrough } from "node:stream";
import type ExpressDefault from "express";
import {
  Endpoint,
  processTransport,
  type StreamPort,
  type Transport,
  type Wire,
} from "../rpc.js";

interface Store {
  token?: string;
  userId?: string;
}

type AnyFn = (...args: unknown[]) => unknown;
type Dialect = "sqlite" | "postgres" | "mysql";

interface InitConfig {
  pluginId: string;
  entryUrl: string;
  functions: string[];
  refused: [string, string][];
  values: Record<string, unknown>;
  manifest: {
    id: string;
    sandbox?: {
      schedules?: { id: string }[];
      events?: string[];
      registry?: string[];
    };
  };
  dialect: Dialect;
}

const als = new AsyncLocalStorage<Store>();
// --expose-gc. The plugin can call it too, which only slows its own process.
const collect = (globalThis as { gc?: () => void }).gc;

let tableName: ((value: object) => string | undefined) | null = null;

let config: InitConfig;
let pluginModule: { activate?: AnyFn; deactivate?: AnyFn } = {};
const disposables: AnyFn[] = [];
const wsRoutes = new Map<string, AnyFn>();
const upgradeRoutes = new Map<string, AnyFn>();
let router: import("express").Router | null = null;
let app: import("express").Express | null = null;
const sshClients = new Map<string, EventEmitter>();
let expressModule: typeof ExpressDefault | null = null;

// Below core, so a busy plugin can't starve the server. A process may always
// lower its own priority.
try {
  os.setPriority(10);
} catch {
  // not fatal
}

process.on("unhandledRejection", (reason) => {
  const message =
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  console.error(`Unhandled rejection: ${message}`);
});

/** The fork channel, or a MessagePort Electron hands over first. */
function openTransport(): Promise<Transport> {
  const parentPort = (
    process as unknown as {
      parentPort?: {
        once(
          event: "message",
          fn: (event: { data: unknown; ports: unknown[] }) => void,
        ): void;
      };
    }
  ).parentPort;
  if (!parentPort) return Promise.resolve(processTransport(process));
  return new Promise((resolve) => {
    parentPort.once("message", (event) => {
      const port = event.ports?.[0] as {
        postMessage(m: unknown): void;
        on(e: "message", fn: (event: { data: unknown }) => void): void;
        start(): void;
      };
      resolve({
        send: (message) => port.postMessage(message),
        onMessage: (handler) => {
          port.on("message", (e) => handler(e.data as Wire));
          port.start();
        },
      });
    });
  });
}

const transport = await openTransport();

const endpoint = new Endpoint(transport, {
  side: "c",
  outboundToken: () => als.getStore()?.token,
  inbound: (token, run, userId) =>
    token === undefined ? run() : als.run({ token, userId }, run),
  // A Drizzle table crosses by name; core swaps in its own copy.
  marshalHook: (value) => {
    const name = tableName?.(value);
    return name ? { $table: name.toLowerCase() } : undefined;
  },
});

/**
 * A call result that works both ways a plugin may use it: awaited for a
 * value, or called straight away when the real API returns a dispose
 * function synchronously.
 */
function hybrid(promise: Promise<unknown>, path: string): AnyFn {
  promise.catch((error) => {
    console.error(`ctx.${path} failed: ${(error as Error).message}`);
  });
  const fn = ((...args: unknown[]) =>
    promise.then((value) =>
      typeof value === "function" ? (value as AnyFn)(...args) : undefined,
    )) as AnyFn & { then: unknown; catch: unknown; finally: unknown };
  fn.then = promise.then.bind(promise);
  fn.catch = promise.catch.bind(promise);
  fn.finally = promise.finally.bind(promise);
  return fn;
}

function setPath(
  target: Record<string, unknown>,
  dotted: string,
  value: unknown,
) {
  const parts = dotted.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    node[part] ??= {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

/** Methods that hand back a function to stop or remove what they set up. */
const RETURNS_DISPOSER =
  /^(events\.on|settings\.onChange|settings\.onValidate|schedule\.(every|after)|.*\.provide|.*\.subscribe|operations\.register.*|hosts\.import\.registerImportNormalizer)$/;

function buildCtx(): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  for (const [dotted, value] of Object.entries(config.values)) {
    setPath(ctx, dotted, value);
  }
  for (const dotted of config.functions) {
    setPath(ctx, dotted, (...args: unknown[]) => {
      const call = endpoint.call(`ctx.${dotted}`, args);
      return RETURNS_DISPOSER.test(dotted) ? hybrid(call, dotted) : call;
    });
  }
  const has = (dotted: string) => config.functions.includes(dotted);
  for (const [dotted, reason] of config.refused ?? []) {
    setPath(ctx, dotted, () => {
      throw Object.assign(
        new Error(
          `ctx.${dotted} is not available to sandboxed plugins: ${reason}`,
        ),
        { code: "SANDBOX_UNSUPPORTED" },
      );
    });
  }

  // Same checks core makes, but thrown here at once, the way an in-process
  // ctx throws, so a mistake stops activate instead of only logging.
  const sandbox = config.manifest.sandbox ?? {};
  const undeclared = (what: string) =>
    Object.assign(new Error(what), { code: "SANDBOX_UNDECLARED" });
  const remote =
    (dotted: string) =>
    (...args: unknown[]) =>
      hybrid(endpoint.call(`ctx.${dotted}`, args), dotted);
  if (has("schedule.every")) {
    const schedules = new Set((sandbox.schedules ?? []).map((s) => s.id));
    const call = remote("schedule.every");
    setPath(
      ctx,
      "schedule.every",
      (ms: number, fn: AnyFn, options?: { id?: string }) => {
        if (!options?.id || !schedules.has(options.id)) {
          throw undeclared(
            `ctx.schedule.every needs an id listed in the manifest's sandbox.schedules (got "${options?.id ?? ""}")`,
          );
        }
        return call(ms, fn, options);
      },
    );
  }
  if (has("events.on")) {
    const topics = new Set(sandbox.events ?? []);
    const call = remote("events.on");
    setPath(ctx, "events.on", (topic: string, listener: AnyFn) => {
      if (!topics.has(topic)) {
        throw undeclared(
          `ctx.events.on("${topic}") needs the topic listed in the manifest's sandbox.events`,
        );
      }
      return call(topic, listener);
    });
  }
  if (has("registry.provide")) {
    const keys = new Set(sandbox.registry ?? []);
    const call = remote("registry.provide");
    setPath(ctx, "registry.provide", (key: string, value: unknown) => {
      if (!keys.has(key)) {
        throw undeclared(
          `ctx.registry.provide("${key}") needs the key listed in the manifest's sandbox.registry`,
        );
      }
      return call(key, value);
    });
  }

  if (has("process.run")) {
    setPath(ctx, "process.run", async (...args: unknown[]) => {
      const handle = (await endpoint.call("ctx.process.run", args)) as {
        pid?: number;
        onStdout: AnyFn;
        onStderr: AnyFn;
        kill: AnyFn;
        waitExit: () => Promise<unknown>;
      };
      const exited = handle.waitExit();
      // Same as core: a caller that never awaits exited sees no rejection.
      exited.catch(() => {});
      return {
        pid: handle.pid,
        onStdout: (listener: AnyFn) => void handle.onStdout(listener),
        onStderr: (listener: AnyFn) => void handle.onStderr(listener),
        kill: (signal?: string) => void handle.kill(signal),
        exited,
      };
    });
  }
  if (has("auth.registerSshAuthProvider")) {
    setPath(ctx, "auth.registerSshAuthProvider", sshAuthProvider);
  }
  if (has("auth.registerLoginMethod")) {
    setPath(ctx, "auth.registerLoginMethod", loginMethod);
  }
  if (has("auth.completeRedirectLogin")) {
    setPath(
      ctx,
      "auth.completeRedirectLogin",
      async (methodId: string, _req: unknown, res: unknown) => {
        await endpoint.call("ctx.auth.completeRedirectLogin", [methodId]);
        // Core answered on the live response; end this request quietly.
        (res as { termixHandOff?: () => void })?.termixHandOff?.();
      },
    );
  }

  // Answered here: core would only be asked who it is already acting as.
  setPath(ctx, "currentActor", () => als.getStore()?.userId || undefined);
  setPath(ctx, "disposables.add", (dispose: AnyFn) => {
    disposables.push(dispose);
    return () => {
      const index = disposables.indexOf(dispose);
      if (index >= 0) disposables.splice(index, 1);
    };
  });
  for (const level of ["debug", "info", "warn", "success"]) {
    setPath(ctx, `log.${level}`, (message: unknown) => {
      endpoint.notify("log", [level, String(message)]);
    });
  }
  setPath(ctx, "log.error", (message: unknown, error?: unknown) => {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    endpoint.notify("log", ["error", `${String(message)}${detail}`]);
  });

  if (has("http.router")) setPath(ctx, "http.router", makeRouter);
  setPath(
    ctx,
    "http.baseUrl",
    (req: { termixBaseUrl?: string }) => req?.termixBaseUrl ?? "",
  );
  if (has("ws.route")) {
    setPath(
      ctx,
      "ws.route",
      (routePath: string, handler: AnyFn, options?: unknown) => {
        wsRoutes.set(routePath, handler);
        endpoint.notify("ws.route", [routePath, options]);
      },
    );
  }
  if (has("ws.upgrade")) {
    setPath(
      ctx,
      "ws.upgrade",
      (routePath: string, handler: AnyFn, options?: unknown) => {
        upgradeRoutes.set(routePath, handler);
        endpoint.notify("ws.upgrade", [routePath, options]);
      },
    );
  }
  if (has("rbac.require")) setPath(ctx, "rbac.require", rbacMiddleware);

  if (has("db.define")) {
    setPath(ctx, "db.define", async (definition: { name: string }) => {
      await endpoint.call("db.define", [definition]);
      const { buildTable } =
        await import("@termix-ssh/plugin-sdk/table-builder");
      return buildTable(config.pluginId, definition as never);
    });
  }
  if (has("db.client")) setPath(ctx, "db.client", dbClient);
  if (has("db.refs")) setPath(ctx, "db.refs", dbRefs);
  setPath(ctx, "db.batch", dbBatch);

  if (has("ssh.connect")) {
    setPath(ctx, "ssh.connect", async (host: unknown, options?: unknown) => {
      const result = (await endpoint.call("ssh.connect", [host, options])) as {
        client: { $ssh: string };
        host: unknown;
        dispose: AnyFn;
      };
      return {
        client: sshClient(result.client.$ssh),
        jumpClient: null,
        host: result.host,
        dispose: () => void result.dispose(),
      };
    });
  }
  if (has("ssh.withConnection")) {
    setPath(
      ctx,
      "ssh.withConnection",
      (host: unknown, options: unknown, fn: AnyFn) =>
        endpoint.call("ssh.withConnection", [
          host,
          options,
          (ref: { $ssh: string }) => fn(sshClient(ref.$ssh)),
        ]),
    );
  }
  // Pure, so it never needs core.
  setPath(
    ctx,
    "ssh.autoResponses",
    (prompts: { prompt: string }[], password?: string) =>
      prompts.map((p) =>
        /password/i.test(p.prompt) && password ? password : "",
      ),
  );
  if (has("fetch")) {
    setPath(ctx, "fetch", async (url: string, init?: unknown) => {
      const r = (await endpoint.call("ctx.fetch", [url, init])) as {
        status: number;
        statusText: string;
        headers: Record<string, string>;
        body: Uint8Array;
      };
      const nullBody = [101, 204, 205, 304].includes(r.status);
      return new Response(nullBody ? null : r.body, {
        status: r.status,
        statusText: r.statusText,
        headers: r.headers,
      });
    });
  }
  if (has("audit.record")) {
    setPath(ctx, "audit.record", (entry: Record<string, unknown>) =>
      endpoint.call("ctx.audit.record", [
        { ...entry, request: requestMeta(entry?.request) },
      ]),
    );
  }
  if (has("services.get")) {
    setPath(ctx, "services.get", async (service: string, options?: unknown) =>
      serviceProxy(
        (
          (await endpoint.call("services.get", [service, options ?? {}])) as {
            $svc: string;
          }
        ).$svc,
      ),
    );
  }
  if (has("audit.exportBatches")) {
    setPath(ctx, "audit.exportBatches", async function* (filters?: unknown) {
      const id = await endpoint.call("audit.exportBatches.open", [
        filters ?? {},
      ]);
      try {
        for (;;) {
          const next = (await endpoint.call("audit.exportBatches.next", [
            id,
          ])) as {
            done: boolean;
            value: unknown;
          };
          if (next.done) return;
          yield next.value;
        }
      } finally {
        await endpoint.call("audit.exportBatches.close", [id]).catch(() => {});
      }
    });
  }
  return ctx;
}

/** Config values prepare may hand back: plain values and the certificate. */
function returnedConfig(config: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      Buffer.isBuffer(value)
    ) {
      out[key] = value;
    }
  }
  const cert = config.termixCertificate;
  if (cert && typeof cert === "object") out.termixCertificate = { ...cert };
  return out;
}

/**
 * The ssh2 client stays in core, so prepare gets a stand-in client and its
 * config changes go back as data. SDK applyCertificateAuth knows the
 * stand-in and puts the certificate on the config for core.
 */
function sshAuthProvider(provider: Record<string, unknown>): Promise<void> {
  const wrapped: Record<string, unknown> = { ...provider };
  const prepare = provider.prepare;
  if (typeof prepare === "function") {
    wrapped.prepare = async (
      config: Record<string, unknown>,
      host: unknown,
      env: Record<string, unknown>,
    ) => {
      const own = { ...config };
      const outcome = await (prepare as AnyFn)(own, host, {
        ...env,
        client: { termixSandboxClient: true },
      });
      return { outcome, config: returnedConfig(own) };
    };
  }
  const start = provider.startInteraction;
  if (typeof start === "function") {
    wrapped.startInteraction = (request: Record<string, unknown>) => {
      const remote = (request.socket ?? {}) as {
        send?: AnyFn;
        onClose?: AnyFn;
      };
      const socket = {
        send: (data: unknown) => {
          void Promise.resolve(remote.send?.(String(data))).catch(() => {});
        },
        on: (event: string, listener: AnyFn) => {
          if (event !== "close") return;
          void Promise.resolve(remote.onClose?.(listener)).catch(() => {});
        },
      };
      return (start as AnyFn)({ ...request, socket });
    };
  }
  return (
    endpoint.call("ctx.auth.registerSshAuthProvider", [
      wrapped,
    ]) as Promise<void>
  ).catch((error: unknown) => {
    endpoint.notify("log", [
      "error",
      `SSH auth type ${String(provider.type)} was not registered: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ]);
  });
}

interface CookieCall {
  name: string;
  value?: string;
  clear?: boolean;
  options?: Record<string, unknown>;
}

/** Cookie options as plain data; Domain is left out (core never sets it). */
function cookieOptions(options: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!options || typeof options !== "object") return out;
  for (const key of ["httpOnly", "secure", "sameSite", "path", "maxAge"]) {
    const value = (options as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * A login method's hook as core calls it: a plain request in, the answer
 * plus any cookies it set out. Errors come back as data so the cookies set
 * before them still apply.
 */
function loginHook(fn: AnyFn): AnyFn {
  return async (plain: Record<string, unknown>, ...rest: unknown[]) => {
    const cookies: CookieCall[] = [];
    const request = {
      ...plain,
      res: {
        cookie: (name: string, value: string, options?: unknown) => {
          cookies.push({
            name: String(name),
            value: String(value),
            options: cookieOptions(options),
          });
        },
        clearCookie: (name: string, options?: unknown) => {
          cookies.push({
            name: String(name),
            clear: true,
            options: cookieOptions(options),
          });
        },
      },
    };
    try {
      const value = await fn(request, ...rest);
      return { value, cookies };
    } catch (error) {
      const e = (error ?? {}) as Record<string, unknown>;
      return {
        error: {
          message: error instanceof Error ? error.message : String(error),
          status: e.status,
          code: e.code,
          returnTo: e.returnTo,
          remainingTime: e.remainingTime,
        },
        cookies,
      };
    }
  };
}

function loginMethod(method: Record<string, unknown>): Promise<void> {
  const wrapped: Record<string, unknown> = { ...method };
  for (const hook of ["start", "callback", "verify"]) {
    if (typeof method[hook] === "function") {
      wrapped[hook] = loginHook(method[hook] as AnyFn);
    }
  }
  return (
    endpoint.call("ctx.auth.registerLoginMethod", [wrapped]) as Promise<void>
  ).catch((error: unknown) => {
    endpoint.notify("log", [
      "error",
      `Login method ${String(method.id)} was not registered: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ]);
  });
}

/** What core reads from a request for an audit line: the address and agent. */
function requestMeta(request: unknown): Record<string, unknown> | undefined {
  if (!request || typeof request !== "object") return undefined;
  const req = request as {
    ip?: unknown;
    headers?: Record<string, unknown>;
    socket?: { remoteAddress?: unknown };
  };
  const agent = req.headers?.["user-agent"];
  const ip = typeof req.ip === "string" ? req.ip : req.socket?.remoteAddress;
  return {
    ip: typeof ip === "string" ? ip : undefined,
    headers: typeof agent === "string" ? { "user-agent": agent } : {},
  };
}

/** A service another plugin provides: each method is a call through core. */
function serviceProxy(id: string): Record<string, unknown> {
  return new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, property) {
      if (typeof property !== "string" || property === "then") return undefined;
      if (property === "asUser") {
        return async (userId: string) =>
          serviceProxy(
            (
              (await endpoint.call("services.asUser", [id, userId])) as {
                $svc: string;
              }
            ).$svc,
          );
      }
      return (...args: unknown[]) =>
        endpoint.call("services.call", [id, property, args]);
    },
    has: () => true,
  });
}

// ---- HTTP ----

const ROUTE_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "all",
  "use",
  "head",
  "options",
];

function makeRouter(options?: unknown): import("express").Router {
  if (router) throw new Error("ctx.http.router() was called twice");
  const express = expressModule!;
  const inner = express.Router();
  router = inner;
  endpoint.notify("http.router", [options ?? {}]);
  for (const method of ROUTE_METHODS) {
    const original = (inner as unknown as Record<string, AnyFn>)[method].bind(
      inner,
    );
    (inner as unknown as Record<string, AnyFn>)[method] = (
      ...args: unknown[]
    ) => {
      const first = args[0];
      const hasPath = typeof first === "string" || Array.isArray(first);
      if (first instanceof RegExp) {
        throw new Error("Sandboxed plugins register routes with string paths");
      }
      endpoint.notify("http.route", [method, hasPath ? first : undefined]);
      return original(...args);
    };
  }
  // router.route(path).get(...).post(...): each method is its own route in
  // core, so the route list and public path checks see the real methods.
  const originalRoute = inner.route.bind(inner);
  inner.route = ((routePath: string) => {
    const route = originalRoute(routePath) as unknown as Record<string, AnyFn>;
    for (const method of ROUTE_METHODS) {
      if (method === "use" || typeof route[method] !== "function") continue;
      const original = route[method].bind(route);
      route[method] = (...handlers: unknown[]) => {
        endpoint.notify("http.route", [method, routePath]);
        original(...handlers);
        return route;
      };
    }
    return route;
  }) as unknown as typeof inner.route;
  app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(inner);
  return inner;
}

function rbacMiddleware(permission: string): AnyFn {
  return (
    req: unknown,
    res: { status(c: number): { json(b: unknown): void } },
    next: AnyFn,
  ) => {
    endpoint
      .call("rbac.check", [permission])
      .then((outcome) => {
        const result = outcome as {
          next?: boolean;
          status?: number;
          body?: unknown;
        };
        if (result.next) next();
        else res.status(result.status ?? 403).json(result.body);
      })
      .catch((error) => next(error));
  };
}

interface RequestMeta {
  method: string;
  url: string;
  originalUrl: string;
  headers: Record<string, string>;
  body: unknown;
  ip: string;
  userId: string;
  baseUrl: string;
}

endpoint.handle("http.dispatch", ([metaArg, portArg, bodyArg]) => {
  const meta = metaArg as RequestMeta;
  const port = portArg as StreamPort;
  const bodyPort = bodyArg as StreamPort | undefined;
  if (!app) return { next: true };
  return new Promise((resolve, reject) => {
    const socket = new PassThrough() as PassThrough & {
      remoteAddress?: string;
    };
    socket.remoteAddress = meta.ip;
    const req = new http.IncomingMessage(
      socket as never,
    ) as http.IncomingMessage & Record<string, unknown>;
    req.method = meta.method;
    req.url = meta.url;
    req.headers = meta.headers;
    req.userId = meta.userId || undefined;
    req.termixBaseUrl = meta.baseUrl;
    if (bodyPort) {
      bodyPort.on("data", (chunk: Buffer) => {
        if (!req.push(chunk)) bodyPort.pause();
      });
      req._read = () => bodyPort.resume();
      bodyPort.on("end", () => req.push(null));
      bodyPort.on("error", (error) => req.destroy(error));
    } else {
      req.body = meta.body;
      req.push(null);
      req.complete = true;
    }

    const res = new http.ServerResponse(req) as unknown as http.ServerResponse &
      Record<string, unknown>;
    let headSent = false;
    const sendHead = () => {
      if (headSent) return;
      headSent = true;
      port.write({ h: { status: res.statusCode, headers: res.getHeaders() } });
      res._header = "sandbox";
    };
    res.writeHead = ((status: number, ...rest: unknown[]) => {
      res.statusCode = status;
      const headers = rest.find((r) => r && typeof r === "object") as
        Record<string, unknown> | undefined;
      for (const [key, value] of Object.entries(headers ?? {}))
        res.setHeader(key, value as string);
      sendHead();
      return res;
    }) as never;
    res.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
      sendHead();
      const buffer =
        typeof chunk === "string"
          ? Buffer.from(
              chunk,
              (typeof encoding === "string"
                ? encoding
                : "utf8") as BufferEncoding,
            )
          : Buffer.from(chunk as Uint8Array);
      const ok = port.write(buffer);
      const done = typeof encoding === "function" ? encoding : cb;
      if (typeof done === "function") (done as AnyFn)();
      return ok;
    }) as never;
    res.end = ((chunk?: unknown, encoding?: unknown, cb?: unknown) => {
      if (
        chunk !== undefined &&
        chunk !== null &&
        typeof chunk !== "function"
      ) {
        (res.write as AnyFn)(chunk, encoding);
      }
      sendHead();
      port.end();
      res.finished = true;
      const done = [chunk, encoding, cb].find((x) => typeof x === "function");
      if (done) (done as AnyFn)();
      res.emit("finish");
      resolve({ handled: true });
      return res;
    }) as never;
    res.termixHandOff = () => {
      if (res.finished) return;
      port.end();
      res.finished = true;
      res.emit("finish");
      resolve({ handled: true });
    };
    port.on("drain", () => res.emit("drain"));
    port.on("close", () => res.emit("close"));

    app!(req as never, res as never, (error?: unknown) => {
      if (error) reject(error);
      else resolve({ next: true });
    });
  });
});

// ---- WebSockets ----

const OPEN = 1;
const CLOSED = 3;

endpoint.handle("ws.open", ([routePath, metaArg, portArg]) => {
  const handler = wsRoutes.get(String(routePath));
  if (!handler) throw new Error(`No socket route ${routePath}`);
  const meta = metaArg as {
    userId: string;
    clientIp: string;
    requestOrigin: string;
    request: unknown;
    unlocked: boolean;
  };
  const port = portArg as StreamPort;
  const store = als.getStore();
  const socket = new EventEmitter() as EventEmitter & Record<string, unknown>;
  socket.OPEN = OPEN;
  socket.CLOSED = CLOSED;
  socket.readyState = OPEN;
  socket.bufferedAmount = 0;
  socket.send = (data: unknown, options?: unknown, cb?: unknown) => {
    if (socket.readyState !== OPEN) return;
    const binary = typeof data !== "string";
    port.write({
      d: binary ? Buffer.from(data as Uint8Array) : data,
      b: binary,
    });
    const done = typeof options === "function" ? options : cb;
    if (typeof done === "function") (done as AnyFn)();
  };
  socket.close = (code?: number, reason?: string) => {
    if (socket.readyState !== OPEN) return;
    socket.readyState = 2;
    port.endMeta = { code, reason };
    port.end();
  };
  socket.terminate = () => (socket.close as AnyFn)(1006);
  socket.ping = () => {};
  socket.pause = () => port.pause();
  socket.resume = () => port.resume();
  port.on("data", (chunk: { d: Buffer | string; b: boolean }) => {
    const data = typeof chunk.d === "string" ? Buffer.from(chunk.d) : chunk.d;
    als.run(store ?? {}, () => socket.emit("message", data, chunk.b));
  });
  port.on(
    "remote-end",
    (end: { code?: number; reason?: string } | undefined) => {
      socket.readyState = CLOSED;
      als.run(store ?? {}, () =>
        socket.emit("close", end?.code ?? 1005, Buffer.from(end?.reason ?? "")),
      );
    },
  );
  port.on("error", (error) =>
    als.run(store ?? {}, () => socket.emit("error", error)),
  );
  return handler({
    userId: meta.userId,
    socket,
    request: meta.request,
    clientIp: meta.clientIp,
    requestOrigin: meta.requestOrigin,
    isDataUnlocked: () => meta.unlocked,
  });
});

endpoint.handle(
  "ws.upgrade",
  ([routePath, requestArg, portArg, headArg, userId]) => {
    const handler = upgradeRoutes.get(String(routePath));
    if (!handler) throw new Error(`No upgrade route ${routePath}`);
    const meta = requestArg as {
      method: string;
      url: string;
      headers: Record<string, string>;
      httpVersion: string;
    };
    const socket = portArg as StreamPort & Record<string, unknown>;
    // What libraries expect of a net.Socket and the port can't do.
    for (const name of [
      "setTimeout",
      "setNoDelay",
      "setKeepAlive",
      "ref",
      "unref",
    ]) {
      socket[name] ??= () => socket;
    }
    const request = new http.IncomingMessage(
      new PassThrough() as never,
    ) as http.IncomingMessage;
    request.method = meta.method;
    request.url = meta.url;
    request.headers = meta.headers;
    request.httpVersion = meta.httpVersion;
    request.push(null);
    handler(
      request,
      socket,
      Buffer.from(headArg as Uint8Array),
      String(userId ?? ""),
    );
    return true;
  },
);

// ---- Database ----

let drizzleClient: unknown = null;

type Query = (
  sql: string,
  params: unknown[],
  method: string,
) => Promise<{ rows: unknown }>;

const query: Query = (sql, params, method) =>
  endpoint.call("db.query", [sql, params, method]) as Promise<{
    rows: unknown;
  }>;

async function dbClient(): Promise<unknown> {
  if (drizzleClient) return drizzleClient;
  await endpoint.call("db.client", []);
  if (config.dialect === "postgres") {
    const { drizzle } = await import("drizzle-orm/pg-proxy");
    drizzleClient = drizzle(
      (sql, params, method) => query(sql, params, method) as never,
    );
  } else if (config.dialect === "mysql") {
    const { drizzle } = await import("drizzle-orm/mysql-proxy");
    drizzleClient = drizzle(
      (sql, params, method) => query(sql, params, method) as never,
    );
  } else {
    const { drizzle } = await import("drizzle-orm/sqlite-proxy");
    drizzleClient = drizzle(
      (sql, params, method) => query(sql, params, method) as never,
      async (batch) =>
        (await endpoint.call("db.batch", [
          batch.map((item) => ({
            sql: item.sql,
            params: item.params,
            method: item.method,
          })),
        ])) as never,
    );
  }
  return drizzleClient;
}

/** Runs write queries in one transaction. Each must have toSQL(). */
async function dbBatch(
  queries: { toSQL(): { sql: string; params: unknown[] } }[],
) {
  const statements = queries.map((q) => {
    const { sql, params } = q.toSQL();
    return { sql, params, method: "run" };
  });
  await endpoint.call("db.batch", [statements]);
}

async function dbRefs(): Promise<Record<string, unknown>> {
  const names = (await endpoint.call("db.refs", [])) as string[];
  // Core's own schema module: plain table objects, no database handle.
  const schema = (await import("../../../database/db/schema.js")) as Record<
    string,
    unknown
  >;
  const out: Record<string, unknown> = {};
  for (const name of names) out[name] = schema[name];
  return out;
}

// ---- SSH ----

function sshClient(id: string): EventEmitter {
  const existing = sshClients.get(id);
  if (existing) return existing;
  const client = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const channelCall = (
    kind: "ssh.exec" | "ssh.shell",
    args: unknown[],
    cb: AnyFn,
  ) => {
    endpoint
      .call(kind, [id, ...args])
      .then((value) => cb(undefined, sshChannel(value as never)))
      .catch((error) => cb(error));
  };
  client.exec = (command: string, optionsOrCb: unknown, maybeCb?: AnyFn) => {
    const cb = (
      typeof optionsOrCb === "function" ? optionsOrCb : maybeCb
    ) as AnyFn;
    const options = typeof optionsOrCb === "function" ? {} : optionsOrCb;
    channelCall("ssh.exec", [command, options], cb);
    return true;
  };
  client.shell = (...args: unknown[]) => {
    const cb = args.pop() as AnyFn;
    const [window, options] = args;
    channelCall("ssh.shell", [window ?? {}, options ?? {}], cb);
    return true;
  };
  client.sftp = (cb: AnyFn) => {
    endpoint
      .call("ssh.sftp", [id])
      .then((value) =>
        cb(undefined, sftpProxy((value as { $sftp: string }).$sftp)),
      )
      .catch((error) => cb(error));
    return true;
  };
  client.end = () => {
    sshClients.delete(id);
    endpoint.notify("ssh.end", [id]);
  };
  sshClients.set(id, client);
  return client;
}

endpoint.handle("ssh.closed", ([id]) => {
  const client = sshClients.get(String(id));
  sshClients.delete(String(id));
  client?.emit("close");
  return true;
});

function sshChannel(value: {
  out: StreamPort;
  err: StreamPort;
  channel: string;
}) {
  const { out, err, channel } = value;
  const stream = out as StreamPort & Record<string, unknown>;
  stream.stderr = err;
  for (const method of ["setWindow", "signal"]) {
    stream[method] = (...args: unknown[]) =>
      endpoint.notify("ssh.channel", [channel, method, args]);
  }
  stream.close = () => endpoint.notify("ssh.channel", [channel, "close", []]);
  let exit: { code?: number | null; signal?: string } = {};
  out.on("remote-end", (meta: typeof exit | undefined) => {
    exit = meta ?? {};
    out.emit("exit", exit.code, exit.signal);
    // The remote side is done; finish our half so close fires.
    if (!out.writableEnded) out.end();
  });
  // ssh2 passes the exit code to close listeners.
  const emit = out.emit.bind(out);
  out.emit = ((event: string | symbol, ...args: unknown[]) =>
    event === "close" && args.length === 0
      ? emit("close", exit.code, exit.signal)
      : emit(event, ...args)) as typeof out.emit;
  return stream;
}

const SFTP_METHODS = [
  "stat",
  "lstat",
  "readFile",
  "writeFile",
  "rename",
  "mkdir",
  "unlink",
  "readdir",
  "rmdir",
  "realpath",
  "chmod",
  "chown",
  "utimes",
  "symlink",
  "readlink",
  "exists",
];

function sftpProxy(id: string) {
  const proxy: Record<string, AnyFn> = {};
  for (const method of SFTP_METHODS) {
    proxy[method] = (...args: unknown[]) => {
      const cb = (
        typeof args[args.length - 1] === "function" ? args.pop() : () => {}
      ) as AnyFn;
      endpoint
        .call("sftp.call", [id, method, args])
        .then((value) =>
          method === "exists" ? cb(value) : cb(undefined, withStats(value)),
        )
        .catch((error) => cb(error));
    };
  }
  proxy.createReadStream = (path: unknown) => {
    const out = new PassThrough();
    endpoint
      .call("sftp.read", [id, String(path)])
      .then((value) => {
        const port = value as StreamPort;
        port.pipe(out);
        port.on("error", (error) => out.destroy(error));
      })
      .catch((error) => out.destroy(error));
    return out;
  };
  proxy.createWriteStream = (path: unknown) => {
    const port = endpoint.openStream();
    const done = endpoint.call("sftp.write", [id, String(path), port]);
    done.then(
      () => port.emit("finish-remote"),
      (error) => port.destroy(error),
    );
    return port;
  };
  proxy.end = () => endpoint.notify("sftp.end", [id]);
  return proxy;
}

function withStats(value: unknown): unknown {
  if (!value || typeof value !== "object" || Buffer.isBuffer(value))
    return value;
  if (Array.isArray(value)) return value.map(withStats);
  const record = value as Record<string, unknown> & {
    $stats?: { dir: boolean; file: boolean; link: boolean };
  };
  if (record.$stats) {
    const { $stats: flags, ...rest } = record;
    return {
      ...rest,
      isDirectory: () => flags.dir,
      isFile: () => flags.file,
      isSymbolicLink: () => flags.link,
    };
  }
  if (record.attrs) return { ...record, attrs: withStats(record.attrs) };
  return value;
}

// ---- Lifecycle ----

endpoint.handle("init", async ([cfg]) => {
  config = cfg as InitConfig;
  expressModule = (await import("express")).default;
  // Narrow imports: the package root costs over 100 MB of parse garbage.
  const { is } = await import("drizzle-orm/entity");
  const { Table, getTableName } = await import("drizzle-orm/table");
  tableName = (value) =>
    is(value, Table) ? getTableName(value as never) : undefined;
  pluginModule = (await import(config.entryUrl)) as typeof pluginModule;
  const def = (pluginModule as { default?: typeof pluginModule }).default;
  if (!pluginModule.activate && def) pluginModule = def;
  return true;
});

endpoint.handle("activate", async () => {
  if (typeof pluginModule.activate !== "function") {
    throw new Error(
      `Plugin ${config.pluginId} backend entry does not export an activate(ctx) function`,
    );
  }
  await pluginModule.activate(buildCtx());
  // Drop the garbage left from loading modules so it is not held for good.
  collect?.();
  setTimeout(() => collect?.(), 1000).unref();
  return true;
});

endpoint.handle("deactivate", async () => {
  try {
    await pluginModule.deactivate?.();
  } finally {
    for (const dispose of disposables.splice(0).reverse()) {
      try {
        await dispose();
      } catch {
        // keep going
      }
    }
  }
  return true;
});

endpoint.handle("ping", () => ({
  cpu: process.cpuUsage(),
  rss: process.memoryUsage().rss,
  pending: endpoint.pendingCount,
}));

process.on("disconnect", () => process.exit(0));
