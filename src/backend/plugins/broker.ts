/**
 * The main-thread half of the plugin boundary.
 *
 * Every ctx call a plugin makes arrives here as a message. For each one the
 * broker, in this order:
 *   1. looks up the method
 *   2. checks the plugin's granted capability (manifest-declared AND granted)
 *   3. performs the real action
 *   4. writes one audit line attributed to the plugin
 *   5. replies with a structured-cloneable value
 *
 * Steps 2 and 4 are not the plugin's to influence. The plugin supplies only the
 * arguments and the audit `details`; the actor, action and outcome are set from
 * values the broker controls, so a plugin cannot forge an audit trail or
 * attribute its actions to a user.
 */

import type { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { pluginLogger } from "../utils/logger.js";
import { getAuditUsername, logAudit } from "../utils/audit-logger.js";
import type { LoadedPlugin } from "./loader.js";
import { assertCapability, PluginPermissionError } from "./permissions.js";
import { toPluginHostView, type PluginHostView } from "./host-view.js";
import { pluginEvents } from "./events.js";
import {
  isPluginRequest,
  isPluginResponse,
  type PluginPush,
  type PluginRequest,
  type PluginResponse,
} from "./protocol.js";

export interface PluginStorageBackend {
  get: (pluginId: string, key: string) => Promise<string | null>;
  set: (pluginId: string, key: string, value: string) => Promise<void>;
  delete: (pluginId: string, key: string) => Promise<boolean>;
  listKeys: (pluginId: string) => Promise<string[]>;
}

export interface BrokerDeps {
  /**
   * Injected rather than imported so tests can exercise the gate without a
   * database, and so the heavy hosts modules stay lazily reachable.
   */
  listHosts: (userId: string) => Promise<Record<string, unknown>[]>;
  resolveHost: (
    hostId: number,
    userId: string,
  ) => Promise<Record<string, unknown> | null>;
  storage?: PluginStorageBackend;
  /** Fired when a plugin's route table changes, so it can be re-mounted. */
  onRoutesChanged?: (runtime: PluginRuntime) => void;
  ssh?: PluginSshBackend;
}

/**
 * The SSH operations the broker performs on a plugin's behalf.
 *
 * Note what is NOT here: there is no "get me the host" and no "give me the
 * client". A plugin's reachable surface is open-a-session and run-a-command,
 * both of which take an opaque handle. The resolved host, which carries
 * plaintext credentials, only ever exists inside these functions.
 */
export interface PluginSshBackend {
  open: (
    hostId: number,
    userId: string,
  ) => Promise<{ release: () => void; exec: SshExec }>;
}

export type SshExec = (
  command: string,
  timeoutMs: number,
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

/** ctx.storage caps, so one plugin cannot fill the database. */
const MAX_STORAGE_KEY_LENGTH = 128;
const MAX_STORAGE_VALUE_BYTES = 256 * 1024;
const MIN_SCHEDULE_INTERVAL_MS = 1000;
const HTTP_HANDLER_TIMEOUT_MS = 30_000;
/** Short: a disable should feel immediate even when a plugin is unresponsive. */
const DEACTIVATE_TIMEOUT_MS = 5_000;
const MAX_SSH_HANDLES = 8;
const DEFAULT_SSH_EXEC_TIMEOUT_MS = 30_000;
const MAX_SSH_EXEC_TIMEOUT_MS = 120_000;
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

interface PendingHttpRoute {
  method: string;
  path: string;
}

export interface PluginRuntime {
  plugin: LoadedPlugin;
  worker: Worker;
  /** Routes the plugin registered via ctx.http.route. */
  routes: PendingHttpRoute[];
  /** Topics the plugin subscribed to via ctx.events.on. */
  subscriptions: Set<string>;
  /** Bus unsubscribe functions, run on detach so no listener outlives it. */
  eventUnsubscribers: Array<() => void>;
  /** ctx.schedule timers, cleared on deactivate. */
  timers: Map<string, NodeJS.Timeout>;
  /** Live SSH handles, keyed by the opaque id the worker holds. */
  sshHandles: Map<
    string,
    { hostId: number; release: () => void; exec?: SshExec }
  >;
  disposed: boolean;
}

/** Methods that need a granted capability before the broker will run them. */
const REQUIRED_CAPABILITY: Record<string, string> = {
  "hosts.list": "hosts.read",
  "hosts.get": "hosts.read",
  "ssh.connect": "ssh.exec",
  "ssh.exec": "ssh.exec",
  "storage.get": "storage.own",
  "storage.set": "storage.own",
  "storage.delete": "storage.own",
  "storage.list": "storage.own",
  "events.subscribe": "events.read",
};

/** Methods whose invocation is worth an audit line. */
const AUDITED = new Set(Object.keys(REQUIRED_CAPABILITY));

export class PluginBroker {
  private readonly runtimes = new Map<string, PluginRuntime>();
  /** Outstanding route invocations, keyed by the push id sent to the worker. */
  private readonly httpWaiters = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  /**
   * Push ids start high so they cannot collide with the worker's own request
   * ids, which start at 1 and count up independently.
   */
  private nextPushId = 1_000_000;

  constructor(private readonly deps: BrokerDeps) {}

  get(pluginId: string): PluginRuntime | undefined {
    return this.runtimes.get(pluginId);
  }

  /** Wired to PluginLoader's onWorkerReady hook. */
  attach(plugin: LoadedPlugin, worker: Worker): PluginRuntime {
    this.detach(plugin.id);

    const runtime: PluginRuntime = {
      plugin,
      worker,
      routes: [],
      subscriptions: new Set(),
      eventUnsubscribers: [],
      timers: new Map(),
      sshHandles: new Map(),
      disposed: false,
    };
    this.runtimes.set(plugin.id, runtime);

    worker.on("message", (message: unknown) => {
      if (isPluginRequest(message)) {
        void this.dispatch(runtime, message);
        return;
      }
      // A route handler's reply comes back shaped like a response.
      if (isPluginResponse(message)) this.settleHttpReply(message);
    });

    return runtime;
  }

  /** Wired to PluginLoader's onWorkerGone hook. Releases everything. */
  detach(pluginId: string): void {
    const runtime = this.runtimes.get(pluginId);
    if (!runtime) return;

    runtime.disposed = true;
    for (const timer of runtime.timers.values()) clearInterval(timer);
    runtime.timers.clear();

    for (const handle of runtime.sshHandles.values()) {
      try {
        handle.release();
      } catch {
        // Releasing a dead connection is not worth failing over.
      }
    }
    runtime.sshHandles.clear();

    for (const unsubscribe of runtime.eventUnsubscribers) {
      try {
        unsubscribe();
      } catch {
        // Already detached.
      }
    }
    runtime.eventUnsubscribers = [];
    runtime.subscriptions.clear();
    this.runtimes.delete(pluginId);
  }

  private settleHttpReply(message: PluginResponse): void {
    const waiter = this.httpWaiters.get(message.id);
    if (!waiter) return;
    this.httpWaiters.delete(message.id);

    if (message.ok === true) waiter.resolve(message.value);
    else waiter.reject(new Error(message.error.message));
  }

  private async dispatch(
    runtime: PluginRuntime,
    request: PluginRequest,
  ): Promise<void> {
    const { method, args } = request;
    let failure: Error | null = null;

    try {
      const required = REQUIRED_CAPABILITY[method];
      if (required) {
        await assertCapability(
          runtime.plugin.id,
          required,
          runtime.plugin.manifest.permissions,
        );
      }

      const value = await this.invoke(runtime, method, args);
      this.reply(runtime, { id: request.id, ok: true, value });
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      this.reply(runtime, {
        id: request.id,
        ok: false,
        error: {
          // Sanitised, never the raw message: errors thrown deep in the SSH
          // stack can embed the connect config, credentials included.
          message: safeErrorMessage(method, failure),
          code: (failure as Error & { code?: string }).code,
        },
      });
    }

    if (AUDITED.has(method)) {
      void this.audit(runtime, method, args, failure);
    }
  }

  private reply(runtime: PluginRuntime, message: unknown): void {
    if (runtime.disposed) return;
    try {
      runtime.worker.postMessage(message);
    } catch {
      // Worker already gone; the reply has nowhere to land.
    }
  }

  private async invoke(
    runtime: PluginRuntime,
    method: string,
    args: unknown[],
  ): Promise<unknown> {
    switch (method) {
      case "log.debug":
      case "log.info":
      case "log.warn":
      case "log.error":
        return this.handleLog(runtime, method, args);

      case "audit":
        // The audit line is written by the caller path below; nothing to do
        // here beyond accepting the call.
        return null;

      case "hosts.list":
        return this.handleHostsList(runtime);

      case "hosts.get":
        return this.handleHostsGet(runtime, Number(args[0]));

      case "storage.get":
        return this.handleStorageGet(runtime, storageKey(args[0]));

      case "storage.set":
        return this.handleStorageSet(runtime, args);

      case "storage.delete":
        return this.storage().delete(runtime.plugin.id, storageKey(args[0]));

      case "storage.list":
        return this.storage().listKeys(runtime.plugin.id);

      case "schedule.every":
        return this.handleScheduleEvery(runtime, Number(args[0]));

      case "schedule.cancel":
        return this.handleScheduleCancel(runtime, String(args[0]));

      case "http.route":
        return this.handleHttpRoute(runtime, String(args[0]), String(args[1]));

      case "ssh.connect":
        return this.handleSshConnect(runtime, Number(args[0]));

      case "ssh.exec":
        return this.handleSshExec(
          runtime,
          String(args[0]),
          String(args[1]),
          args[2] === undefined ? undefined : Number(args[2]),
        );

      case "ssh.close":
        return this.handleSshClose(runtime, String(args[0]));

      case "events.emit":
        return this.handleEventsEmit(runtime, String(args[0]), args[1]);

      case "events.subscribe":
        return this.handleEventsSubscribe(runtime, String(args[0]));

      default:
        throw new PluginFacingError(`Unknown ctx method "${method}"`);
    }
  }

  private handleLog(
    runtime: PluginRuntime,
    method: string,
    args: unknown[],
  ): null {
    const level = method.slice("log.".length) as
      "debug" | "info" | "warn" | "error";
    const message = String(args[0] ?? "");
    // Forced context: a plugin cannot pretend to be another plugin in the log.
    const context = { operation: `plugin:${runtime.plugin.id}` };

    if (level === "error") {
      pluginLogger.error(message, undefined, context);
    } else {
      pluginLogger[level](message, context);
    }
    return null;
  }

  private async handleHostsList(
    runtime: PluginRuntime,
  ): Promise<PluginHostView[]> {
    const userId = this.requireOwner(runtime);
    const hosts = await this.deps.listHosts(userId);
    return hosts.map(toPluginHostView);
  }

  private async handleHostsGet(
    runtime: PluginRuntime,
    hostId: number,
  ): Promise<PluginHostView | null> {
    const userId = this.requireOwner(runtime);
    if (!Number.isFinite(hostId)) {
      throw new PluginFacingError("hosts.get requires a numeric host id");
    }

    const host = await this.deps.resolveHost(hostId, userId);
    // resolveHostById returns null for both "missing" and "no access", and the
    // plugin gets the same answer for both so it cannot probe for existence.
    return host ? toPluginHostView(host) : null;
  }

  private storage(): PluginStorageBackend {
    if (!this.deps.storage) {
      throw new PluginFacingError(
        "ctx.storage is not available in this runtime",
      );
    }
    return this.deps.storage;
  }

  private async handleStorageGet(
    runtime: PluginRuntime,
    key: string,
  ): Promise<unknown> {
    const raw = await this.storage().get(runtime.plugin.id, key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      // A row written by an older shape should not break the plugin.
      return null;
    }
  }

  private async handleStorageSet(
    runtime: PluginRuntime,
    args: unknown[],
  ): Promise<null> {
    const key = storageKey(args[0]);
    // Serialised here rather than in the worker so the stored shape is the
    // broker's decision, not something a plugin can control.
    const value = JSON.stringify(args[1] ?? null);

    if (Buffer.byteLength(value, "utf8") > MAX_STORAGE_VALUE_BYTES) {
      throw new PluginFacingError(
        `ctx.storage value for "${key}" exceeds the ${MAX_STORAGE_VALUE_BYTES} byte limit`,
      );
    }

    await this.storage().set(runtime.plugin.id, key, value);
    return null;
  }

  private handleScheduleEvery(
    runtime: PluginRuntime,
    intervalMs: number,
  ): string {
    if (!Number.isFinite(intervalMs) || intervalMs < MIN_SCHEDULE_INTERVAL_MS) {
      throw new PluginFacingError(
        `ctx.schedule.every requires an interval of at least ${MIN_SCHEDULE_INTERVAL_MS}ms`,
      );
    }

    const id = `timer:${randomUUID()}`;
    const timer = setInterval(() => {
      if (runtime.disposed) return;
      this.push(runtime, { kind: "timer", key: id, payload: null });
    }, intervalMs);

    // A plugin timer must not keep the server alive on its own.
    timer.unref?.();
    runtime.timers.set(id, timer);
    return id;
  }

  private handleScheduleCancel(runtime: PluginRuntime, id: string): null {
    const timer = runtime.timers.get(id);
    if (timer) {
      clearInterval(timer);
      runtime.timers.delete(id);
    }
    return null;
  }

  /**
   * Opens a pooled connection and returns an opaque handle.
   *
   * The handle is a random id, not anything derived from the host or its
   * credentials, and it is only meaningful inside this runtime's own map. The
   * ssh2 Client and the resolved host never enter a postMessage payload.
   */
  private async handleSshConnect(
    runtime: PluginRuntime,
    hostId: number,
  ): Promise<string> {
    const userId = this.requireOwner(runtime);
    if (!Number.isFinite(hostId)) {
      throw new PluginFacingError("ssh.connect requires a numeric host id");
    }
    if (!this.deps.ssh) {
      throw new PluginFacingError("ctx.ssh is not available in this runtime");
    }
    if (runtime.sshHandles.size >= MAX_SSH_HANDLES) {
      throw new PluginFacingError(
        `ctx.ssh is limited to ${MAX_SSH_HANDLES} concurrent connections per plugin`,
      );
    }

    const session = await this.deps.ssh.open(hostId, userId);
    const id = `sshconn:${randomUUID()}`;
    runtime.sshHandles.set(id, {
      hostId,
      release: session.release,
      exec: session.exec,
    });
    return id;
  }

  private async handleSshExec(
    runtime: PluginRuntime,
    handleId: string,
    command: string,
    timeoutMs?: number,
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const handle = runtime.sshHandles.get(handleId);
    // An unknown handle is indistinguishable from another plugin's handle:
    // the map is per-runtime, so ids cannot be guessed across plugins.
    if (!handle?.exec) {
      throw new PluginFacingError("Unknown or closed SSH connection handle");
    }
    if (!command) throw new PluginFacingError("ssh.exec requires a command");

    const timeout =
      timeoutMs && Number.isFinite(timeoutMs)
        ? Math.min(timeoutMs, MAX_SSH_EXEC_TIMEOUT_MS)
        : DEFAULT_SSH_EXEC_TIMEOUT_MS;

    return handle.exec(command, timeout);
  }

  private handleSshClose(runtime: PluginRuntime, handleId: string): null {
    const handle = runtime.sshHandles.get(handleId);
    if (!handle) return null;

    runtime.sshHandles.delete(handleId);
    try {
      handle.release();
    } catch {
      // Releasing a dead connection is not worth failing over.
    }
    return null;
  }

  /**
   * A plugin may only emit under its own namespace. Without this a plugin
   * could publish "host.status" and drive the automations engine as though the
   * metrics poller had reported it.
   */
  private handleEventsEmit(
    runtime: PluginRuntime,
    topic: string,
    payload: unknown,
  ): null {
    const prefix = `plugin.${runtime.plugin.id}.`;
    if (!topic.startsWith(prefix)) {
      throw new PluginFacingError(
        `ctx.events.emit may only publish topics beginning with "${prefix}"`,
      );
    }

    pluginEvents.emit(topic, payload);
    return null;
  }

  private handleEventsSubscribe(runtime: PluginRuntime, topic: string): null {
    if (runtime.subscriptions.has(topic)) return null;
    runtime.subscriptions.add(topic);

    const unsubscribe = pluginEvents.on(topic, (payload) => {
      this.push(runtime, { kind: "event", key: topic, payload });
    });
    runtime.eventUnsubscribers.push(unsubscribe);
    return null;
  }

  private handleHttpRoute(
    runtime: PluginRuntime,
    method: string,
    routePath: string,
  ): null {
    const verb = method.toUpperCase();
    if (!HTTP_METHODS.has(verb)) {
      throw new PluginFacingError(
        `ctx.http.route does not support the ${verb} method`,
      );
    }
    if (!routePath.startsWith("/")) {
      throw new PluginFacingError(`ctx.http.route path must start with "/"`);
    }

    const key = `${verb} ${routePath}`;
    if (
      !runtime.routes.some((route) => `${route.method} ${route.path}` === key)
    ) {
      runtime.routes.push({ method: verb, path: routePath });
    }

    this.deps.onRoutesChanged?.(runtime);
    return null;
  }

  /**
   * Invoked by the Express router this plugin's routes are mounted behind.
   * Forwards the request into the worker and waits for the handler's reply.
   */
  invokeRoute(
    runtime: PluginRuntime,
    key: string,
    payload: unknown,
    timeoutMs = HTTP_HANDLER_TIMEOUT_MS,
  ): Promise<unknown> {
    if (runtime.disposed) {
      return Promise.reject(new Error("Plugin is not running"));
    }

    const replyTo = this.nextPushId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.httpWaiters.delete(replyTo);
        reject(new Error("Plugin route handler timed out"));
      }, timeoutMs);

      this.httpWaiters.set(replyTo, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.push(runtime, { kind: "http", key, payload, replyTo });
    });
  }

  /**
   * Gives a worker plugin a chance to close things down before it is killed.
   * Resolves either way: a plugin that does not answer must not block the
   * disable, it just loses its cleanup.
   */
  requestDeactivate(
    runtime: PluginRuntime,
    timeoutMs = DEACTIVATE_TIMEOUT_MS,
  ): Promise<void> {
    if (runtime.disposed) return Promise.resolve();

    const replyTo = this.nextPushId++;

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.httpWaiters.delete(replyTo);
        resolve();
      }, timeoutMs);

      const settle = () => {
        clearTimeout(timer);
        resolve();
      };

      this.httpWaiters.set(replyTo, { resolve: settle, reject: settle });
      this.push(runtime, {
        kind: "deactivate",
        key: "deactivate",
        payload: null,
        replyTo,
      });
    });
  }

  /** Main thread -> worker, for events, timers and route invocations. */
  push(runtime: PluginRuntime, message: PluginPush): void {
    if (runtime.disposed) return;
    try {
      runtime.worker.postMessage(message);
    } catch {
      // Worker already gone.
    }
  }

  private requireOwner(runtime: PluginRuntime): string {
    const userId = runtime.plugin.ownerUserId;
    if (!userId) {
      throw new PluginFacingError(
        `Plugin ${runtime.plugin.id} has no owning user, so it cannot act on user data`,
      );
    }
    return userId;
  }

  private async audit(
    runtime: PluginRuntime,
    method: string,
    args: unknown[],
    failure: Error | null,
  ): Promise<void> {
    const userId = runtime.plugin.ownerUserId;
    if (!userId) return;

    // Attribution comes from the broker, never from the plugin: username is
    // the plugin id, not the user's, so a plugin action is never mistaken for
    // something the person did themselves.
    await logAudit({
      userId,
      username: `plugin:${runtime.plugin.id}`,
      action: `plugin_${method.replace(/\./g, "_")}`,
      resourceType: "plugin",
      resourceId: runtime.plugin.id,
      resourceName: runtime.plugin.manifest.name,
      details: safeDetails(method, args),
      success: failure === null,
      errorMessage: failure?.message,
    });
  }

  /** Resolves the display name for a plugin's owner, for UI surfaces. */
  async ownerUsername(pluginId: string): Promise<string | null> {
    const runtime = this.runtimes.get(pluginId);
    if (!runtime?.plugin.ownerUserId) return null;
    return getAuditUsername(runtime.plugin.ownerUserId);
  }

  newHandleId(): string {
    return `sshconn:${randomUUID()}`;
  }
}

