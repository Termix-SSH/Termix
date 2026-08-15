import path from "path";
import { databaseLogger } from "../../utils/logger.js";

/**
 * Terminal image storage modes.
 *
 * - `local`: always write to the backend's mapped local storage. Deterministic:
 *   never falls back to the remote SFTP path.
 * - `remote-sftp`: always write to the connected terminal's SSH host over SFTP.
 *   Deterministic: never falls back to local storage.
 * - `auto`: pick by capability only — remote SFTP when a connected terminal
 *   session exists, local storage otherwise. Configuration never influences
 *   this choice.
 */
export const TERMINAL_IMAGE_STORAGE_MODES = [
  "auto",
  "local",
  "remote-sftp",
] as const;

export type TerminalImageStorageMode =
  (typeof TERMINAL_IMAGE_STORAGE_MODES)[number];

export interface TerminalImageStorageSettings {
  mode: TerminalImageStorageMode;
  /** Absolute path on the Termix backend where local-mode files are written. */
  localDir: string;
  /**
   * Absolute path handed to the terminal agent in local mode. This is the
   * host-side view of `localDir` (e.g. /tmp mapped into the container); it is
   * the only path ever exposed to callers.
   */
  hostPath: string;
  ttlMs: number;
  maxCount: number;
  maxBytes: number;
  /** Both localDir and hostPath were explicitly configured and must be probed. */
  localMappingConfigured: boolean;
}

/** Settings-table keys. Persisted values always win over environment. */
export const TERMINAL_IMAGE_STORAGE_KEYS = {
  mode: "terminal_image_storage_mode",
  localDir: "terminal_image_local_dir",
  hostPath: "terminal_image_host_path",
  ttlMs: "terminal_image_ttl_ms",
  maxCount: "terminal_image_max_count",
  maxBytes: "terminal_image_max_storage_bytes",
} as const;

/**
 * Legacy environment variables from the original env-only configuration. They
 * seed defaults only when no database value exists for the same field.
 */
export const TERMINAL_IMAGE_STORAGE_ENV = {
  mode: "TERMIX_IMAGE_STORAGE_MODE",
  localDir: "TERMIX_IMAGE_DIR",
  hostPath: "TERMIX_IMAGE_HOST_PATH",
  ttlMs: "TERMIX_IMAGE_TTL_MS",
  maxCount: "TERMIX_MAX_IMAGE_COUNT",
  maxBytes: "TERMIX_MAX_IMAGE_STORAGE_BYTES",
} as const;

export const DEFAULT_IMAGE_TTL_MS = 3_600_000;
export const DEFAULT_IMAGE_MAX_COUNT = 100;
export const DEFAULT_IMAGE_MAX_BYTES = 5_368_709_120;
export const DEFAULT_IMAGE_HOST_PATH = "/tmp/termix-image-v0";
export const MIN_IMAGE_MAX_BYTES = 1_048_576;

export function defaultImageLocalDir(env: NodeJS.ProcessEnv): string {
  return path.resolve(
    path.join(env.DATA_DIR || "./db/data", "termix-image-v0"),
  );
}

export function parseTerminalImageStorageMode(
  value: unknown,
): TerminalImageStorageMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (TERMINAL_IMAGE_STORAGE_MODES as readonly string[]).includes(normalized)
    ? (normalized as TerminalImageStorageMode)
    : null;
}

/**
 * Local write directory must be an absolute path without NUL bytes. Relative
 * values are rejected rather than resolved: a relative entry silently depends
 * on the process cwd, which differs between Docker, systemd and dev runs.
 */
export function parseImageLocalDir(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || hasUnsafePathSyntax(trimmed)) return null;
  if (!path.isAbsolute(trimmed)) return null;
  return path.resolve(trimmed);
}

/** Agent-visible path. Always POSIX-style and absolute. */
export function parseImageHostPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || hasUnsafePathSyntax(trimmed)) return null;
  if (!path.posix.isAbsolute(trimmed)) return null;
  return path.posix.normalize(trimmed);
}

/**
 * Numeric fields: unparseable values are rejected (caller falls through to the
 * next source); parseable but out-of-range values are clamped, matching the
 * original env-only behavior.
 */
function parseClampedInt(
  value: unknown,
  min: number,
): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed =
    typeof value === "number" ? value : Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(min, Math.trunc(parsed));
}

interface SettingSource {
  get(key: string): Promise<string | null>;
}

function warnInvalid(key: string, source: string): void {
  databaseLogger.warn("Ignoring invalid terminal image storage setting", {
    operation: "terminal_image_storage_settings_invalid",
    key,
    source,
  });
}

function hasUnsafePathSyntax(value: string): boolean {
  return (
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.split(/[\\/]+/).some((segment) => segment === "..") ||
    value.includes("//") ||
    value.includes("\\")
  );
}

