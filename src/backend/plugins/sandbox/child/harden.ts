/**
 * Preloaded with --import into every plugin process, before any
 * plugin code, and imported again first thing by the runtime, because an
 * Electron utility process ignores --import. The permission model does not
 * cover these, so they are taken away here:
 *   node:sqlite opens files without asking the permission model;
 *   process._debugProcess can make another Node process open its inspector;
 *   inspector, wasi and trace_events.
 * Also lets a plugin unpacked outside the app find the packages core supplies
 * (express, drizzle-orm, ssh2, the SDK).
 */
import module from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

function isBare(specifier: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return false;
  if (specifier.startsWith("#")) return false;
  return !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier);
}

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
        if (
          isBare(specifier) &&
          (error as { code?: string }).code === "ERR_MODULE_NOT_FOUND"
        ) {
          return next(specifier, { ...context, parentURL: anchor });
        }
        throw error;
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

  for (const name of [
    "_debugProcess",
    "_debugEnd",
    "dlopen",
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

/**
 * Every worker starts from a small module that loads this file first and
 * then the plugin's entry, so the worker is hardened even where the Node
 * flags are ignored (the desktop), and it keeps the process's permission
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
