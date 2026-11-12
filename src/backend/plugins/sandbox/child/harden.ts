/**
 * Preloaded with --import into every sandboxed plugin process, before any
 * plugin code. The permission model does not cover these, so they are taken
 * away here:
 *   node:sqlite opens files without asking the permission model;
 *   process._debugProcess can make another Node process open its inspector;
 *   inspector, wasi and trace_events.
 * Also lets a plugin unpacked outside the app find the packages core supplies
 * (express, drizzle-orm, ssh2, the SDK), the same fallback host-modules.ts
 * gives in process.
 */
import module from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
