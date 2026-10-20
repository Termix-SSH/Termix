/**
 * Moves the global status check interval into the host-status plugin, before
 * it activates, so its first checks use the interval an admin chose instead of
 * the plugin's 30 second default.
 *
 * Idempotent: a value the plugin already has is kept.
 */

import { databaseLogger } from "../utils/logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
  createCurrentSettingsRepository,
} from "../database/repositories/factory.js";

const PLUGIN_ID = "host-status";
const LEGACY_KEY = "global_status_check_interval";

function seconds(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 5 && parsed <= 3600
    ? parsed
    : null;
}

export async function runHostStatusSettingsMigration(): Promise<number | null> {
  try {
    const plugin = await createCurrentPluginRepository().findById(PLUGIN_ID);
    if (!plugin) return null;

    const settings = createCurrentPluginSettingsRepository();
    const existing = await settings.get(
      PLUGIN_ID,
      "admin",
      null,
      "intervalSeconds",
    );
    if (existing && existing.value !== null) return null;

    const legacy = seconds(
      await createCurrentSettingsRepository().get(LEGACY_KEY),
    );
    if (legacy === null) return null;

    await settings.set(
      PLUGIN_ID,
      "admin",
      null,
      "intervalSeconds",
      JSON.stringify(legacy),
    );
    databaseLogger.info("Moved the status check interval into the plugin", {
      operation: "host_status_settings_migration",
      intervalSeconds: legacy,
    });
    return legacy;
  } catch (error) {
    databaseLogger.warn("Host status settings migration failed", {
      operation: "host_status_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
