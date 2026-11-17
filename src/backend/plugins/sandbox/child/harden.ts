/**
 * Preloaded with --import into every plugin process, before any
 * plugin code, and imported again first thing by the runtime as a backstop.
 * The permission model does not cover these, so they are taken away here:
 *   node:sqlite opens files without asking the permission model;
 *   process._debugProcess can make another Node process open its inspector;
 *   inspector, wasi and trace_events.
 * Also lets a plugin unpacked outside the app find the packages core supplies
 * (express, drizzle-orm, ssh2, the SDK).
 */
import module from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { maySignal, NO_NETWORK_ENV, resolveFromApp } from "./guards.js";

/**
 * Worker options a plugin may pass. execArgv is left out on purpose: a
 * worker given its own execArgv (even []) starts without the permission
 * model, so every worker must inherit the process's flags.
 */
export const WORKER_OPTIONS = new Set([
  "argv",
  "env",
  "workerData",
  "stdin",
  "stdout",
  "stderr",
  "transferList",
  "resourceLimits",
  "name",
  "trackUnmanagedFds",
]);

/** A worker's entry as a file URL. Code strings and other schemes are refused. */
export function workerEntryUrl(file: unknown): string {
  if (file instanceof URL) {
    if (file.protocol !== "file:") throw refuseWorker();
    return file.href;
  }
  const text = String(file);
  if (text.startsWith("file:")) return new URL(text).href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[a-z]:[\\/]/i.test(text)) {
    throw refuseWorker();
  }
  return pathToFileURL(path.resolve(text)).href;
}

function refuseWorker(): Error {
  return refuse("A worker that does not start from a file");
}

const BLOCKED = new Set(
  ["sqlite", "inspector", "inspector/promises", "wasi", "trace_events"].flatMap(
    (name) => [name, `node:${name}`],
  ),
);

function refuse(name: string): Error {
  const error = new Error(
    `${name} is not available to sandboxed plugins`,
  ) as Error & {
    code?: string;
  };
  error.code = "ERR_ACCESS_DENIED";
  return error;
}

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/backend/backend/plugins/sandbox/child -> app root
const anchor = pathToFileURL(
  path.resolve(here, "../../../../../../package.json"),
).href;
const fromApp = module.createRequire(anchor);

// Runs once, however many times the module is loaded.
const HARDENED = Symbol.for("termix.sandbox.hardened");
const marks = globalThis as Record<symbol, unknown>;
if (!marks[HARDENED]) {
  marks[HARDENED] = true;
  harden();
}

function harden(): void {
  module.registerHooks({
    resolve(specifier, context, next) {
      if (BLOCKED.has(specifier)) throw refuse(specifier);
      try {
        return next(specifier, context);
      } catch (error) {
        return resolveFromApp(specifier, context, error, next, anchor, (id) =>
          fromApp.resolve(id),
        );
      }
    },
  });

  const original = process.getBuiltinModule.bind(process);
  Object.defineProperty(process, "getBuiltinModule", {
    value: (id: string) => {
      if (BLOCKED.has(id)) throw refuse(id);
      return original(id);
    },
    writable: false,
    configurable: false,
  });

  guardWorkers(original);
  guardSignals(original);
  if (process.env[NO_NETWORK_ENV] === "1") guardNetwork(original);

  // Native addons load only with device:serial (--allow-addons).
  const permission = (
    process as { permission?: { has: (scope: string) => boolean } }
  ).permission;
  const addons = permission?.has("addon") === true;
  for (const name of [
    "_debugProcess",
    "_debugEnd",
    ...(addons ? [] : ["dlopen"]),
    "binding",
    "_linkedBinding",
  ]) {
    Object.defineProperty(process, name, {
      value: () => {
        throw refuse(`process.${name}`);
      },
      writable: false,
      configurable: false,
    });
  }
}

/** Processes this plugin started itself. */
const children = new Set<number>();

function guardSignals(getBuiltin: (id: string) => unknown): void {
  const { ChildProcess } = getBuiltin("node:child_process") as {
    ChildProcess: { prototype: Record<string, unknown> };
  };
  const spawn = ChildProcess.prototype.spawn as (
    this: { pid?: number },
    ...args: unknown[]
  ) => unknown;
  Object.defineProperty(ChildProcess.prototype, "spawn", {
    value: function (this: { pid?: number }, ...args: unknown[]) {
      const result = spawn.apply(this, args);
      if (typeof this.pid === "number") children.add(this.pid);
      return result;
    },
    writable: false,
    configurable: false,
  });

  // process.kill calls process._kill, so guarding it covers both.
  const raw = process as unknown as {
    _kill: (pid: number, signal: number) => number;
  };
  const kill = raw._kill.bind(process);
  Object.defineProperty(process, "_kill", {
    value: (pid: number, signal: number) => {
      if (!maySignal(pid, process.pid, children)) {
        throw refuse("Signals to a process the plugin did not start");
      }
      return kill(pid, signal);
    },
    writable: false,
    configurable: false,
  });

  const os = getBuiltin("node:os") as {
    setPriority: (pid: number, priority?: number) => void;
  };
  const setPriority = os.setPriority;
  Object.defineProperty(os, "setPriority", {
    value: (pid: number, priority?: number) => {
      // One argument sets this process's own priority.
      if (priority !== undefined && pid !== 0) {
        if (!maySignal(pid, process.pid, children)) {
          throw refuse("Changing the priority of another process");
        }
      }
      return priority === undefined
        ? setPriority(pid)
        : setPriority(pid, priority);
    },
    writable: false,
    configurable: false,
  });
  module.syncBuiltinESMExports();
}

