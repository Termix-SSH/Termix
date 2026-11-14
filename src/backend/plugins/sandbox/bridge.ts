/**
 * Serves one sandboxed plugin's ctx calls from the real PluginContext core
 * built for it.
 *
 * Core keeps every check it has today (capabilities, RBAC, audit, the actor),
 * because each call lands on the same ctx object an in-process plugin gets.
 * What the bridge adds:
 *   - the actor comes from a token core minted, never from the plugin;
 *   - only plain data, functions and streams cross (strict marshalling), so a
 *     database client or an ssh2 client never reaches the plugin;
 *   - paths that would hand out a live object go through their own handlers
 *     (database, SSH, HTTP, sockets, fetch) or are refused;
 *   - secret fields are stripped from host and SSH results unless the plugin
 *     holds credentials:read;
 *   - schedules, event topics and registry keys must be declared in the
 *     manifest's sandbox block.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { NextFunction, Request, Response, Router } from "express";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import { prefixedTableName } from "@termix-ssh/plugin-sdk/db";
import {
  getActor,
  getActorSessionId,
  getActorTrail,
  runAsActor,
} from "../actor.js";
import { hasCapability } from "../permissions.js";
import { HOST_SECRET_FIELDS } from "../ctx-hosts.js";
import { pluginLogger } from "../../utils/logger.js";
import { Endpoint, StreamPort, type Transport } from "./rpc.js";
import { SandboxTokenStore, type ActorGrant } from "./tokens.js";
import { checkPluginSql, type SqlDialect } from "./sql-guard.js";
import { runPluginSql, runPluginSqlBatch } from "./db-exec.js";
import {
  remoteSshAuthProvider,
  SshAuthBridgeError,
} from "./ssh-auth-bridge.js";
import {
  joinSshStream,
  joinStream,
  plainConfig,
  portAsSocket,
  refusalFromStandIn,
  standInClient,
  type StandInClient,
} from "./transport-bridge.js";
import {
  LoginBridgeError,
  remoteKeyboardInteractiveHandler,
  remoteLoginMethod,
} from "./login-bridge.js";

/** Grace after a call ends before its token stops working. */
export const REQUEST_TOKEN_GRACE_MS = 30_000;
const SOCKET_TOKEN_MS = 60 * 60 * 1000;
/** How long a prepared config's host key check stays usable. */
const PREPARED_MS = 15 * 60 * 1000;
/** A remote forward connection the plugin does not answer is rejected. */
const TCP_ANSWER_MS = 10_000;
/** A host key prompt the user never answers counts as refused. */
const VERIFY_MS = 5 * 60 * 1000;

type AnyFn = (...args: unknown[]) => unknown;
type CtxObject = Record<string, unknown>;

/**
 * ctx paths with their own handler below. The generic handler is never
 * registered for them, so a plugin can't reach the raw version.
 */
const SPECIAL_PATHS = new Set([
  "http.router",
  "http.baseUrl",
  "ws.route",
  "ws.upgrade",
  "rbac.require",
  "db.define",
  "db.client",
  "db.refs",
  "ssh.connect",
  "ssh.withConnection",
  "ssh.jumpChain",
  "ssh.prepare",
  "ssh.openTransport",
  "ssh.transports.provide",
  "desktop.local.pluginFetch",
  "desktop.local.fs.openRead",
  "desktop.local.fs.openDownload",
  "desktop.local.pty.spawn",
  "fetch",
  "services.get",
  "audit.exportBatches",
  "auth.registerSshAuthProvider",
  "auth.registerLoginMethod",
  "auth.registerKeyboardInteractiveHandler",
  "auth.completeRedirectLogin",
  "process.run",
  "currentActor",
  "disposables.add",
]);

/**
 * Not available to a sandboxed plugin yet. Each either hands out a live
 * object core can't bridge, or core calls the provider synchronously.
 */
const REFUSED_PATHS: ReadonlyMap<string, string> = new Map([
  ["hosts.locks.provide", "core reads host locks synchronously"],
  ["hosts.status.provide", "core reads host status synchronously"],
  // plugin-id-ok: ctx.sync is a core namespace, not the Sync plugin
  ["sync.provide", "the sync engine runs in process"], // plugin-id-ok: ctx.sync path
]);
const REFUSED_PREFIXES = ["sync.host."]; // plugin-id-ok: ctx.sync path

/** Results under these paths have secret fields stripped. */
const SECRET_SCRUB_PREFIXES = ["hosts.", "ssh.", "credentials.", "users."];

/** Values on ctx copied to the child once at start. */
const COPIED_VALUES = ["pluginId", "manifest", "db.dialect"];

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
      const proto = Object.getPrototypeOf(value);
      if (proto === Object.prototype || proto === null) {
        out.push(...ctxFunctionPaths(value, full, depth + 1));
      }
    }
  }
  return out;
}

/** Methods that write to the live HTTP response. */
const LIVE_RESPONSE = /\.(setCookie|clearCookie)$/;

export function isRefusedPath(dotted: string): string | null {
  const direct = REFUSED_PATHS.get(dotted);
  if (direct) return direct;
  if (LIVE_RESPONSE.test(dotted)) return "needs the live HTTP response";
  if (REFUSED_PREFIXES.some((prefix) => dotted.startsWith(prefix))) {
    return "not available to sandboxed plugins yet";
  }
  return null;
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

function readPath(ctx: object, dotted: string): unknown {
  let value: unknown = ctx;
  for (const part of dotted.split(".")) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as CtxObject)[part];
  }
  return value;
}

/** Headers a plugin never sees: they would let it act as the user elsewhere. */
const STRIPPED_HEADERS = new Set([
  "cookie",
  "authorization",
  "x-api-key",
  "proxy-authorization",
]);

export function safeHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!STRIPPED_HEADERS.has(key.toLowerCase())) out[key] = value;
  }
  return out;
}

/**
 * Cookies a plugin may set and read: names starting with this prefix. Core's
 * own cookies never reach a plugin process.
 */
export function pluginCookiePrefix(pluginId: string): string {
  return `tmxp_${pluginId.replace(/[^A-Za-z0-9]/g, "_")}_`;
}

/** The request's Cookie header cut down to the plugin's own cookies. */
export function ownCookieHeader(
  header: unknown,
  prefix: string,
): string | undefined {
  if (typeof header !== "string") return undefined;
  const kept = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(prefix) && part.includes("="));
  return kept.length ? kept.join("; ") : undefined;
}

/** Set-Cookie values naming only the plugin's own cookies, with no Domain. */
export function ownSetCookies(value: unknown, prefix: string): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.filter(
    (item): item is string =>
      typeof item === "string" &&
      item.startsWith(prefix) &&
      /^[^=;\s]+=/.test(item) &&
      !/;\s*domain\s*=/i.test(item),
  );
}

const SECRET_FIELDS = new Set<string>(HOST_SECRET_FIELDS);

/** A deep copy with every host secret field removed. */
export function scrubSecrets(value: unknown, depth = 0): unknown {
  if (depth > 16 || value === null || typeof value !== "object") return value;
  if (Buffer.isBuffer(value) || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => scrubSecrets(v, depth + 1));
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_FIELDS.has(key)) continue;
    out[key] =
      typeof item === "function" ? item : scrubSecrets(item, depth + 1);
  }
  return out;
}

