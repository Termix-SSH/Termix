/**
 * Sandbox spike: runs one plugin backend in its own Node process and serves
 * its ctx calls from the real PluginContext core built for it.
 *
 * Core keeps every check it has today (capabilities, RBAC, audit, the actor),
 * because each call lands on the same ctx object an in-process plugin gets.
 * What changes is what the plugin can reach without asking: the child runs
 * under --permission with read on its own folder and the runtime only, write
 * on its data dir only, and an env with no secrets in it.
 */
import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { NextFunction, Request, Response, Router } from "express";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import { prefixedTableName } from "@termix-ssh/plugin-sdk/db";
import { getActor, getActorSessionId, runAsActor } from "../actor.js";
import { getPluginDataDir } from "../paths.js";
import {
  Endpoint,
  processTransport,
  type StreamPort,
  type Transport,
} from "./rpc.js";
import { SandboxTokenStore } from "./tokens.js";
import { checkPluginSql } from "./sql-guard.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Grace after a request ends before its token stops working. */
export const REQUEST_TOKEN_GRACE_MS = 30_000;

export interface SandboxOptions {
  /** Grant the child outbound and listening sockets (Node 25+ only). */
  allowNet?: boolean;
  allowChildProcess?: boolean;
  allowWorker?: boolean;
  allowAddons?: boolean;
  /** Heap limit for the child in MiB. */
  maxHeapMiB?: number;
  /** Node binary for the child. Defaults to the one running core. */
  execPath?: string;
  tokens?: SandboxTokenStore;
  log?: (line: string) => void;
}

type AnyFn = (...args: unknown[]) => unknown;
type CtxObject = Record<string, unknown>;

/** Function paths on the real ctx, the only methods a child may call. */
export function ctxFunctionPaths(
  ctx: object,
  prefix = "",
  depth = 0,
): string[] {
  const out: string[] = [];
  if (depth > 3) return out;
  for (const key of Object.keys(ctx)) {
    let value: unknown;
    try {
      value = (ctx as CtxObject)[key];
    } catch {
      continue;
    }
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "function") out.push(full);
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...ctxFunctionPaths(value, full, depth + 1));
    }
  }
  return out;
}

/** Plain values on the ctx (pluginId and the like), copied to the child once. */
function ctxValues(
  ctx: object,
  prefix = "",
  depth = 0,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (depth > 3) return out;
  for (const key of Object.keys(ctx)) {
    let value: unknown;
    try {
      value = (ctx as CtxObject)[key];
    } catch {
      continue;
    }
    const full = prefix ? `${prefix}.${key}` : key;
    if (
      value === null ||
      ["string", "number", "boolean"].includes(typeof value)
    ) {
      out[full] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, ctxValues(value, full, depth + 1));
    }
  }
  return out;
}

function lookup(ctx: object, dotted: string): { fn: AnyFn; self: unknown } {
  let self: unknown = ctx;
  let value: unknown = ctx;
  for (const part of dotted.split(".")) {
    if (!value || !Object.prototype.hasOwnProperty.call(value, part)) {
      throw new Error(`No such ctx method ${dotted}`);
    }
    self = value;
    value = (value as CtxObject)[part];
  }
  if (typeof value !== "function") throw new Error(`${dotted} is not a method`);
  return { fn: value as AnyFn, self };
}

/** Headers a plugin never sees: they would let it act as the user elsewhere. */
const STRIPPED_HEADERS = new Set([
  "cookie",
  "authorization",
  "x-api-key",
  "proxy-authorization",
]);

function safeHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!STRIPPED_HEADERS.has(key.toLowerCase())) out[key] = value;
  }
  return out;
}

/** The read grants the child needs: its own folder and the runtime it runs on. */
export function childReadGrants(pluginDir: string): string[] {
  const grants = new Set<string>();
  // Both spellings: the permission model checks the path as asked for, and
  // the module loader asks for the real path behind a link.
  const add = (p: string) => {
    grants.add(path.resolve(p));
    try {
      grants.add(fs.realpathSync(p));
    } catch {
      // not there in this layout
    }
  };
  add(pluginDir);
  add(here);
  // Core's table definitions, for db.refs(). Plain Drizzle objects, no data.
  add(path.resolve(here, "../../database/db/schema.js"));
  // drizzle-orm, express, ssh2 and the SDK resolve from core's node_modules.
  const appRoot = path.resolve(here, "../../../../..");
  add(path.join(appRoot, "node_modules"));
  // Workspace packages (the SDK in a source checkout) are links to folders
  // outside node_modules, so name them too.
  add(path.join(appRoot, "node_modules", "@termix-ssh", "plugin-sdk"));
  return [...grants];
}

