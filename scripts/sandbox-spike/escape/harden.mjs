// Preloaded with --import before plugin code. Hides builtins that skip the
// permission model.
import module from "node:module";

const BLOCKED = new Set([
  "sqlite",
  "node:sqlite",
  "inspector",
  "node:inspector",
  "inspector/promises",
  "node:inspector/promises",
  "wasi",
  "node:wasi",
  "trace_events",
  "node:trace_events",
]);

function refuse(name) {
  const error = new Error(`${name} is not available to sandboxed plugins`);
  error.code = "ERR_ACCESS_DENIED";
  return error;
}

module.registerHooks({
  resolve(specifier, context, next) {
    if (BLOCKED.has(specifier)) throw refuse(specifier);
    return next(specifier, context);
  },
});

const original = process.getBuiltinModule.bind(process);
Object.defineProperty(process, "getBuiltinModule", {
  value: (id) => {
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