export class SandboxError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 403,
  ) {
    super(message);
  }
}

export interface BridgeOptions {
  manifest: PluginManifest;
  ctx: CtxObject;
  tokens: SandboxTokenStore;
  dialect: SqlDialect;
  /** Called when the plugin's process was asked to do work. */
  touch?: () => void;
  log?: (line: string) => void;
}

/**
 * One per running plugin process. Created by the supervisor for each start,
 * thrown away when the process exits.
 */
export class PluginBridge {
  readonly pluginId: string;
  readonly endpoint: Endpoint;
  private readonly manifest: PluginManifest;
  private readonly ctx: CtxObject;
  private readonly tokens: SandboxTokenStore;
  private readonly dialect: SqlDialect;
  private readonly log: (line: string) => void;
  private readonly touch: () => void;
  private router: Router | null = null;
  private routerRaw = false;
  private readonly ownTables = new Set<string>();
  /** Core's table objects, so a { $table } from the child finds the real one. */
  private readonly tablesByName = new Map<string, unknown>();
  private readonly refTables = new Set<string>();
  private readonly refs = new Map<string, { kind: RefKind; obj: unknown }>();
  private nextRef = 1;
  private readonly provided = new Map<string, unknown>();
  private readonly serviceRefs = new Map<string, string>();
  private readonly wsHandlers = new Set<string>();
  /** Open plugin sockets by their stream id, for ssh.prepare's host key prompt. */
  private readonly sockets = new Map<string, import("ws").WebSocket>();
  /** Streams core opened for the plugin, closed with its process. */
  private readonly openStreams = new Map<string, Duplex>();
  private readonly unjoins = new Map<string, () => void>();
  /** Incoming remote forward connections waiting for the plugin's answer. */
  private readonly pendingTcp = new Map<
    string,
    { accept: () => Duplex; reject: () => void; timer: NodeJS.Timeout }
  >();
  private readonly tcpWatched = new Set<string>();
  /** Requests in flight, by the token the child got for them. */
  private readonly liveRequests = new Map<
    string,
    { req: Request; res: Response; handedOff: boolean }
  >();
  private readonly declaredSchedules: Set<string>;
  private readonly declaredEvents: Set<string>;
  private readonly declaredRegistry: Set<string>;
  private closed = false;

  constructor(transport: Transport, options: BridgeOptions) {
    this.manifest = options.manifest;
    this.pluginId = options.manifest.id;
    this.ctx = options.ctx;
    this.tokens = options.tokens;
    this.dialect = options.dialect;
    this.log = options.log ?? (() => {});
    this.touch = options.touch ?? (() => {});
    const sandbox = options.manifest.sandbox ?? {};
    this.declaredSchedules = new Set(
      (sandbox.schedules ?? []).map((s) => s.id),
    );
    this.declaredEvents = new Set(sandbox.events ?? []);
    this.declaredRegistry = new Set(sandbox.registry ?? []);

    this.endpoint = new Endpoint(transport, {
      side: "h",
      strict: true,
      outboundToken: () => this.mintForCurrentActor(),
      outboundActor: () => getActor(),
      inbound: (token, run) => this.runForToken(token, run),
      settled: (token) => this.releaseLater(token),
      unmarshalHook: (record) =>
        typeof record.$table === "string"
          ? this.tablesByName.get(record.$table)
          : undefined,
      onBadMessage: (reason) =>
        this.log(`[sandbox] ${this.pluginId} sent a bad message: ${reason}`),
    });
    this.installGeneric();
    this.installSpecial();
  }

  /** What the child needs to build its ctx. */
  initConfig(entryUrl: string): Record<string, unknown> {
    const all = ctxFunctionPaths(this.ctx);
    const functions = all.filter((dotted) => !isRefusedPath(dotted));
    const refused = all
      .filter((dotted) => isRefusedPath(dotted))
      .map((dotted) => [dotted, isRefusedPath(dotted)]);
    const values: Record<string, unknown> = {};
    for (const dotted of COPIED_VALUES) {
      const value = readPath(this.ctx, dotted);
      if (value !== undefined) values[dotted] = value;
    }
    return {
      pluginId: this.pluginId,
      entryUrl,
      functions,
      refused,
      values,
      manifest: this.manifest,
      dialect: this.dialect,
    };
  }

  close(reason: string): void {
    this.closed = true;
    this.endpoint.close(reason);
    this.tokens.revokePlugin(this.pluginId);
    this.refs.clear();
    for (const pending of this.pendingTcp.values()) {
      clearTimeout(pending.timer);
      pending.reject();
    }
    this.pendingTcp.clear();
    for (const stream of this.openStreams.values()) stream.destroy();
    this.openStreams.clear();
    this.sockets.clear();
  }

  /** A stream core holds for the plugin, closed when the plugin says so. */
  private track(
    stream: Duplex | NodeReadable,
    port: StreamPort,
    unjoin?: () => void,
  ): void {
    const held = stream as Duplex;
    this.openStreams.set(port.sid, held);
    if (unjoin) this.unjoins.set(port.sid, unjoin);
    held.once?.("close", () => {
      this.openStreams.delete(port.sid);
      this.unjoins.delete(port.sid);
    });
  }

  /**
   * A channel core holds that the plugin now hands back as a sock: core
   * stops moving its bytes to the plugin and uses it directly.
   */
  private takeStream(sid: unknown): Duplex {
    const key = String(sid);
    const stream = this.openStreams.get(key);
    const unjoin = this.unjoins.get(key);
    if (!stream || !unjoin) {
      throw new SandboxError("That stream is gone", "SANDBOX_HANDLE", 410);
    }
    this.openStreams.delete(key);
    this.unjoins.delete(key);
    unjoin();
    return stream;
  }

  /** ssh.connect options from the plugin, with a sock turned back into a stream. */
  private connectOptions(options: unknown): Record<string, unknown> {
    const { sockStream, sockPort, ...rest } = plainObject(options);
    if (sockStream !== undefined) {
      return { ...rest, sock: this.takeStream(sockStream) };
    }
    if (sockPort instanceof StreamPort) {
      return { ...rest, sock: portAsSocket(sockPort) };
    }
    return rest;
  }