/** Whether the child's Node knows --allow-net (added in 25.0.0). */
export function nodeHasNetPermission(execPath?: string): boolean {
  if (execPath && execPath !== process.execPath) return true;
  return Number(process.versions.node.split(".")[0]) >= 25;
}

export class SandboxedPlugin {
  readonly pluginId: string;
  readonly tokens: SandboxTokenStore;
  child: ChildProcess | null = null;
  endpoint: Endpoint | null = null;
  startedAt = 0;
  readyAt = 0;
  private router: Router | null = null;
  private readonly ownTables = new Set<string>();
  /** Core's table objects, so a { $table } from the child finds the real one. */
  private readonly tablesByName = new Map<string, unknown>();
  private readonly refTables = new Set<string>();
  private readonly refs = new Map<
    string,
    { kind: "client" | "sftp" | "channel"; obj: unknown }
  >();
  private nextRef = 1;
  private readonly log: (line: string) => void;

  constructor(
    readonly manifest: PluginManifest,
    readonly pluginDir: string,
    readonly entryPath: string,
    readonly ctx: CtxObject,
    readonly options: SandboxOptions = {},
  ) {
    this.pluginId = manifest.id;
    this.tokens = options.tokens ?? new SandboxTokenStore();
    this.log = options.log ?? (() => {});
  }

  execArgv(): string[] {
    const harden = path.join(here, "child", "harden.js");
    const args = ["--permission"];
    for (const grant of childReadGrants(this.pluginDir)) {
      args.push(`--allow-fs-read=${grant}`);
    }
    args.push(`--allow-fs-write=${getPluginDataDir(this.pluginId)}`);
    // Node 24 has no network scope (sockets are open anyway); 25+ refuses
    // every socket unless this is given.
    if (this.options.allowNet && nodeHasNetPermission(this.options.execPath)) {
      args.push("--allow-net");
    }
    if (this.options.allowChildProcess) args.push("--allow-child-process");
    if (this.options.allowWorker) args.push("--allow-worker");
    if (this.options.allowAddons) args.push("--allow-addons");
    // A small young generation and a heap cap: without them each process
    // keeps the garbage from parsing its modules (drizzle alone leaves about
    // 120 MB). The cap is also the plugin's memory limit.
    args.push(
      "--max-semi-space-size=1",
      `--max-old-space-size=${this.options.maxHeapMiB ?? 256}`,
      "--expose-gc",
    );
    args.push(`--import=${pathToFileURL(harden).href}`);
    return args;
  }

