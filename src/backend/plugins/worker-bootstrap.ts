/**
 * The worker thread's entry point. Runs before any plugin code.
 *
 * Builds the ctx object, imports the plugin's backend/index.mjs, and calls its
 * exported activate(ctx). The plugin gets ctx and nothing else from us -- no
 * db, no fs, no net handle is ever passed in. See loader.ts for an honest
 * account of what that does and does not guarantee.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { parentPort, workerData } from "node:worker_threads";
import type {
  PluginBootstrapData,
  PluginPush,
  PluginResponse,
} from "./protocol.js";
import { isPluginResponse } from "./protocol.js";

const port = parentPort;
if (!port) {
  throw new Error("Plugin worker started without a parent port");
}

const boot = workerData as PluginBootstrapData;

let nextRequestId = 1;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

/** Handlers the plugin registered, keyed the same way the broker pushes them. */
const httpRoutes = new Map<string, (req: unknown) => unknown>();
const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
const timers = new Map<string, () => void>();

/**
 * Tracks which user's HTTP request is currently executing, so a ctx call made
 * anywhere in that request's call stack -- including deep inside plugin code
 * that has no idea this exists -- can be attributed to them without adding a
 * userId parameter to every ctx method.
 *
 * Only entered around an ctx.http.route handler invocation (see handlePush
 * below). A ctx call made from a schedule.every timer or an events.on
 * listener runs outside any run() call, so getStore() correctly returns
 * undefined for those and the broker falls back to the plugin's owner.
 */
const requestActor = new AsyncLocalStorage<{ userId: string }>();

function call(method: string, ...args: unknown[]): Promise<unknown> {
  const id = nextRequestId++;
  const callerUserId = requestActor.getStore()?.userId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    port!.postMessage({
      id,
      method,
      args,
      ...(callerUserId && { callerUserId }),
    });
  });
}

function handleResponse(message: PluginResponse): void {
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);

  if (message.ok === true) {
    waiter.resolve(message.value);
    return;
  }

  const failure = message.error;
  const error = new Error(failure.message);
  if (failure.code) {
    (error as Error & { code?: string }).code = failure.code;
  }
  waiter.reject(error);
}

async function handlePush(push: PluginPush): Promise<void> {
  if (push.kind === "deactivate") {
    // Always acknowledge, even when the plugin has no hook or its hook threw:
    // the main thread is waiting before it terminates us, and a missing reply
    // would just stall that until its timeout.
    try {
      if (pluginDeactivate) await pluginDeactivate();
    } catch {
      // Nothing useful to do here; the worker is about to be terminated.
    }
    if (push.replyTo !== undefined) {
      port!.postMessage({ id: push.replyTo, ok: true, value: null });
    }
    return;
  }

  if (push.kind === "event") {
    const listeners = eventListeners.get(push.key);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(push.payload);
      } catch {
        // A throwing listener must not take down the worker.
      }
    }
    return;
  }

  if (push.kind === "timer") {
    const handler = timers.get(push.key);
    if (handler) {
      try {
        handler();
      } catch {
        // same
      }
    }
    return;
  }

  if (push.kind === "http") {
    const handler = httpRoutes.get(push.key);
    if (push.replyTo === undefined) return;

    if (!handler) {
      port!.postMessage({
        id: push.replyTo,
        ok: false,
        error: { message: `No handler registered for route ${push.key}` },
      });
      return;
    }

    const requestUserId =
      (push.payload as { userId?: string | null } | undefined)?.userId ??
      undefined;

    try {
      const value = await (requestUserId
        ? requestActor.run({ userId: requestUserId }, () =>
            handler(push.payload),
          )
        : handler(push.payload));
      port!.postMessage({ id: push.replyTo, ok: true, value });
    } catch (error) {
      port!.postMessage({
        id: push.replyTo,
        ok: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

port.on("message", (message: unknown) => {
  if (isPluginResponse(message)) {
    handleResponse(message);
    return;
  }
  const push = message as PluginPush;
  if (push && typeof push.kind === "string") {
    void handlePush(push);
  }
});

function notImplemented(name: string) {
  return () =>
    Promise.reject(
      new Error(
        `ctx.${name} is not implemented in plugin SDK version 1. It is reserved and will be added in a later version.`,
      ),
    );
}

const ctx = {
  pluginId: boot.pluginId,
  manifest: boot.manifest,

  log: {
    debug: (message: string, context?: unknown) =>
      call("log.debug", message, context),
    info: (message: string, context?: unknown) =>
      call("log.info", message, context),
    warn: (message: string, context?: unknown) =>
      call("log.warn", message, context),
    error: (message: string, context?: unknown) =>
      call("log.error", message, context),
  },

  audit: (action: string, details?: unknown) => call("audit", action, details),

  hosts: {
    list: () => call("hosts.list"),
    get: (hostId: number) => call("hosts.get", hostId),
  },

  ssh: {
    connect: (hostId: number) => call("ssh.connect", hostId),
    exec: (handle: string, command: string, timeoutMs?: number) =>
      call("ssh.exec", handle, command, timeoutMs),
    close: (handle: string) => call("ssh.close", handle),
  },

  storage: {
    get: (key: string) => call("storage.get", key),
    set: (key: string, value: unknown) => call("storage.set", key, value),
    delete: (key: string) => call("storage.delete", key),
    list: () => call("storage.list"),
  },

  http: {
    route: (
      method: string,
      routePath: string,
      handler: (req: unknown) => unknown,
    ) => {
      const key = `${method.toUpperCase()} ${routePath}`;
      httpRoutes.set(key, handler);
      return call("http.route", method.toUpperCase(), routePath);
    },
  },

  events: {
    emit: (topic: string, payload: unknown) =>
      call("events.emit", topic, payload),
    on: async (topic: string, listener: (payload: unknown) => void) => {
      let listeners = eventListeners.get(topic);
      if (!listeners) {
        listeners = new Set();
        eventListeners.set(topic, listeners);
        await call("events.subscribe", topic);
      }
      listeners.add(listener);
      return () => {
        listeners!.delete(listener);
      };
    },
  },

  schedule: {
    every: async (intervalMs: number, handler: () => void) => {
      const id = (await call("schedule.every", intervalMs)) as string;
      timers.set(id, handler);
      return id;
    },
    cancel: async (id: string) => {
      timers.delete(id);
      await call("schedule.cancel", id);
    },
  },

  secrets: {
    get: notImplemented("secrets.get"),
    set: notImplemented("secrets.set"),
  },
  notify: notImplemented("notify"),
  fetch: notImplemented("fetch"),
};

/**
 * Held so a deactivate push can call it. A worker plugin is still terminated
 * afterwards either way -- this only gives it a chance to close things
 * cleanly first, which matters for anything holding a remote resource.
 */
let pluginDeactivate: (() => void | Promise<void>) | null = null;

async function start(): Promise<void> {
  const module = await import(boot.entryPath);
  const activate = module.activate ?? module.default?.activate;
  const deactivate = module.deactivate ?? module.default?.deactivate;

  if (typeof activate !== "function") {
    throw new Error(
      `Plugin ${boot.pluginId} backend entry does not export an activate(ctx) function`,
    );
  }
  if (typeof deactivate === "function") pluginDeactivate = deactivate;

  await activate(ctx);
  port!.postMessage({ id: 0, ok: true, value: "activated" });
}

start().catch((error) => {
  port!.postMessage({
    id: 0,
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
    },
  });
});