  /** A token for whoever core is acting as right now, for a call into the child. */
  mintForCurrentActor(kind: ActorGrant["kind"] = "callback"): string {
    return this.tokens.mint({
      pluginId: this.pluginId,
      userId: getActor() ?? "",
      sessionId: getActorSessionId(),
      trail: getActorTrail(),
      kind,
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
    this.touch();
    if (token === undefined) return run();
    const grant = this.tokens.resolve(token, this.pluginId);
    if (!grant) {
      throw new SandboxError(
        "This plugin call has no valid actor",
        "SANDBOX_TOKEN",
      );
    }
    if (!grant.userId) return run();
    return runAsActor(
      grant.userId,
      "request",
      run,
      grant.sessionId,
      grant.trail,
    );
  }

  private async mayReadCredentials(): Promise<boolean> {
    return hasCapability(
      this.pluginId,
      "credentials:read",
      this.manifest.capabilities,
    );
  }

  // ---- generic ctx methods ----

  private installGeneric(): void {
    for (const dotted of ctxFunctionPaths(this.ctx)) {
      if (SPECIAL_PATHS.has(dotted)) continue;
      const refused = isRefusedPath(dotted);
      if (refused) {
        this.endpoint.handle(`ctx.${dotted}`, () => {
          throw new SandboxError(
            `ctx.${dotted} is not available to sandboxed plugins: ${refused}`,
            "SANDBOX_UNSUPPORTED",
            501,
          );
        });
        continue;
      }
      const scrub = SECRET_SCRUB_PREFIXES.some((p) => dotted.startsWith(p));
      this.endpoint.handle(`ctx.${dotted}`, async (args) => {
        this.checkDeclared(dotted, args);
        const { fn, self } = lookup(this.ctx, dotted);
        let callArgs = args;
        if (dotted === "registry.provide") {
          this.provided.set(String(args[0]), args[1]);
        }
        if (dotted === "registry.revoke") {
          const key = String(args[0]);
          callArgs = [key, this.provided.get(key)];
          this.provided.delete(key);
        }
        const result = await fn.apply(self, callArgs);
        if (scrub && !(await this.mayReadCredentials())) {
          return scrubSecrets(result);
        }
        return result;
      });
    }
  }

  /** Schedules, event topics and registry keys must be in the manifest. */
  private checkDeclared(dotted: string, args: unknown[]): void {
    if (dotted === "schedule.every") {
      const options = (args[2] ?? {}) as { id?: unknown };
      const id = typeof options.id === "string" ? options.id : "";
      if (!this.declaredSchedules.has(id)) {
        throw new SandboxError(
          `ctx.schedule.every needs an id listed in the manifest's sandbox.schedules (got "${id}")`,
          "SANDBOX_UNDECLARED",
          400,
        );
      }
    }
    if (dotted === "events.on") {
      const topic = String(args[0]);
      if (!this.declaredEvents.has(topic)) {
        throw new SandboxError(
          `ctx.events.on("${topic}") needs the topic listed in the manifest's sandbox.events`,
          "SANDBOX_UNDECLARED",
          400,
        );
      }
    }
    if (dotted === "registry.provide") {
      const key = String(args[0]);
      if (!this.declaredRegistry.has(key)) {
        throw new SandboxError(
          `ctx.registry.provide("${key}") needs the key listed in the manifest's sandbox.registry`,
          "SANDBOX_UNDECLARED",
          400,
        );
      }
    }
  }

  // ---- special handlers ----

  private addRef(kind: RefKind, obj: unknown): string {
    const id = `${kind}${this.nextRef++}`;
    this.refs.set(id, { kind, obj });
    return id;
  }

  private ref<T>(id: unknown, kind: RefKind): T {
    const entry = this.refs.get(String(id));
    if (!entry || entry.kind !== kind) {
      throw new SandboxError("That handle is gone", "SANDBOX_HANDLE", 410);
    }
    return entry.obj as T;
  }

  private callCtx(dotted: string, ...args: unknown[]): unknown {
    const fn = readPath(this.ctx, dotted);
    if (typeof fn !== "function") {
      throw new SandboxError(
        `ctx.${dotted} is not available`,
        "SANDBOX_UNSUPPORTED",
        501,
      );
    }
    const parent = dotted.split(".").slice(0, -1).join(".");
    return (fn as AnyFn).apply(readPath(this.ctx, parent) as object, args);
  }

  private wrapRemote<T>(build: () => T): T {
    try {
      return build();
    } catch (error) {
      if (error instanceof LoginBridgeError) {
        throw new SandboxError(error.message, error.code, 400);
      }
      throw error;
    }
  }

  private loginDeps() {
    const cookiePrefix = pluginCookiePrefix(this.pluginId);
    return {
      cookiePrefix,
      headers: (req: Request) => this.requestHeaders(req, cookiePrefix),
      baseUrl: (req: Request) => this.safeBaseUrl(req),
      visibleHost: async (host: unknown) =>
        (await this.mayReadCredentials()) ? host : scrubSecrets(host),
    };
  }

  private installSpecial(): void {
    const endpoint = this.endpoint;
    const ctx = this.ctx as unknown as SpecialCtx;

    // HTTP. Routes are mirrored onto core's real router so public path checks
    // and the route inventory keep working, then forwarded.
    endpoint.handle("http.router", ([options]) => {
      if (this.router) throw new Error("ctx.http.router() was called twice");
      const opts = (options ?? {}) as { rawBody?: boolean };
      this.routerRaw = !!opts.rawBody;
      this.router = ctx.http.router(options);
      return true;
    });
    endpoint.handle("http.route", ([kind, routePath]) => {
      if (!this.router) throw new Error("ctx.http.router() was not called");
      const method = String(kind);
      if (!ROUTE_METHODS.has(method)) {
        throw new Error(`Unsupported route method ${method}`);
      }
      if (
        routePath !== undefined &&
        typeof routePath !== "string" &&
        !Array.isArray(routePath)
      ) {
        throw new Error("Route paths must be strings");
      }
      const forward = (req: Request, res: Response, next: NextFunction) =>
        void this.dispatchHttp(req, res, next);
      const target = this.router as unknown as Record<string, AnyFn>;
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

    // SSH auth providers: the client and real config stay here.
    endpoint.handle("ctx.auth.registerSshAuthProvider", async ([raw]) => {
      const register = readPath(this.ctx, "auth.registerSshAuthProvider");
      if (typeof register !== "function") {
        throw new SandboxError(
          "ctx.auth.registerSshAuthProvider is not available",
          "SANDBOX_UNSUPPORTED",
          501,
        );
      }
      let provider: unknown;
      try {
        provider = remoteSshAuthProvider(plainObject(raw), {
          visibleHost: async (host) =>
            (await this.mayReadCredentials()) ? host : scrubSecrets(host),
          applyCertificate: async (config, client, cert, username) => {
            const { applyCertificateAuth } =
              await import("@termix-ssh/plugin-sdk/ssh-certs");
            await applyCertificateAuth(
              config as never,
              client as never,
              cert,
              username,
            );
          },
        });
      } catch (error) {
        if (error instanceof SshAuthBridgeError) {
          throw new SandboxError(error.message, error.code, 501);
        }
        throw error;
      }
      (register as AnyFn).call(readPath(this.ctx, "auth") as object, provider);
      return true;
    });

    // Login methods get a plain copy of the request; cookies come back as
    // data and only the plugin's own are set.
    endpoint.handle("ctx.auth.registerLoginMethod", async ([raw]) => {
      const method = this.wrapRemote(() =>
        remoteLoginMethod(plainObject(raw), this.loginDeps()),
      );
      this.callCtx("auth.registerLoginMethod", method);
      return true;
    });

    endpoint.handle(
      "ctx.auth.registerKeyboardInteractiveHandler",
      async ([raw]) => {
        const handler = this.wrapRemote(() =>
          remoteKeyboardInteractiveHandler(plainObject(raw), this.loginDeps()),
        );
        this.callCtx("auth.registerKeyboardInteractiveHandler", handler);
        return true;
      },
    );

    // Only from inside one of the plugin's own requests: core finishes the
    // login on that request's live response.
    endpoint.handle(
      "ctx.auth.completeRedirectLogin",
      async ([methodId], token) => {
        const live = token ? this.liveRequests.get(token) : undefined;
        if (!live || live.res.headersSent) {
          throw new SandboxError(
            "completeRedirectLogin works only inside one of the plugin's own requests",
            "SANDBOX_UNSUPPORTED",
            400,
          );
        }
        live.handedOff = true;
        await this.callCtx(
          "auth.completeRedirectLogin",
          String(methodId),
          live.req,
          live.res,
        );
        return true;
      },
    );

    // Child processes run in core. The exit Promise can't cross, so the
    // child asks for it through waitExit and builds its own.
    endpoint.handle("ctx.process.run", async (args) => {
      const run = readPath(this.ctx, "process.run");
      if (typeof run !== "function") {
        throw new SandboxError(
          "ctx.process.run is not available",
          "SANDBOX_UNSUPPORTED",
          501,
        );
      }
      const [file, list, options] = args;
      const opts = plainObject(options);
      const handle = (await (run as AnyFn).call(
        readPath(this.ctx, "process") as object,
        String(file),
        Array.isArray(list) ? list.map(String) : [],
        {
          ...(typeof opts.cwd === "string" ? { cwd: opts.cwd } : {}),
          ...(opts.env && typeof opts.env === "object"
            ? { env: plainObject(opts.env) }
            : {}),
          ...(typeof opts.timeoutMs === "number"
            ? { timeoutMs: opts.timeoutMs }
            : {}),
        },
      )) as {
        pid?: number;
        onStdout: AnyFn;
        onStderr: AnyFn;
        exited: Promise<unknown>;
        kill: AnyFn;
      };
      return {
        pid: handle.pid,
        onStdout: (listener: unknown) =>
          typeof listener === "function"
            ? handle.onStdout(listener)
            : undefined,
        onStderr: (listener: unknown) =>
          typeof listener === "function"
            ? handle.onStderr(listener)
            : undefined,
        kill: (signal?: unknown) =>
          handle.kill(signal === "SIGKILL" ? "SIGKILL" : "SIGTERM"),
        waitExit: () => handle.exited,
      };
    });

    // WebSockets: core owns the socket; the child gets a message stream.
    endpoint.handle("ws.route", ([routePath, options]) => {
      const path = String(routePath);
      this.wsHandlers.add(path);
      ctx.ws.route(
        path,
        (connection: WsConnection) => this.openSocket(path, connection),
        options,
      );
      return true;
    });

    // Raw upgrades: core keeps the TCP socket and moves its bytes.
    endpoint.handle("ws.upgrade", ([routePath, options]) => {
      const path = String(routePath);
      ctx.ws.upgrade(
        path,
        (
          request: IncomingMessage,
          socket: Duplex,
          head: Buffer,
          userId: string,
        ) => void this.openRawUpgrade(path, request, socket, head, userId),
        options,
      );
      return true;
    });

    // Database: tables are built in the child from the same definition;
    // every statement comes back here and is checked against the plugin's
    // own tables.
    endpoint.handle("db.define", async ([definition]) => {
      const table = await ctx.db.define(definition);
      const name = (definition as { name: string }).name;
      const physical = prefixedTableName(this.pluginId, name).toLowerCase();
      this.ownTables.add(physical);
      this.tablesByName.set(physical, table);
      return true;
    });
    endpoint.handle("db.client", async () => {
      // Runs the capability check and the audit line; the client stays here.
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
      this.guardSql(String(sql));
      return runPluginSql(
        this.dialect,
        String(sql),
        Array.isArray(params) ? params : [],
        String(method),
      );
    });
    endpoint.handle("db.batch", async ([statements]) => {
      if (!Array.isArray(statements) || statements.length > 500) {
        throw new SandboxError(
          "A batch takes 1 to 500 statements",
          "SANDBOX_SQL",
          400,
        );
      }
      const list = statements.map((raw) => {
        const item = raw as {
          sql?: unknown;
          params?: unknown;
          method?: unknown;
        };
        const sql = String(item.sql ?? "");
        this.guardSql(sql);
        return {
          sql,
          params: Array.isArray(item.params) ? item.params : [],
          method: String(item.method ?? "run"),
        };
      });
      return runPluginSqlBatch(this.dialect, list);
    });

    // SSH: the ssh2 client stays in core. The child gets a handle and asks
    // for channels by name; data moves on credit based streams.
    endpoint.handle("ssh.connect", async ([host, options]) => {
      const connection = await ctx.ssh.connect(
        host,
        this.connectOptions(options),
      );
      const id = this.addRef("client", connection.client);
      this.watchClient(id, connection.client);
      return {
        client: { $ssh: id },
        host: (await this.mayReadCredentials())
          ? connection.host
          : scrubSecrets(connection.host),
        dispose: () => {
          this.refs.delete(id);
          connection.dispose();
        },
      };
    });
    endpoint.handle("ssh.withConnection", async ([host, options, fn]) => {
      if (typeof fn !== "function") throw new Error("A callback is needed");
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
      this.openChannel(id, "exec", [String(command), plainObject(options)]),
    );
    endpoint.handle("ssh.shell", ([id, window, options]) =>
      this.openChannel(id, "shell", [
        plainObject(window),
        plainObject(options),
      ]),
    );
    endpoint.handle("ssh.channel", ([id, method, args]) => {
      const channel = this.ref<Record<string, AnyFn>>(id, "channel");
      if (!["setWindow", "signal", "close"].includes(String(method))) {
        throw new Error(`Channel method ${method} is not available`);
      }
      const list = Array.isArray(args) ? args : [];
      return channel[String(method)](...list.map(plainArg));
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
      if (!SFTP_METHODS.has(String(method))) {
        throw new Error(`SFTP method ${method} is not available`);
      }
      const sftp = this.ref<Record<string, AnyFn>>(id, "sftp");
      const list = (Array.isArray(args) ? args : []).map(plainArg);
      const result = await new Promise((resolve, reject) =>
        sftp[String(method)].call(
          sftp,
          ...list,
          (err: unknown, value: unknown) =>
            err ? reject(err) : resolve(value),
        ),
      );
      return plainStats(result);
    });
    endpoint.handle("sftp.read", ([id, path]) => {
      const sftp = this.ref<{ createReadStream: AnyFn }>(id, "sftp");
      const source = sftp.createReadStream(String(path)) as NodeReadable;
      const port = endpoint.openStream();
      pump(source, port);
      source.on("end", () => port.end());
      source.on("error", (error: Error) => port.destroy(error));
      port.on("close", () => source.destroy?.());
      return port;
    });
    endpoint.handle("sftp.write", ([id, path, port]) => {
      const sftp = this.ref<{ createWriteStream: AnyFn }>(id, "sftp");
      const sink = sftp.createWriteStream(String(path)) as NodeWritable;
      const input = port as StreamPort;
      return new Promise((resolve, reject) => {
        input.on("data", (chunk: Buffer) => {
          if (!sink.write(chunk)) {
            input.pause();
            sink.once("drain", () => input.resume());
          }
        });
        input.on("end", () => sink.end());
        input.on("error", (error: Error) => {
          sink.destroy?.(error);
          reject(error);
        });
        sink.on("close", () => resolve(true));
        sink.on("error", (error: Error) => reject(error));
      });
    });
    endpoint.handle("sftp.end", ([id]) => {
      this.ref<{ end: () => void }>(id, "sftp").end();
      this.refs.delete(String(id));
      return true;
    });
    endpoint.handle(
      "ssh.forwardOut",
      ([id, srcIP, srcPort, dstIP, dstPort]) => {
        const client = this.ref<{ forwardOut: AnyFn }>(id, "client");
        return new Promise((resolve, reject) => {
          client.forwardOut(
            String(srcIP),
            Number(srcPort) || 0,
            String(dstIP),
            Number(dstPort),
            (err: Error | undefined, stream: Duplex) => {
              if (err) return reject(err);
              const port = endpoint.openStream();
              this.track(stream, port, joinStream(stream, port));
              resolve(port);
            },
          );
        });
      },
    );

    // A jump chain ends at a client core holds, reached like ssh.connect's.
    // A plugin that carries host connections: core asks it about each host
    // and gets the stream to the host back as a port.
    endpoint.handle("ssh.transports.provide", ([raw]) => {
      const provider = plainObject(raw);
      const claims = provider.claims;
      const open = provider.open;
      if (typeof claims !== "function" || typeof open !== "function") {
        throw new SandboxError(
          "A transport provider needs claims and open",
          "SANDBOX_VALUE",
          400,
        );
      }
      return this.callCtx("ssh.transports.provide", {
        claims: async (hostId: number, host?: unknown) =>
          (await (claims as AnyFn)(hostId, plainConfig(host))) === true,
        open: async (host: unknown) => {
          const port = await (open as AnyFn)(plainConfig(host));
          if (!(port instanceof StreamPort)) {
            throw new Error("The transport provider gave no stream");
          }
          return portAsSocket(port);
        },
      });
    });

    // Remote forwards: the host listens, and each connection it gets is
    // offered to the plugin, which accepts or rejects it.
    endpoint.handle("ssh.forwardIn", ([id, bindHost, bindPort]) => {
      const client = this.ref<SshClientLike>(id, "client");
      this.watchTcp(String(id), client);
      return new Promise((resolve, reject) =>
        client.forwardIn(
          String(bindHost),
          Number(bindPort) || 0,
          (err: Error | undefined, port: number) =>
            err ? reject(err) : resolve(port),
        ),
      );
    });
    endpoint.handle("ssh.unforwardIn", ([id, bindHost, bindPort]) => {
      const client = this.ref<SshClientLike>(id, "client");
      return new Promise((resolve, reject) =>
        client.unforwardIn(
          String(bindHost),
          Number(bindPort) || 0,
          (err: Error | undefined) => (err ? reject(err) : resolve(true)),
        ),
      );
    });
    endpoint.handle("ssh.acceptTcp", ([tid, port]) => {
      const pending = this.pendingTcp.get(String(tid));
      if (!pending || !(port instanceof StreamPort)) return false;
      this.pendingTcp.delete(String(tid));
      clearTimeout(pending.timer);
      const channel = pending.accept();
      this.track(channel, port, joinStream(channel, port));
      return true;
    });
    endpoint.handle("ssh.rejectTcp", ([tid]) => {
      const pending = this.pendingTcp.get(String(tid));
      if (!pending) return false;
      this.pendingTcp.delete(String(tid));
      clearTimeout(pending.timer);
      pending.reject();
      return true;
    });

    // The plugin's end of a stream above went away.
    endpoint.handle("stream.close", ([sid]) => {
      const stream = this.openStreams.get(String(sid));
      this.openStreams.delete(String(sid));
      stream?.destroy();
      return true;
    });

    endpoint.handle("ssh.jumpChain", async ([jumpHosts, options]) => {
      const opts = plainObject(options);
      const chain = (await this.callCtx(
        "ssh.jumpChain",
        Array.isArray(jumpHosts) ? jumpHosts.map(plainObject) : [],
        {
          ...(opts.forHost !== undefined ? { forHost: opts.forHost } : {}),
          ...promptOption(opts.prompt),
        },
      )) as { client: unknown; host: unknown; dispose: () => void };
      const id = this.addRef("client", chain.client);
      this.watchClient(id, chain.client);
      return {
        client: { $ssh: id },
        host: (await this.mayReadCredentials())
          ? chain.host
          : scrubSecrets(chain.host),
        dispose: () => {
          this.refs.delete(id);
          chain.dispose();
        },
      };
    });

    // The plugin runs its own ssh2 client. Core builds the config against a
    // stand-in client and keeps the host key check; the plugin's client asks
    // ssh.verifyHostKey for every key it is shown.
    endpoint.handle("ssh.prepare", async ([host, options]) => {
      const opts = plainObject(options);
      const client = standInClient();
      const socketId =
        typeof opts.hostKeySocket === "string" ? opts.hostKeySocket : "";
      const built = (await this.callCtx("ssh.prepare", host, {
        purpose: opts.purpose,
        ...(typeof opts.profile === "string" ? { profile: opts.profile } : {}),
        ...(Number.isInteger(opts.serverHostId)
          ? { serverHostId: opts.serverHostId }
          : {}),
        interactive: opts.interactive === true,
        ...(typeof opts.log === "function" ? { log: opts.log } : {}),
        client,
        hostKeySocket: (socketId && this.sockets.get(socketId)) || null,
      })) as {
        config: Record<string, unknown>;
        outcome: unknown;
        authType: unknown;
        onBanner?: AnyFn;
        onAuthFailed?: AnyFn;
      };
      const { hostVerifier, ...rest } = built.config;
      const id = this.addRef("prepared", {
        verify:
          typeof hostVerifier === "function" ? (hostVerifier as AnyFn) : null,
        client,
      } satisfies PreparedEntry);
      setTimeout(() => this.refs.delete(id), PREPARED_MS).unref?.();
      return {
        prepared: id,
        config: plainConfig(rest),
        outcome: built.outcome,
        authType: built.authType,
        ...(built.onBanner ? { onBanner: built.onBanner } : {}),
        ...(built.onAuthFailed ? { onAuthFailed: built.onAuthFailed } : {}),
      };
    });
    endpoint.handle("ssh.verifyHostKey", async ([id, key]) => {
      const entry = this.ref<PreparedEntry>(id, "prepared");
      if (!entry.verify || !Buffer.isBuffer(key) || key.length > 64 * 1024) {
        return { valid: false, message: "The host key could not be checked" };
      }
      const verify = entry.verify;
      const valid = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), VERIFY_MS);
        try {
          verify(key, (ok: unknown) => {
            clearTimeout(timer);
            resolve(ok === true);
          });
        } catch {
          clearTimeout(timer);
          resolve(false);
        }
      });
      if (valid) return { valid: true };
      return { valid: false, ...refusalFromStandIn(entry.client) };
    });

    // The bytes to the host: core opens the socket (or the proxy, jump or
    // provided route) and the plugin's client speaks SSH over the stream.
    endpoint.handle("ssh.openTransport", async ([host, config, options]) => {
      const cfg = plainObject(config);
      const opts = plainObject(options);
      if (typeof cfg.host !== "string" || !cfg.host) {
        throw new SandboxError(
          "ctx.ssh.openTransport needs the config from ctx.ssh.prepare",
          "SANDBOX_VALUE",
          400,
        );
      }
      const target: Record<string, unknown> = {
        host: cfg.host,
        port: Number.isInteger(cfg.port) ? cfg.port : 22,
      };
      const opened = (await this.callCtx("ssh.openTransport", host, target, {
        ...(opts.resolveDns === false ? { resolveDns: false } : {}),
        ...(opts.portKnock === false ? { portKnock: false } : {}),
        ...(typeof opts.log === "function" ? { log: opts.log } : {}),
        ...promptOption(opts.prompt),
      })) as { jumpClient: unknown; via: string };
      let jumpClient: { $ssh: string } | null = null;
      if (opened.jumpClient) {
        const jumpId = this.addRef("client", opened.jumpClient);
        this.watchClient(jumpId, opened.jumpClient);
        jumpClient = { $ssh: jumpId };
      }
      let sock = target.sock as Duplex | undefined;
      // The plugin brought its own stream for a direct connection.
      if (!sock && opts.ownSock === true) {
        return { via: opened.via, jumpClient, sock: null };
      }
      if (!sock) {
        const net = await import("node:net");
        sock = net.connect({
          host: String(target.host),
          port: Number(target.port) || 22,
        });
      }
      const port = endpoint.openStream();
      this.track(sock, port);
      joinSshStream(sock, port);
      return { via: opened.via, jumpClient, sock: port };
    });

    // Desktop local access. Plain calls use the generic handler; these hand
    // out streams.
    endpoint.handle(
      "desktop.local.pluginFetch",
      async ([origin, subPath, init, bodyPort]) => {
        const opts = plainObject(init);
        const body =
          bodyPort instanceof StreamPort
            ? bodyPort
            : typeof opts.body === "string" || Buffer.isBuffer(opts.body)
              ? opts.body
              : undefined;
        const response = (await this.callCtx(
          "desktop.local.pluginFetch",
          String(origin),
          String(subPath),
          {
            ...(typeof opts.method === "string" ? { method: opts.method } : {}),
            headers: stringRecord(opts.headers),
            ...(body !== undefined ? { body } : {}),
          },
        )) as {
          status: number;
          ok: boolean;
          headers: { forEach?: (fn: (v: string, k: string) => void) => void };
          body: AsyncIterable<Uint8Array> | null;
        };
        const headers: Record<string, string> = {};
        response.headers?.forEach?.((value, key) => {
          headers[key] = value;
        });
        let out: StreamPort | null = null;
        if (response.body) {
          const port = endpoint.openStream();
          out = port;
          const source = response.body;
          void (async () => {
            for await (const chunk of source) {
              if (!port.write(Buffer.from(chunk))) {
                await new Promise((resolve) => port.once("drain", resolve));
              }
              if (port.destroyed) return;
            }
            port.end();
          })().catch((error: Error) => port.destroy(error));
        }
        return {
          status: response.status,
          ok: response.ok,
          headers,
          body: out,
        };
      },
    );
    endpoint.handle("desktop.local.fs.openRead", async ([filePath]) => {
      const opened = (await this.callCtx(
        "desktop.local.fs.openRead",
        String(filePath),
      )) as { stream: NodeReadable; size: number };
      const port = endpoint.openStream();
      const source = opened.stream;
      this.track(source, port);
      pump(source, port);
      source.on("end", () => port.end());
      source.on("error", (error: Error) => port.destroy(error));
      port.on("close", () => source.destroy?.());
      return { stream: port, size: opened.size };
    });
    endpoint.handle(
      "desktop.local.fs.openDownload",
      async ([options, input]) => {
        if (!(input instanceof StreamPort)) {
          throw new SandboxError(
            "A download needs its stream",
            "SANDBOX_VALUE",
          );
        }
        const download = (await this.callCtx(
          "desktop.local.fs.openDownload",
          plainObject(options),
        )) as {
          path: string;
          stream: NodeWritable;
          publish: (o?: unknown) => Promise<string>;
          abort: () => Promise<void>;
        };
        const sink = download.stream;
        const written = new Promise<void>((resolve, reject) => {
          input.on("data", (chunk: Buffer) => {
            if (!sink.write(chunk)) {
              input.pause();
              sink.once("drain", () => input.resume());
            }
          });
          input.on("end", () => sink.end());
          input.on("error", (error: Error) => {
            sink.destroy?.(error);
            reject(error);
          });
          sink.on("finish", () => resolve());
          sink.on("error", (error: Error) => reject(error));
        });
        written.catch(() => {});
        return {
          path: download.path,
          publish: async (publishOptions?: unknown) => {
            await written;
            const opts = plainObject(publishOptions);
            return download.publish(
              typeof opts.overwrite === "boolean"
                ? { overwrite: opts.overwrite }
                : undefined,
            );
          },
          abort: async () => {
            input.destroy();
            await download.abort();
          },
        };
      },
    );
    endpoint.handle("desktop.local.pty.spawn", async ([options]) => {
      const pty = (await this.callCtx(
        "desktop.local.pty.spawn",
        plainObject(options),
      )) as {
        pid: number;
        shell: string;
        write: (data: string) => void;
        resize: (cols: number, rows: number) => void;
        kill: () => void;
        onData: (fn: (data: string) => void) => () => void;
        onExit: (fn: (code: number) => void) => () => void;
      };
      const port = endpoint.openStream();
      const offData = pty.onData((data) => {
        if (!port.destroyed) port.write({ d: data, b: false });
      });
      const offExit = pty.onExit((code) => {
        port.endMeta = { code };
        port.end();
      });
      port.on("data", (chunk: { d?: unknown }) => {
        if (typeof chunk?.d === "string") pty.write(chunk.d);
      });
      port.on("close", () => {
        offData();
        offExit();
      });
      return {
        pid: pty.pid,
        shell: pty.shell,
        stream: port,
        resize: (cols: unknown, rows: unknown) =>
          pty.resize(Number(cols), Number(rows)),
        kill: () => pty.kill(),
      };
    });

    if (typeof ctx.fetch === "function") {
      endpoint.handle("ctx.fetch", async ([url, init]) => {
        // A signal from the child arrives as plain data, not an AbortSignal.
        const { signal: _signal, ...rest } = plainObject(init);
        const response = await ctx.fetch!(String(url), rest);
        const body = new Uint8Array(await response.arrayBuffer());
        const headers: Record<string, string> = {};
        response.headers.forEach((value: string, key: string) => {
          headers[key] = value;
        });
        return {
          status: response.status,
          statusText: response.statusText,
          headers,
          body,
          url: response.url,
        };
      });
    }

    // Service handles resolve their methods when called, so core keeps the
    // handle and the plugin calls methods on it by name.
    endpoint.handle("services.get", ([service, options]) => {
      // One handle per service and options: plugins ask on every request.
      const key = JSON.stringify([String(service), plainObject(options)]);
      const known = this.serviceRefs.get(key);
      if (known && this.refs.has(known)) return { $svc: known };
      const handle = ctx.services.get(String(service), plainObject(options));
      const id = this.addRef("service", handle);
      this.serviceRefs.set(key, id);
      return { $svc: id };
    });
    endpoint.handle("services.call", async ([id, method, args]) => {
      const name = String(method);
      if (!/^[A-Za-z_$][\w$]*$/.test(name) || name === "asUser") {
        throw new Error(`Service method ${name} is not available`);
      }
      const handle = this.ref<Record<string, AnyFn | undefined>>(id, "service");
      const fn = handle[name];
      if (typeof fn !== "function") {
        throw new SandboxError(
          `The service has no method ${name}`,
          "SERVICE_METHOD_MISSING",
          404,
        );
      }
      return await fn(...(Array.isArray(args) ? args : []));
    });
    endpoint.handle("services.asUser", ([id, userId]) => {
      const key = JSON.stringify(["asUser", String(id), String(userId)]);
      const known = this.serviceRefs.get(key);
      if (known && this.refs.has(known)) return { $svc: known };
      const handle = this.ref<{ asUser: (u: string) => unknown }>(
        id,
        "service",
      );
      const next = this.addRef("service", handle.asUser(String(userId)));
      this.serviceRefs.set(key, next);
      return { $svc: next };
    });

    endpoint.handle("audit.exportBatches.open", ([filters]) => {
      const iterator = ctx.audit.exportBatches(plainObject(filters));
      return this.addRef("iterator", iterator);
    });
    endpoint.handle("audit.exportBatches.next", async ([id]) => {
      const iterator = this.ref<AsyncGenerator<unknown>>(id, "iterator");
      const next = await iterator.next();
      if (next.done) this.refs.delete(String(id));
      return { done: !!next.done, value: next.done ? undefined : next.value };
    });
    endpoint.handle("audit.exportBatches.close", async ([id]) => {
      const entry = this.refs.get(String(id));
      this.refs.delete(String(id));
      await (entry?.obj as AsyncGenerator<unknown> | undefined)?.return?.(
        undefined,
      );
      return true;
    });

    endpoint.handle("log", ([level, message]) => {
      const text = String(message).slice(0, 4000);
      const write = (ctx.log as Record<string, AnyFn>)[String(level)];
      if (typeof write === "function" && level !== "error") write(text);
      else ctx.log.error(text, undefined);
      return true;
    });
  }

  private guardSql(sql: string): void {
    const verdict = checkPluginSql(
      sql,
      { own: this.ownTables, readOnly: this.refTables },
      this.dialect,
    );
    if (!verdict.ok) {
      this.log(`[sandbox] ${this.pluginId} sql refused: ${verdict.reason}`);
      throw new SandboxError(
        `Query refused: ${verdict.reason}`,
        "SANDBOX_SQL",
        400,
      );
    }
  }

  private async openSocket(
    path: string,
    connection: WsConnection,
  ): Promise<void> {
    const token = this.tokens.mint({
      pluginId: this.pluginId,
      userId: connection.userId ?? "",
      sessionId: getActorSessionId(),
      trail: getActorTrail(),
      kind: "socket",
      ttlMs: SOCKET_TOKEN_MS,
    });
    const ws = connection.socket;
    const port = this.endpoint.openStream();
    this.sockets.set(port.sid, ws);
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      this.tokens.touch(token, SOCKET_TOKEN_MS);
      this.touch();
      if (!port.write({ d: isBinary ? data : data.toString(), b: isBinary })) {
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
          if (ws.bufferedAmount < 256 * 1024 || ws.readyState !== ws.OPEN) {
            clearInterval(check);
            port.resume();
          }
        }, 10);
      }
    });
    port.on(
      "remote-end",
      (meta: { code?: number; reason?: string } | undefined) => {
        if (ws.readyState === ws.OPEN) {
          ws.close(
            validCloseCode(meta?.code),
            String(meta?.reason ?? "").slice(0, 120),
          );
        }
      },
    );
    port.on("error", () => {
      if (ws.readyState === ws.OPEN) ws.close(1011);
    });
    ws.on("close", (code: number, reason: Buffer) => {
      this.sockets.delete(port.sid);
      port.endMeta = { code, reason: reason.toString() };
      port.end();
      this.tokens.revoke(token);
    });
    ws.on("error", () => port.destroy());
    let unlocked = true;
    try {
      unlocked = (await connection.isDataUnlocked?.()) !== false;
    } catch {
      unlocked = true;
    }
    await this.endpoint.callWithToken(token, "ws.open", [
      path,
      {
        userId: connection.userId ?? "",
        clientIp: connection.clientIp,
        requestOrigin: connection.requestOrigin,
        request: {
          url: connection.request?.url,
          headers: safeHeaders(connection.request?.headers ?? {}),
        },
        unlocked,
      },
      port,
    ]);
  }

  private async openRawUpgrade(
    path: string,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    userId: string,
  ): Promise<void> {
    const token = this.tokens.mint({
      pluginId: this.pluginId,
      userId: userId ?? "",
      sessionId: getActorSessionId(),
      trail: getActorTrail(),
      kind: "socket",
      ttlMs: SOCKET_TOKEN_MS,
    });
    const port = this.endpoint.openStream();
    pump(socket as unknown as NodeReadable, port);
    port.on("data", (chunk: Uint8Array) => {
      if (!socket.write(chunk)) {
        port.pause();
        socket.once("drain", () => port.resume());
      }
    });
    port.on("remote-end", () => socket.end());
    port.on("error", () => socket.destroy());
    socket.on("end", () => port.end());
    socket.on("close", () => {
      port.destroy();
      this.tokens.revoke(token);
    });
    socket.on("error", () => port.destroy());
    try {
      await this.endpoint.callWithToken(token, "ws.upgrade", [
        path,
        {
          method: request.method,
          url: request.url,
          headers: safeHeaders(request.headers as Record<string, unknown>),
          httpVersion: request.httpVersion,
        },
        port,
        new Uint8Array(head),
        userId ?? "",
      ]);
    } catch {
      socket.destroy();
    }
  }

  private watchTcp(id: string, client: SshClientLike): void {
    if (this.tcpWatched.has(id)) return;
    this.tcpWatched.add(id);
    client.on(
      "tcp connection",
      (info: unknown, accept: () => Duplex, reject: () => void) => {
        if (this.closed || !this.refs.has(id)) {
          reject();
          return;
        }
        const tid = `tcp${this.nextRef++}`;
        const timer = setTimeout(() => {
          this.pendingTcp.delete(tid);
          reject();
        }, TCP_ANSWER_MS);
        timer.unref?.();
        this.pendingTcp.set(tid, { accept, reject, timer });
        this.endpoint.notify("ssh.tcpConnection", [id, plainConfig(info), tid]);
      },
    );
  }

  private watchClient(id: string, client: unknown): void {
    const emitter = client as { once?: (e: string, fn: AnyFn) => void };
    emitter.once?.("close", () => {
      if (!this.refs.has(id)) return;
      this.refs.delete(id);
      if (!this.closed) this.endpoint.notify("ssh.closed", [id]);
    });
  }

  private openChannel(
    id: unknown,
    kind: "exec" | "shell",
    args: unknown[],
  ): Promise<unknown> {
    const client = this.ref<Record<string, AnyFn>>(id, "client");
    const endpoint = this.endpoint;
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
    if (this.closed) {
      res.status(503).json({ error: "This feature is not available" });
      return;
    }
    this.touch();
    const endpoint = this.endpoint;
    const cookiePrefix = pluginCookiePrefix(this.pluginId);
    const token = this.mintForCurrentActor();
    const live = { req, res, handedOff: false };
    this.liveRequests.set(token, live);
    const port = endpoint.openStream();
    let headSent = false;
    port.on(
      "data",
      (
        chunk:
          | Uint8Array
          | { h: { status: number; headers: Record<string, unknown> } },
      ) => {
        if (live.handedOff) return;
        if (!(chunk instanceof Uint8Array) && "h" in chunk) {
          if (res.headersSent) return;
          res.status(validStatus(chunk.h.status));
          for (const [key, value] of Object.entries(chunk.h.headers ?? {})) {
            if (key.toLowerCase() === "set-cookie") {
              const own = ownSetCookies(value, cookiePrefix);
              if (own.length) res.append("Set-Cookie", own);
              continue;
            }
            if (value === undefined || !isSafeHeaderName(key)) continue;
            res.setHeader(key, value as string);
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
    const ended = new Promise<void>((resolve) => {
      port.on("end", resolve);
      port.on("close", resolve);
    });
    res.on("close", () => port.destroy());

    // A body core did not parse (multipart, rawBody routes) is streamed.
    let bodyPort: StreamPort | undefined;
    const parsed = req.body !== undefined && !this.routerRaw;
    if (!parsed && req.readable && !req.readableEnded) {
      bodyPort = endpoint.openStream();
      const body = bodyPort;
      pump(req as unknown as NodeReadable, body);
      req.on("end", () => body.end());
      req.on("error", () => body.destroy());
    }

    try {
      const outcome = (await endpoint.callWithToken(token, "http.dispatch", [
        {
          method: req.method,
          url: req.url,
          originalUrl: req.originalUrl,
          headers: this.requestHeaders(req, cookiePrefix),
          body: parsed ? req.body : undefined,
          ip: req.ip,
          userId: (req as Request & { userId?: string }).userId ?? "",
          baseUrl: this.safeBaseUrl(req),
        },
        port,
        bodyPort,
      ])) as { next?: boolean };
      if (outcome?.next) {
        port.destroy();
        next();
        return;
      }
      await ended;
      // completeRedirectLogin already answered on the live response.
      if (live.handedOff) return;
      if (!headSent && !res.headersSent) res.status(204);
      res.end();
    } catch (error) {
      port.destroy();
      bodyPort?.destroy();
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
      } else next(error);
    } finally {
      this.liveRequests.delete(token);
      this.releaseLater(token);
    }
  }

  private requestHeaders(
    req: Request,
    cookiePrefix: string,
  ): Record<string, unknown> {
    const headers = safeHeaders(req.headers as Record<string, unknown>);
    const own = ownCookieHeader(req.headers.cookie, cookiePrefix);
    if (own) headers.cookie = own;
    return headers;
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

type RefKind =
  "client" | "sftp" | "channel" | "iterator" | "service" | "prepared";

interface SshClientLike {
  forwardIn: (host: string, port: number, cb: AnyFn) => void;
  unforwardIn: (host: string, port: number, cb: AnyFn) => void;
  on: (event: string, fn: AnyFn) => void;
}

interface PreparedEntry {
  verify: AnyFn | null;
  client: StandInClient;
}

/** A jump host prompt from the plugin: only its ask function crosses back. */
function promptOption(value: unknown): { prompt?: { ask: AnyFn } } {
  const prompt = plainObject(value);
  return typeof prompt.ask === "function"
    ? { prompt: { ask: prompt.ask as AnyFn } }
    : {};
}

function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(plainObject(value))) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

interface SpecialCtx {
  http: {
    router: (o: unknown) => Router;
    baseUrl: (req: unknown) => string;
  };
  ws: {
    route: (p: string, h: AnyFn, o: unknown) => void;
    upgrade: (p: string, h: AnyFn, o: unknown) => void;
  };
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
  services: { get: (service: string, options: unknown) => object };
  fetch?: (url: string, init?: unknown) => Promise<globalThis.Response>;
  audit: { exportBatches: (filters: unknown) => AsyncGenerator<unknown> };
  log: { error: (message: string, error: unknown) => void };
}

interface WsConnection {
  userId: string;
  socket: import("ws").WebSocket;
  request: { url?: string; headers?: Record<string, unknown> };
  clientIp: string;
  requestOrigin: string;
  isDataUnlocked?: () => boolean | Promise<boolean>;
}

const ROUTE_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "all",
  "use",
  "head",
  "options",
]);

const SFTP_METHODS = new Set([
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
]);

function validStatus(status: unknown): number {
  const n = Number(status);
  return Number.isInteger(n) && n >= 100 && n <= 599 ? n : 500;
}

/** Codes a server may send in a close frame (RFC 6455 and the IANA list). */
export function validCloseCode(code: unknown): number {
  const n = Number(code);
  if (!Number.isInteger(n)) return 1000;
  if ((n >= 1000 && n <= 1003) || (n >= 1007 && n <= 1014)) return n;
  return n >= 3000 && n <= 4999 ? n : 1000;
}

/** Set-Cookie and friends stay with core's own routes. */
function isSafeHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    /^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(lower) &&
    lower !== "set-cookie" &&
    lower !== "set-cookie2"
  );
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Arguments to ssh2 methods: data only, never a function from the plugin. */
function plainArg(value: unknown): unknown {
  return typeof value === "function" ? undefined : value;
}