  async start(): Promise<void> {
    this.startedAt = performance.now();
    fs.mkdirSync(getPluginDataDir(this.pluginId), { recursive: true });
    const child = fork(path.join(here, "child", "runtime.js"), [], {
      execPath: this.options.execPath ?? process.execPath,
      execArgv: this.execArgv(),
      serialization: "advanced",
      // No secrets: not the JWT secret, database settings or keys.
      env: {
        NODE_ENV: process.env.NODE_ENV ?? "production",
        TERMIX_SANDBOX_PLUGIN: this.pluginId,
      },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    this.child = child;
    const endpoint = this.attach(processTransport(child));
    child.once("exit", (code, signal) => {
      endpoint.close(`plugin process exited (${code ?? signal})`);
      this.tokens.revokePlugin(this.pluginId);
      this.log(`[sandbox] ${this.pluginId} exited ${code ?? signal}`);
    });

    const paths = ctxFunctionPaths(this.ctx);
    await endpoint.call("init", [
      {
        pluginId: this.pluginId,
        entryUrl: pathToFileURL(this.entryPath).href,
        functions: paths,
        values: ctxValues(this.ctx),
        manifest: this.manifest,
      },
    ]);
    // Activation runs with no actor, the same as in process.
    await endpoint.call("activate", []);
    this.readyAt = performance.now();
  }

  /**
   * Serves this plugin's ctx on a channel. start() uses the child's IPC
   * channel; tests pass an in-memory one.
   */
  attach(transport: Transport): Endpoint {
    const endpoint = new Endpoint(transport, {
      side: "h",
      outboundToken: () => this.mintForCurrentActor(),
      outboundActor: () => getActor(),
      inbound: (token, run) => this.runForToken(token, run),
      settled: (token) => this.releaseLater(token),
      unmarshalHook: (record) =>
        typeof record.$table === "string"
          ? this.tablesByName.get(record.$table)
          : undefined,
    });
    this.endpoint = endpoint;
    for (const dotted of ctxFunctionPaths(this.ctx)) {
      endpoint.handle(`ctx.${dotted}`, (args) => {
        const { fn, self } = lookup(this.ctx, dotted);
        return fn.apply(self, args);
      });
    }
    this.installSpecialHandlers(endpoint);
    return endpoint;
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    try {
      await Promise.race([
        this.endpoint?.call("deactivate", []),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
    } catch {
      // the child may already be gone
    }
    child.kill();
    this.tokens.revokePlugin(this.pluginId);
  }

  /** A token for whoever core is acting as right now, for a call into the child. */
  mintForCurrentActor(): string {
    return this.tokens.mint({
      pluginId: this.pluginId,
      userId: getActor() ?? "",
      sessionId: getActorSessionId(),
      kind: "callback",
    });
  }

  private releaseLater(token: string | undefined): void {
    if (!token) return;
    // Short grace so a reply still in flight can finish its own ctx calls.
    this.tokens.touch(token, REQUEST_TOKEN_GRACE_MS);
  }

  /**
   * Runs an incoming call as the user its token stands for. An unknown,
   * expired or foreign token is refused, never treated as background work.
   */
  runForToken<T>(token: string | undefined, run: () => T): T {
    if (token === undefined) return run();
    const grant = this.tokens.resolve(token, this.pluginId);
    if (!grant) {
      const error = new Error(
        "This plugin call has no valid actor",
      ) as Error & {
        status?: number;
        code?: string;
      };
      error.status = 403;
      error.code = "SANDBOX_TOKEN";
      throw error;
    }
    if (!grant.userId) return run();
    return runAsActor(grant.userId, "request", run, grant.sessionId);
  }

  private addRef(kind: "client" | "sftp" | "channel", obj: unknown): string {
    const id = `${kind}${this.nextRef++}`;
    this.refs.set(id, { kind, obj });
    return id;
  }

  private ref<T>(id: unknown, kind: "client" | "sftp" | "channel"): T {
    const entry = this.refs.get(String(id));
    if (!entry || entry.kind !== kind) throw new Error("That handle is gone");
    return entry.obj as T;
  }

  private installSpecialHandlers(endpoint: Endpoint): void {
    const ctx = this.ctx as {
      http: {
        router: (o: unknown) => Router;
        baseUrl: (req: unknown) => string;
      };
      ws: { route: (p: string, h: AnyFn, o: unknown) => void };
      db: {
        define: (d: unknown) => Promise<unknown>;
        client: () => Promise<unknown>;
        refs: () => Promise<Record<string, unknown>>;
      };
      ssh: {
        connect: (
          h: unknown,
          o: unknown,
        ) => Promise<{
          client: unknown;
          host: unknown;
          dispose: () => void;
        }>;
        withConnection: (h: unknown, o: unknown, fn: AnyFn) => Promise<unknown>;
      };
      rbac: { require: (permission: string) => AnyFn };
      fetch?: (url: string, init?: unknown) => Promise<globalThis.Response>;
    };

    // HTTP. Routes are mirrored onto core's real router so public path
    // checks and the route inventory keep working, then forwarded.
    endpoint.handle("http.router", ([options]) => {
      this.router = ctx.http.router(options);
      return true;
    });
    endpoint.handle("http.route", ([kind, routePath]) => {
      if (!this.router) throw new Error("ctx.http.router() was not called");
      const forward = (req: Request, res: Response, next: NextFunction) =>
        void this.dispatchHttp(req, res, next);
      const method = String(kind);
      const target = this.router as unknown as Record<string, AnyFn>;
      if (
        ![
          "get",
          "post",
          "put",
          "patch",
          "delete",
          "all",
          "use",
          "head",
          "options",
        ].includes(method)
      ) {
        throw new Error(`Unsupported route method ${method}`);
      }
      if (routePath === undefined) target[method].call(this.router, forward);
      else target[method].call(this.router, routePath, forward);
      return true;
    });

    endpoint.handle("rbac.check", async ([permission]) => {
      // The real middleware, run against the actor core resolved from the
      // token. Throws here when the plugin did not declare the permission.
      const middleware = ctx.rbac.require(String(permission));
      const userId = getActor();
      return await new Promise((resolve, reject) => {
        const res = {
          statusCode: 200,
          status(code: number) {
            this.statusCode = code;
            return this;
          },
          json(body: unknown) {
            resolve({ status: this.statusCode, body });
          },
        };
        middleware({ userId } as never, res as never, (error?: unknown) =>
          error ? reject(error) : resolve({ next: true }),
        );
      });
    });

    // WebSockets: core owns the socket; the child gets a message stream.
    endpoint.handle("ws.route", ([routePath, options]) => {
      ctx.ws.route(
        String(routePath),
        async (connection: {
          userId: string;
          socket: import("ws").WebSocket;
          request: { url?: string; headers?: Record<string, unknown> };
          clientIp: string;
          requestOrigin: string;
          isDataUnlocked: () => boolean;
        }) => {
          const token = this.tokens.mint({
            pluginId: this.pluginId,
            userId: connection.userId ?? "",
            sessionId: getActorSessionId(),
            kind: "socket",
            ttlMs: 60 * 60 * 1000,
          });
          const ws = connection.socket;
          const port = endpoint.openStream();
          ws.on("message", (data: Buffer, isBinary: boolean) => {
            this.tokens.touch(token, 60 * 60 * 1000);
            if (
              !port.write({ d: isBinary ? data : data.toString(), b: isBinary })
            ) {
              ws.pause();
              port.once("drain", () => ws.resume());
            }
          });
          port.on("data", (chunk: { d: Uint8Array | string; b: boolean }) => {
            if (ws.readyState !== ws.OPEN) return;
            ws.send(chunk.d, { binary: chunk.b });
            if (ws.bufferedAmount > 1024 * 1024) {
              port.pause();
              const check = setInterval(() => {
                if (
                  ws.bufferedAmount < 256 * 1024 ||
                  ws.readyState !== ws.OPEN
                ) {
                  clearInterval(check);
                  port.resume();
                }
              }, 10);
            }
          });
          port.on(
            "remote-end",
            (meta: { code?: number; reason?: string } | undefined) => {
              if (ws.readyState === ws.OPEN)
                ws.close(meta?.code ?? 1000, meta?.reason);
            },
          );
          ws.on("close", (code: number, reason: Buffer) => {
            port.endMeta = { code, reason: reason.toString() };
            port.end();
            this.tokens.revoke(token);
          });
          ws.on("error", () => port.destroy());
          await endpoint.callWithToken(token, "ws.open", [
            String(routePath),
            {
              userId: connection.userId ?? "",
              clientIp: connection.clientIp,
              requestOrigin: connection.requestOrigin,
              request: {
                url: connection.request?.url,
                headers: safeHeaders(connection.request?.headers ?? {}),
              },
              isDataUnlocked: () => connection.isDataUnlocked(),
            },
            port,
          ]);
        },
        options,
      );
      return true;
    });

    // Database: tables are built in the child from the same definition; every
    // statement comes back here and is checked against the plugin's tables.
    endpoint.handle("db.define", async ([definition]) => {
      const table = await ctx.db.define(definition);
      const name = (definition as { name: string }).name;
      const physical = prefixedTableName(this.pluginId, name).toLowerCase();
      this.ownTables.add(physical);
      this.tablesByName.set(physical, table);
      return true;
    });
    endpoint.handle("db.client", async () => {
      await ctx.db.client();
      return true;
    });
    endpoint.handle("db.refs", async () => {
      const refs = await ctx.db.refs();
      const { getTableName } = await import("drizzle-orm");
      for (const table of Object.values(refs)) {
        const name = getTableName(
          table as Parameters<typeof getTableName>[0],
        ).toLowerCase();
        this.refTables.add(name);
        this.tablesByName.set(name, table);
      }
      return Object.keys(refs);
    });
    endpoint.handle("db.query", async ([sql, params, method]) => {
      const verdict = checkPluginSql(String(sql), {
        own: this.ownTables,
        readOnly: this.refTables,
      });
      if (!verdict.ok) {
        const error = new Error(`Query refused: ${verdict.reason}`) as Error & {
          code?: string;
        };
        error.code = "SANDBOX_SQL";
        this.log(`[sandbox] ${this.pluginId} sql refused: ${verdict.reason}`);
        throw error;
      }
      const { getSqlite } = await import("../../database/db/index.js");
      const statement = getSqlite().prepare(String(sql));
      const values = (params as unknown[]) ?? [];
      if (method === "run") {
        statement.run(...values);
        return { rows: [] };
      }
      if (!statement.reader) {
        statement.run(...values);
        return { rows: [] };
      }
      statement.raw(true);
      if (method === "get")
        return { rows: statement.get(...values) ?? undefined };
      return { rows: statement.all(...values) };
    });

    // SSH: the ssh2 client stays in core. The child gets a handle and asks
    // for channels by name; data moves on credit based streams.
    endpoint.handle("ssh.connect", async ([host, options]) => {
      const connection = await ctx.ssh.connect(host, options);
      const id = this.addRef("client", connection.client);
      this.watchClient(id, connection.client);
      return {
        client: { $ssh: id },
        host: connection.host,
        dispose: () => {
          this.refs.delete(id);
          connection.dispose();
        },
      };
    });
    endpoint.handle("ssh.withConnection", async ([host, options, fn]) => {
      return await ctx.ssh.withConnection(
        host,
        options,
        async (client: unknown) => {
          const id = this.addRef("client", client);
          try {
            return await (fn as AnyFn)({ $ssh: id });
          } finally {
            this.refs.delete(id);
          }
        },
      );
    });
    endpoint.handle("ssh.exec", ([id, command, options]) =>
      this.openChannel(id, "exec", [command, options ?? {}]),
    );
    endpoint.handle("ssh.shell", ([id, window, options]) =>
      this.openChannel(id, "shell", [window ?? {}, options ?? {}]),
    );
    endpoint.handle("ssh.channel", ([id, method, args]) => {
      const channel = this.ref<Record<string, AnyFn>>(id, "channel");
      if (!["setWindow", "signal", "close"].includes(String(method))) {
        throw new Error(`Channel method ${method} is not available`);
      }
      return channel[String(method)](...(args as unknown[]));
    });
    endpoint.handle("ssh.end", ([id]) => {
      const client = this.ref<{ end: () => void }>(id, "client");
      client.end();
      this.refs.delete(String(id));
      return true;
    });
    endpoint.handle("ssh.sftp", async ([id]) => {
      const client = this.ref<{ sftp: (cb: AnyFn) => void }>(id, "client");
      const sftp = await new Promise((resolve, reject) =>
        client.sftp((err: unknown, s: unknown) =>
          err ? reject(err) : resolve(s),
        ),
      );
      return { $sftp: this.addRef("sftp", sftp) };
    });
    endpoint.handle("sftp.call", async ([id, method, args]) => {
      const allowed = [
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
      if (!allowed.includes(String(method))) {
        throw new Error(`SFTP method ${method} is not available`);
      }
      const sftp = this.ref<Record<string, AnyFn>>(id, "sftp");
      const result = await new Promise((resolve, reject) =>
        sftp[String(method)].call(
          sftp,
          ...(args as unknown[]),
          (err: unknown, value: unknown) =>
            err ? reject(err) : resolve(value),
        ),
      );
      return plainStats(result);
    });
    endpoint.handle("sftp.end", ([id]) => {
      this.ref<{ end: () => void }>(id, "sftp").end();
      this.refs.delete(String(id));
      return true;
    });

    if (typeof ctx.fetch === "function") {
      endpoint.handle("ctx.fetch", async ([url, init]) => {
        const response = await ctx.fetch!(String(url), init);
        const body = new Uint8Array(await response.arrayBuffer());
        const headers: Record<string, string> = {};
        response.headers.forEach((value: string, key: string) => {
          headers[key] = value;
        });
        return {
          $response: true,
          status: response.status,
          statusText: response.statusText,
          headers,
          body,
        };
      });
    }
  }

  private watchClient(id: string, client: unknown): void {
    const emitter = client as { once?: (e: string, fn: AnyFn) => void };
    emitter.once?.("close", () => {
      if (!this.refs.has(id)) return;
      this.refs.delete(id);
      this.endpoint?.notify("ssh.closed", [id]);
    });
  }

  private openChannel(
    id: unknown,
    kind: "exec" | "shell",
    args: unknown[],
  ): Promise<unknown> {
    const client = this.ref<Record<string, AnyFn>>(id, "client");
    const endpoint = this.endpoint!;
    return new Promise((resolve, reject) => {
      client[kind].call(
        client,
        ...args,
        (err: Error | undefined, stream: NodeChannel) => {
          if (err) return reject(err);
          const out = endpoint.openStream();
          const errPort = endpoint.openStream();
          const channelId = this.addRef("channel", stream);
          pump(stream, out);
          pump(stream.stderr, errPort);
          out.on("data", (chunk: Uint8Array) => {
            if (!stream.write(chunk)) {
              out.pause();
              stream.once("drain", () => out.resume());
            }
          });
          out.on("remote-end", () => stream.end());
          let exit: { code?: number | null; signal?: string } = {};
          stream.on("exit", (code: number | null, signal?: string) => {
            exit = { code, signal };
          });
          stream.on("close", (code?: number | null, signal?: string) => {
            if (code !== undefined) exit = { code, signal };
            errPort.end();
            out.endMeta = exit;
            out.end();
            this.refs.delete(channelId);
          });
          resolve({ out, err: errPort, channel: channelId });
        },
      );
    });
  }

  private async dispatchHttp(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const endpoint = this.endpoint;
    if (!endpoint) {
      res.status(503).json({ error: "This feature is not available" });
      return;
    }
    const port = endpoint.openStream();
    let headSent = false;
    port.on(
      "data",
      (
        chunk:
          | Uint8Array
          | { h: { status: number; headers: Record<string, unknown> } },
      ) => {
        if (!(chunk instanceof Uint8Array) && "h" in chunk) {
          res.status(chunk.h.status);
          for (const [key, value] of Object.entries(chunk.h.headers)) {
            if (value !== undefined) res.setHeader(key, value as string);
          }
          headSent = true;
          return;
        }
        if (!res.write(chunk as Uint8Array)) {
          port.pause();
          res.once("drain", () => port.resume());
        }
      },
    );
    const ended = new Promise<void>((resolve) => port.on("end", resolve));
    res.on("close", () => port.destroy());
    try {
      const outcome = (await endpoint.call("http.dispatch", [
        {
          method: req.method,
          url: req.url,
          originalUrl: req.originalUrl,
          headers: safeHeaders(req.headers as Record<string, unknown>),
          body: req.body,
          ip: req.ip,
          userId: (req as Request & { userId?: string }).userId ?? "",
          baseUrl: this.safeBaseUrl(req),
        },
        port,
      ])) as { next?: boolean };
      if (outcome?.next) {
        port.destroy();
        next();
        return;
      }
      await ended;
      if (!headSent && !res.headersSent) res.status(204);
      res.end();
    } catch (error) {
      port.destroy();
      if (res.headersSent) res.end();
      else next(error);
    }
  }

  private safeBaseUrl(req: Request): string {
    try {
      return (
        this.ctx as { http: { baseUrl: (r: unknown) => string } }
      ).http.baseUrl(req);
    } catch {
      return "";
    }
  }
}

interface NodeChannel {
  write(chunk: Uint8Array): boolean;
  end(): void;
  once(event: string, fn: AnyFn): void;
  on(event: string, fn: AnyFn): void;
  pause(): void;
  resume(): void;
  stderr: { on(e: string, fn: AnyFn): void; pause(): void; resume(): void };
}

/** Moves a readable into a port and pauses it when the other side has no credit. */
function pump(
  source: { on(e: string, fn: AnyFn): void; pause(): void; resume(): void },
  port: StreamPort,
): void {
  source.on("data", (chunk: Buffer) => {
    if (!port.write(chunk)) {
      source.pause();
      port.once("drain", () => source.resume());
    }
  });
}

function plainStats(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(plainStats);
  const stats = value as Record<string, unknown> & {
    isDirectory?: () => boolean;
    isFile?: () => boolean;
    isSymbolicLink?: () => boolean;
  };
  if (Buffer.isBuffer(value)) return value;
  if (typeof stats.isDirectory === "function") {
    return {
      ...stats,
      $stats: {
        dir: stats.isDirectory(),
        file: stats.isFile?.() ?? false,
        link: stats.isSymbolicLink?.() ?? false,
      },
    };
  }
  if ("attrs" in stats) return { ...stats, attrs: plainStats(stats.attrs) };
  return value;
}
