/**
 * Moves the Tailscale API key and base URL out of core settings.
 *
 * Both lived in the core `settings` table, written by a core route that existed
 * only to serve one plugin. A6 gives plugins their own settings, so they belong
 * in plugin_settings under the tailscale plugin.
 *
 * The key was stored in plaintext, and the route that read it back masked only
 * its tail while being open to any authenticated user. Landing it as a secret
 * field encrypts it at rest, so this migration is a fix as much as a move.
 *
 * Idempotent in two ways: it stops when a value is already present in the new
 * home, and encryptSystemSecret returns an already-encrypted value unchanged,
 * so a second pass can neither duplicate nor double-encrypt.
 */

import { databaseLogger } from "../logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
  createCurrentSettingsRepository,
} from "../../database/repositories/factory.js";
import { encryptSystemSecret } from "../system-secret-crypto.js";

const PLUGIN_ID = "tailscale";

/** Legacy core key -> the field the plugin now declares. */
const MOVES: { legacyKey: string; field: string; secret: boolean }[] = [
  { legacyKey: "tailscale_api_key", field: "apiKey", secret: true },
  { legacyKey: "tailscale_api_base_url", field: "apiBaseUrl", secret: false },
];

export interface TailscaleSettingsMigrationResult {
  moved: string[];
  skipped: string[];
}

export async function runTailscaleSettingsMigration(): Promise<TailscaleSettingsMigrationResult> {
  const moved: string[] = [];
  const skipped: string[] = [];

  try {
    // The FK to plugins means there is nothing to migrate into until the
    // plugin has been seeded. Not an error: a build without it just has no
    // tailscale rows.
    const plugin = await createCurrentPluginRepository().findById(PLUGIN_ID);
    if (!plugin) return { moved, skipped };

    const settingsRepository = createCurrentSettingsRepository();
    const pluginSettingsRepository = createCurrentPluginSettingsRepository();

    for (const move of MOVES) {
      const legacyValue = await settingsRepository.get(move.legacyKey);
      if (legacyValue === null || legacyValue === "") {
        continue;
      }

      const existing = await pluginSettingsRepository.get(
        PLUGIN_ID,
        "admin",
        null,
        move.field,
      );
      if (existing && existing.value !== null) {
        // Already moved. Drop the stale copy rather than leaving a plaintext
        // key behind for a reader that predates this change.
        await settingsRepository.delete(move.legacyKey);
        skipped.push(move.legacyKey);
        continue;
      }

      const stored = move.secret
        ? await encryptSystemSecret(legacyValue)
        : legacyValue;

      await pluginSettingsRepository.set(
        PLUGIN_ID,
        "admin",
        null,
        move.field,
        JSON.stringify(stored),
        move.secret,
      );

      await settingsRepository.delete(move.legacyKey);
      moved.push(move.legacyKey);
    }

    if (moved.length > 0) {
      databaseLogger.info(
        `Moved ${moved.length} Tailscale setting(s) into plugin settings`,
        { operation: "tailscale_settings_migration", moved: moved.join(", ") },
      );
    }
  } catch (error) {
    // A failed migration must not stop the backend. The plugin falls back to
    // "no key configured", which is a visible, recoverable state.
    databaseLogger.warn("Tailscale settings migration failed", {
      operation: "tailscale_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { moved, skipped };
}