interface NodeReadable {
  on(e: string, fn: AnyFn): void;
  pause(): void;
  resume(): void;
  destroy?: () => void;
}

interface NodeWritable {
  write(chunk: Uint8Array): boolean;
  end(): void;
  once(e: string, fn: AnyFn): void;
  on(e: string, fn: AnyFn): void;
  destroy?: (error?: Error) => void;
}

interface NodeChannel {
  write(chunk: Uint8Array): boolean;
  end(): void;
  once(event: string, fn: AnyFn): void;
  on(event: string, fn: AnyFn): void;
  pause(): void;
  resume(): void;
  stderr: NodeReadable;
}

/** Moves a readable into a port and pauses it when the other side has no credit. */
function pump(source: NodeReadable, port: StreamPort): void {
  source.on("data", (chunk: Buffer) => {
    if (!port.write(chunk)) {
      source.pause();
      port.once("drain", () => source.resume());
    }
  });
}

function plainStats(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map(plainStats);
  const stats = value as Record<string, unknown> & {
    isDirectory?: () => boolean;
    isFile?: () => boolean;
    isSymbolicLink?: () => boolean;
  };
  const plain: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(stats)) {
    if (typeof item === "function") continue;
    plain[key] = key === "attrs" ? plainStats(item) : item;
  }
  if (typeof stats.isDirectory === "function") {
    plain.$stats = {
      dir: stats.isDirectory(),
      file: stats.isFile?.() ?? false,
      link: stats.isSymbolicLink?.() ?? false,
    };
  }
  return plain;
}

export function sandboxLog(pluginId: string, line: string): void {
  pluginLogger.info(line, { operation: "plugin_sandbox", pluginId });
}