/**
 * Audit details are capped and only ever record the shape of a call, never a
 * value a plugin passed. A plugin could otherwise write arbitrary volume, or
 * something that looks like a real audit entry, into the trail.
 */
/**
 * Errors the broker raises itself are safe to show a plugin: they are written
 * here and say nothing about credentials. Anything else came from deeper in the
 * server -- ssh2, the pool, a repository -- and can carry connect config,
 * decrypted material or internal paths, so the plugin gets a generic message
 * and the real one goes to the log.
 *
 * Marker class rather than message matching: a substring check would start
 * leaking the moment an upstream error happened to contain a familiar phrase.
 */
export class PluginFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginFacingError";
  }
}

function safeErrorMessage(method: string, error: Error): string {
  if (error instanceof PluginFacingError) return error.message;
  if (error instanceof PluginPermissionError) return error.message;

  pluginLogger.error(`ctx.${method} failed`, error, {
    operation: "plugin_ctx_error",
  });
  return `ctx.${method} failed. See the server log for details.`;
}

function storageKey(raw: unknown): string {
  const key = String(raw ?? "");
  if (!key) throw new PluginFacingError("ctx.storage requires a non-empty key");
  if (key.length > MAX_STORAGE_KEY_LENGTH) {
    throw new PluginFacingError(
      `ctx.storage key exceeds the ${MAX_STORAGE_KEY_LENGTH} character limit`,
    );
  }
  return key;
}

function safeDetails(method: string, args: unknown[]): string {
  const summary = args.map((arg) => {
    if (typeof arg === "number" || typeof arg === "boolean") return arg;
    if (typeof arg === "string") {
      return arg.length > 64 ? `${arg.slice(0, 64)}…` : arg;
    }
    if (arg === null || arg === undefined) return null;
    return Array.isArray(arg) ? `[array:${arg.length}]` : "[object]";
  });

  return JSON.stringify({ method, args: summary });
}

export { PluginPermissionError };
