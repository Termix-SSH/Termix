/**
 * What the root launcher accepts from core. Core runs as a normal user, so a
 * core that was taken over must not be able to use the launcher to run code
 * as root, as another plugin's user, or without the fence.
 */
import fs from "node:fs";
import path from "node:path";

/** Plugin users live in their own range, one per plugin id. */
export const UID_FIRST = 61000;
export const UID_LAST = 61999;

const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isPluginId(id: string): boolean {
  return PLUGIN_ID.test(id);
}

/** Core's own settings and secrets. A plugin never gets these. */
export const CORE_ONLY_ENV = new Set([
  "JWT_SECRET",
  "DATABASE_KEY",
  "DATABASE_KEY_PREVIOUS",
  "ENCRYPTION_KEY",
  "ENCRYPTION_KEY_PREVIOUS",
  "INTERNAL_AUTH_TOKEN",
  "OIDC_SYSTEM_SECRET",
  "WEBAUTHN_SYSTEM_SECRET",
  "DB_FILE_KEY",
  "DB_FILE_ENCRYPTION",
  "DATABASE_URL",
  "DATABASE_DIALECT",
  "DATABASE_SSL",
  "DATABASE_POOL_MAX",
  "DATA_DIR",
  "TERMIX_PLUGIN_LAUNCHER",
  "TERMIX_LAUNCHER_UID",
  "TERMIX_LAUNCHER_GID",
]);

/** Variables that change how Node, the loader or the runtime start. */
const RUNTIME_ENV =
  /^(NODE_|LD_|DYLD_|ELECTRON_|UV_|NPM_|OPENSSL_|SSL_CERT_|BASH_ENV$|ENV$|PATH$)/i;

/**
 * Whether a variable the plugin's manifest lists in env may be handed to
 * its process. NODE_ENV and TERMIX_SANDBOX_PLUGIN are set by core itself.
 */
export function isPassableEnv(name: string): boolean {
  return (
    /^[A-Z][A-Z0-9_]{0,63}$/.test(name) &&
    !CORE_ONLY_ENV.has(name) &&
    !RUNTIME_ENV.test(name) &&
    name !== "TERMIX_SANDBOX_PLUGIN" &&
    name !== "TERMIX_SANDBOX_ADDONS"
  );
}

/** Flags a plugin process may start with. Anything else is refused. */
const FIXED_FLAGS = new Set([
  "--permission",
  "--allow-net",
  "--allow-child-process",
  "--allow-addons",
  // Only with the worker guard in harden.js, which keeps workers on these flags.
  "--allow-worker",
  "--expose-gc",
  "--disable-sigusr1",
]);

export interface SpawnCheck {
  ok: boolean;
  reason?: string;
}

export function validateSpawn(
  request: Record<string, unknown>,
  expected: { hardenUrl: string; dataRoot: string },
): SpawnCheck {
  const pluginId = String(request.pluginId ?? "");
  if (!isPluginId(pluginId)) return { ok: false, reason: "bad plugin id" };
  const dataDir = path.resolve(String(request.dataDir ?? ""));
  const ownData = path.resolve(expected.dataRoot, "plugin-data", pluginId);
  if (dataDir !== ownData) return { ok: false, reason: "wrong data folder" };

  const env = request.env as Record<string, unknown> | undefined;
  if (!env || typeof env !== "object") return { ok: false, reason: "no env" };
  if (env.TERMIX_SANDBOX_PLUGIN !== pluginId) {
    return {
      ok: false,
      reason: "env TERMIX_SANDBOX_PLUGIN must name the plugin",
    };
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.length > 4096) {
      return { ok: false, reason: `env ${key} is not a short string` };
    }
    if (key === "NODE_ENV" || key === "TERMIX_SANDBOX_PLUGIN") continue;
    if (!isPassableEnv(key)) {
      return { ok: false, reason: `env ${key} is not allowed` };
    }
  }

  const argv = request.execArgv;
  if (!Array.isArray(argv) || argv[0] !== "--permission") {
    return { ok: false, reason: "the permission model must be on" };
  }
  let sawHarden = false;
  let sawHeap = false;
  for (const raw of argv) {
    const arg = String(raw);
    if (FIXED_FLAGS.has(arg)) continue;
    if (arg.startsWith("--allow-fs-read=")) {
      const target = arg.slice("--allow-fs-read=".length);
      if (!path.isAbsolute(target) || target.includes("*")) {
        return { ok: false, reason: "read grants must be absolute paths" };
      }
      continue;
    }
    if (arg.startsWith("--allow-fs-write=")) {
      if (path.resolve(arg.slice("--allow-fs-write=".length)) !== ownData) {
        return { ok: false, reason: "a plugin may only write its own data" };
      }
      continue;
    }
    if (/^--max-semi-space-size=\d{1,3}$/.test(arg)) continue;
    const heap = /^--max-old-space-size=(\d{2,5})$/.exec(arg);
    if (heap && Number(heap[1]) >= 64 && Number(heap[1]) <= 4096) {
      sawHeap = true;
      continue;
    }
    if (arg === `--import=${expected.hardenUrl}`) {
      sawHarden = true;
      continue;
    }
    return { ok: false, reason: `flag ${arg.split("=")[0]} is not allowed` };
  }
  if (!sawHarden) return { ok: false, reason: "the harden preload is missing" };
  if (!sawHeap) return { ok: false, reason: "the heap limit is missing" };
  if (
    request.firewall !== undefined &&
    request.firewall !== "deny" &&
    request.firewall !== "allow-all"
  ) {
    return { ok: false, reason: "bad firewall rule" };
  }
  return { ok: true };
}

/**
 * The same plugin always gets the same user, so its data folder keeps its
 * owner across restarts. Kept in a root-only file in the data folder.
 */
export function allocateUid(file: string, pluginId: string): number {
  let table: Record<string, number> = {};
  try {
    table = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, number>;
  } catch {
    table = {};
  }
  const existing = table[pluginId];
  if (
    Number.isInteger(existing) &&
    existing >= UID_FIRST &&
    existing <= UID_LAST
  ) {
    return existing;
  }
  const used = new Set(Object.values(table));
  for (let uid = UID_FIRST; uid <= UID_LAST; uid++) {
    if (used.has(uid)) continue;
    table[pluginId] = uid;
    fs.writeFileSync(file, JSON.stringify(table), { mode: 0o600 });
    return uid;
  }
  throw new Error("No plugin users left");
}
