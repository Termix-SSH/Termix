/**
 * Sandbox spike: the plugin process. Builds a ctx whose every method is a
 * call to core, imports the plugin and runs its activate.
 *
 * What stays here instead of crossing: the plugin's own Express router (core
 * forwards matched requests), its table objects (built from the same
 * definitions), currentActor() and the disposables bag. ssh2 clients,
 * sockets and the database stay in core and are reached through handles.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import http from "node:http";
import { PassThrough } from "node:stream";
import type ExpressDefault from "express";
import { Endpoint, processTransport, type StreamPort } from "../rpc.js";

interface Store {
  token?: string;
  userId?: string;
}

type AnyFn = (...args: unknown[]) => unknown;

interface InitConfig {
  pluginId: string;
  entryUrl: string;
  functions: string[];
  values: Record<string, unknown>;
  manifest: { id: string };
}

const als = new AsyncLocalStorage<Store>();
// --expose-gc. The plugin can call it too, which only slows its own process.
const collect = (globalThis as { gc?: () => void }).gc;

let tableName: ((value: object) => string | undefined) | null = null;

const endpoint = new Endpoint(processTransport(process), {
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

let config: InitConfig;
let pluginModule: { activate?: AnyFn; deactivate?: AnyFn } = {};
const disposables: AnyFn[] = [];
const wsRoutes = new Map<string, AnyFn>();
let router: import("express").Router | null = null;
let app: import("express").Express | null = null;
const sshClients = new Map<string, EventEmitter>();

/**
 * A call result that works both ways a plugin may use it: awaited for a
 * value, or called straight away when the real API returns a dispose
 * function synchronously.
 */
function hybrid(promise: Promise<unknown>, path: string): AnyFn {
  promise.catch((error) => {
    process.emitWarning(`ctx.${path} failed: ${(error as Error).message}`);
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

function buildCtx(): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  for (const [dotted, value] of Object.entries(config.values)) {
    setPath(ctx, dotted, value);
  }
  for (const dotted of config.functions) {
    setPath(ctx, dotted, (...args: unknown[]) =>
      hybrid(endpoint.call(`ctx.${dotted}`, args), dotted),
    );
  }
  const has = (dotted: string) => config.functions.includes(dotted);

  // Answered here: core would only be asked who it is already acting as.
  if (has("currentActor"))
    setPath(ctx, "currentActor", () => als.getStore()?.userId || undefined);
  if (has("disposables.add")) {
    setPath(ctx, "disposables.add", (dispose: AnyFn) => {
      disposables.push(dispose);
      return () => {
        const index = disposables.indexOf(dispose);
        if (index >= 0) disposables.splice(index, 1);
      };
    });
  }
  for (const level of ["debug", "info", "warn", "error", "success"]) {
    const dotted = `log.${level}`;
    if (has(dotted)) {
      setPath(ctx, dotted, (...args: unknown[]) => {
        endpoint.notify(`ctx.${dotted}`, args);
      });
    }
  }

  if (has("http.router")) setPath(ctx, "http.router", makeRouter);
  if (has("http.baseUrl")) {
    setPath(
      ctx,
      "http.baseUrl",
      (req: { termixBaseUrl?: string }) => req?.termixBaseUrl ?? "",
    );
  }
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
  return ctx;
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
  // express is loaded at init so this can stay synchronous.
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
      const hasPath =
        typeof first === "string" ||
        first instanceof RegExp ||
        Array.isArray(first);
      endpoint.notify("http.route", [method, hasPath ? first : undefined]);
      return original(...args);
    };
  }
  const originalRoute = inner.route.bind(inner);
  inner.route = ((routePath: string) => {
    endpoint.notify("http.route", ["all", routePath]);
    return originalRoute(routePath);
  }) as typeof inner.route;
  app = express();
  app.disable("x-powered-by");
  app.use(inner);
  return inner;
}

let expressModule: typeof ExpressDefault | null = null;

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

endpoint.handle("http.dispatch", ([metaArg, portArg]) => {
  const meta = metaArg as RequestMeta;
  const port = portArg as StreamPort;
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
    req.body = meta.body;
    req.userId = meta.userId || undefined;
    req.termixBaseUrl = meta.baseUrl;
    req.push(null);
    req.complete = true;

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
      if (chunk !== undefined && typeof chunk !== "function") {
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
    isDataUnlocked: AnyFn;
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
  let unlocked = true;
  void Promise.resolve(meta.isDataUnlocked()).then(
    (v) => (unlocked = v !== false),
  );
  return handler({
    userId: meta.userId,
    socket,
    request: meta.request,
    clientIp: meta.clientIp,
    requestOrigin: meta.requestOrigin,
    isDataUnlocked: () => unlocked,
  });
});

// ---- Database ----

let drizzleClient: unknown = null;

async function dbClient(): Promise<unknown> {
  if (drizzleClient) return drizzleClient;
  await endpoint.call("db.client", []);
  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const query = (sql: string, params: unknown[], method: string) =>
    endpoint.call("db.query", [sql, params, method]) as Promise<{
      rows: unknown[];
    }>;
  drizzleClient = drizzle(query, async (batch) => {
    // Not atomic: each statement is its own call. Fine for the spike.
    const out = [];
    for (const item of batch)
      out.push(await query(item.sql, item.params, item.method));
    return out;
  });
  return drizzleClient;
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

function sftpProxy(id: string) {
  const methods = [
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
  ];
  const proxy: Record<string, AnyFn> = {};
  for (const method of methods) {
    proxy[method] = (...args: unknown[]) => {
      const cb = args.pop() as AnyFn;
      endpoint
        .call("sftp.call", [id, method, args])
        .then((value) => cb(undefined, withStats(value)))
        .catch((error) => cb(error));
    };
  }
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
    const flags = record.$stats;
    return {
      ...record,
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
    throw new Error("Plugin backend entry does not export activate(ctx)");
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

endpoint.handle("stats", () => ({
  rss: process.memoryUsage().rss,
  heapUsed: process.memoryUsage().heapUsed,
  pending: endpoint.pendingCount,
  functions: endpoint.functionCount,
}));

process.on("disconnect", () => process.exit(0));
