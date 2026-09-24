import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  normalizeTouchInputSettings,
  type TouchInputSettings,
} from "../shared/touch-input-settings.js";
import {
  resolveTerminalImageStorageSettings,
  TERMINAL_IMAGE_STORAGE_KEYS,
  type TerminalImageStorageSettings,
} from "./images/image-storage-settings.js";
import { DEFAULT_TIMEOUT_MINUTES } from "./session-manager.js";

/**
 * Admin setting keys, as declared in manifest.json. The image storage fields
 * have no default on purpose: an unset field falls through to the old
 * TERMIX_IMAGE_* environment variables, the way the settings table did.
 */
export const ADMIN_KEYS = {
  sessionTimeoutMinutes: "sessionTimeoutMinutes",
  sessionPersistence: "sessionPersistence",
  commandHistoryEnabled: "commandHistoryEnabled",
  touchInput: "touchInput",
  imageStorageMode: "imageStorageMode",
  imageLocalDir: "imageLocalDir",
  imageHostPath: "imageHostPath",
  imageTtlMs: "imageTtlMs",
  imageMaxCount: "imageMaxCount",
  imageMaxBytes: "imageMaxBytes",
} as const;

export const HOST_KEYS = {
  enableTerminal: "enableTerminal",
  enableTerminalToolbar: "enableTerminalToolbar",
  enableCommandHistory: "enableCommandHistory",
} as const;

const IMAGE_FIELD_BY_LEGACY_KEY: Record<string, string> = {
  [TERMINAL_IMAGE_STORAGE_KEYS.mode]: ADMIN_KEYS.imageStorageMode,
  [TERMINAL_IMAGE_STORAGE_KEYS.localDir]: ADMIN_KEYS.imageLocalDir,
  [TERMINAL_IMAGE_STORAGE_KEYS.hostPath]: ADMIN_KEYS.imageHostPath,
  [TERMINAL_IMAGE_STORAGE_KEYS.ttlMs]: ADMIN_KEYS.imageTtlMs,
  [TERMINAL_IMAGE_STORAGE_KEYS.maxCount]: ADMIN_KEYS.imageMaxCount,
  [TERMINAL_IMAGE_STORAGE_KEYS.maxBytes]: ADMIN_KEYS.imageMaxBytes,
};

export async function readImageStorageSettings(
  ctx: PluginContext,
): Promise<TerminalImageStorageSettings> {
  return resolveTerminalImageStorageSettings({
    get: async (legacyKey) => {
      const field = IMAGE_FIELD_BY_LEGACY_KEY[legacyKey];
      if (!field) return null;
      const value = await ctx.settings.get(field);
      if (value === undefined || value === null || value === "") return null;
      return String(value);
    },
    warn: (message) => ctx.log.warn(message),
  });
}

export interface ClientSettings {
  sessionTimeoutMinutes: number;
  sessionPersistence: boolean;
  commandHistoryEnabled: boolean;
  touchInput: TouchInputSettings;
}

/** What every signed-in user's terminal needs, whether or not they are an admin. */
export async function readClientSettings(
  ctx: PluginContext,
): Promise<ClientSettings> {
  const all = await ctx.settings.getAll("admin");
  const timeout = Number(all[ADMIN_KEYS.sessionTimeoutMinutes]);
  let touch: unknown = all[ADMIN_KEYS.touchInput];
  if (typeof touch === "string") {
    try {
      touch = JSON.parse(touch);
    } catch {
      touch = null;
    }
  }
  return {
    sessionTimeoutMinutes:
      Number.isFinite(timeout) && timeout > 0
        ? timeout
        : DEFAULT_TIMEOUT_MINUTES,
    sessionPersistence: all[ADMIN_KEYS.sessionPersistence] !== false,
    commandHistoryEnabled: all[ADMIN_KEYS.commandHistoryEnabled] !== false,
    touchInput: normalizeTouchInputSettings(touch),
  };
}