function refuseNetwork(): Error {
  return refuse("Network access without network:sockets");
}

function blockMethods(target: unknown, names: string[]): void {
  if (!target) return;
  for (const name of names) {
    const owner = target as Record<string, unknown>;
    if (typeof owner[name] !== "function") continue;
    Object.defineProperty(owner, name, {
      value: () => {
        throw refuseNetwork();
      },
      writable: false,
      configurable: false,
    });
  }
}

/**
 * Keeps a plugin without network:sockets off the network with an error it can
 * catch. Node before 25 has no network permission, and on later Node a denied
 * listen throws uncaught and kills the process. Every TCP, TLS, HTTP and
 * pipe client goes through net.Socket's connect, every server through
 * listen, and the global fetch and WebSocket use the same sockets.
 */
function guardNetwork(getBuiltin: (id: string) => unknown): void {
  const net = getBuiltin("node:net") as {
    Socket: { prototype: unknown };
    Server: { prototype: unknown };
  };
  blockMethods(net.Socket.prototype, ["connect"]);
  blockMethods(net.Server.prototype, ["listen"]);
  const dgram = getBuiltin("node:dgram") as { Socket: { prototype: unknown } };
  blockMethods(dgram.Socket.prototype, ["bind", "send", "connect"]);
  const dns = getBuiltin("node:dns") as Record<string, unknown> & {
    promises: Record<string, unknown>;
    Resolver: { prototype: unknown };
  };
  const lookups = Object.keys(dns).filter((name) =>
    /^(lookup|resolve|reverse)/.test(name),
  );
  blockMethods(dns, lookups);
  blockMethods(dns.Resolver.prototype, lookups);
  const promises = dns.promises as Record<string, unknown> & {
    Resolver: { prototype: unknown };
  };
  const promiseLookups = Object.keys(promises).filter((name) =>
    /^(lookup|resolve|reverse)/.test(name),
  );
  blockMethods(promises, promiseLookups);
  blockMethods(promises.Resolver.prototype, promiseLookups);
  for (const name of ["fetch", "WebSocket", "EventSource"]) {
    if (!(name in globalThis)) continue;
    Object.defineProperty(globalThis, name, {
      value: function blocked() {
        throw refuseNetwork();
      },
      writable: false,
      configurable: false,
    });
  }
  module.syncBuiltinESMExports();
}

/**
 * Every worker starts from a small module that loads this file first and
 * then the plugin's entry, so the worker is hardened before its code runs,
 * and it keeps the process's permission
 * flags because its execArgv is never set. A worker from a code string
 * would skip this file, so it is refused.
 */
function guardWorkers(getBuiltin: (id: string) => unknown): void {
  const threads = getBuiltin("node:worker_threads") as {
    Worker: new (file: unknown, options?: object) => object;
  };
  const Original = threads.Worker;
  const self = import.meta.url;
  function Worker(this: unknown, file: unknown, options?: unknown) {
    if (!new.target) {
      throw new TypeError(
        "Class constructor Worker cannot be invoked without 'new'",
      );
    }
    const given = (options ?? {}) as Record<string, unknown>;
    if (given.eval) throw refuseWorker();
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(given)) {
      if (WORKER_OPTIONS.has(key)) safe[key] = value;
    }
    const entry = workerEntryUrl(file);
    // The real entry starts from a data: module, so put its path back where
    // process.argv[1] has it for a plain worker; CLI parsers read it there.
    const argv = Array.isArray(given.argv) ? given.argv : [];
    safe.argv = [fileURLToPath(entry), ...argv];
    const boot =
      `await import(${JSON.stringify(self)});` +
      `await import(${JSON.stringify(entry)});`;
    return Reflect.construct(
      Original,
      [new URL(`data:text/javascript,${encodeURIComponent(boot)}`), safe],
      new.target === Worker ? Original : new.target,
    );
  }
  Object.setPrototypeOf(Worker, Object.getPrototypeOf(Original));
  Worker.prototype = Original.prototype;
  // So instance.constructor leads back here, not to the real class.
  Object.defineProperty(Original.prototype, "constructor", {
    value: Worker,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(threads, "Worker", {
    value: Worker,
    writable: false,
    configurable: false,
  });
  module.syncBuiltinESMExports();
}