/**
 * Resolves the effective image storage settings.
 *
 * Per-field precedence: a valid persisted database value wins; a legacy
 * TERMIX_IMAGE_* variable seeds the default only when no database value
 * exists; otherwise the built-in default applies. Invalid values are skipped
 * with a warning and resolution falls through to the next source.
 *
 * Mode compatibility: with no mode in the database or environment, an explicit
 * legacy local mapping (TERMIX_IMAGE_DIR) keeps old deployments on `local`;
 * everything else defaults to `auto`.
 */
export async function resolveTerminalImageStorageSettings(
  settings: SettingSource,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TerminalImageStorageSettings> {
  async function pick<T>(
    key: string,
    envName: string,
    parse: (value: unknown) => T | null,
    fallback: T,
  ): Promise<T> {
    const stored = await settings.get(key);
    if (stored !== null) {
      const parsed = parse(stored);
      if (parsed !== null) return parsed;
      warnInvalid(key, "database");
    }
    const fromEnv = env[envName];
    if (fromEnv !== undefined) {
      const parsed = parse(fromEnv);
      if (parsed !== null) return parsed;
      warnInvalid(key, "environment");
    }
    return fallback;
  }

  const dbModeRaw = await settings.get(TERMINAL_IMAGE_STORAGE_KEYS.mode);
  let mode: TerminalImageStorageMode | null = null;
  if (dbModeRaw !== null) {
    mode = parseTerminalImageStorageMode(dbModeRaw);
    if (mode === null) warnInvalid(TERMINAL_IMAGE_STORAGE_KEYS.mode, "database");
  }
  if (mode === null) {
    const envModeRaw = env[TERMINAL_IMAGE_STORAGE_ENV.mode];
    if (envModeRaw !== undefined) {
      mode = parseTerminalImageStorageMode(envModeRaw);
      if (mode === null)
        warnInvalid(TERMINAL_IMAGE_STORAGE_KEYS.mode, "environment");
    }
  }
  if (mode === null) {
    // Legacy deployments configured local storage purely through
    // TERMIX_IMAGE_DIR; keep them on local mode unless a database value says
    // otherwise.
    mode = env[TERMINAL_IMAGE_STORAGE_ENV.localDir] !== undefined
      ? "local"
      : "auto";
  }

  const legacyLocalDir = parseImageLocalDir(
    env[TERMINAL_IMAGE_STORAGE_ENV.localDir],
  );
  const [localDir, hostPath, ttlMs, maxCount, maxBytes] = await Promise.all([
    pick(
      TERMINAL_IMAGE_STORAGE_KEYS.localDir,
      TERMINAL_IMAGE_STORAGE_ENV.localDir,
      parseImageLocalDir,
      defaultImageLocalDir(env),
    ),
    pick(
      TERMINAL_IMAGE_STORAGE_KEYS.hostPath,
      TERMINAL_IMAGE_STORAGE_ENV.hostPath,
      parseImageHostPath,
      legacyLocalDir ?? DEFAULT_IMAGE_HOST_PATH,
    ),
    pick(
      TERMINAL_IMAGE_STORAGE_KEYS.ttlMs,
      TERMINAL_IMAGE_STORAGE_ENV.ttlMs,
      (value) => parseClampedInt(value, 0),
      DEFAULT_IMAGE_TTL_MS,
    ),
    pick(
      TERMINAL_IMAGE_STORAGE_KEYS.maxCount,
      TERMINAL_IMAGE_STORAGE_ENV.maxCount,
      (value) => parseClampedInt(value, 1),
      DEFAULT_IMAGE_MAX_COUNT,
    ),
    pick(
      TERMINAL_IMAGE_STORAGE_KEYS.maxBytes,
      TERMINAL_IMAGE_STORAGE_ENV.maxBytes,
      (value) => parseClampedInt(value, MIN_IMAGE_MAX_BYTES),
      DEFAULT_IMAGE_MAX_BYTES,
    ),
  ]);

  const persistedLocalDir = await settings.get(
    TERMINAL_IMAGE_STORAGE_KEYS.localDir,
  );
  const persistedHostPath = await settings.get(
    TERMINAL_IMAGE_STORAGE_KEYS.hostPath,
  );
  const localMappingConfigured =
    (persistedLocalDir !== null && parseImageLocalDir(persistedLocalDir) !== null ||
      parseImageLocalDir(env[TERMINAL_IMAGE_STORAGE_ENV.localDir]) !== null) &&
    (persistedHostPath !== null && parseImageHostPath(persistedHostPath) !== null ||
      parseImageHostPath(env[TERMINAL_IMAGE_STORAGE_ENV.hostPath]) !== null ||
      legacyLocalDir !== null);

  return {
    mode,
    localDir,
    hostPath,
    ttlMs,
    maxCount,
    maxBytes,
    localMappingConfigured,
  };
}
