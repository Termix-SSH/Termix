/**
 * Moves the 2.8 telemetry settings into the telemetry plugin: the admin
 * switch (settings.analytics_enabled) into its `enabled` admin setting, and
 * the instance id (settings.analytics_instance_id) into `instanceId`, so the
 * instance keeps reporting under the same id.
 *
 * Idempotent: nothing is written where the plugin already has a row. The
 * legacy settings rows stay in place until 3.0.0. The plugin waits a few
 * minutes before its first send, so this lands first.
 */

import { databaseLogger } from "../utils/logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
  createCurrentSettingsRepository,
} from "../database/repositories/factory.js";

const PLUGIN_ID = "telemetry";

export interface TelemetrySettingsMigrationResult {
  movedEnabled: boolean;
  movedInstanceId: boolean;
}

export async function runTelemetrySettingsMigration(): Promise<TelemetrySettingsMigrationResult> {
  const result: TelemetrySettingsMigrationResult = {
    movedEnabled: false,
    movedInstanceId: false,
  };

  // plugin_settings has a foreign key to plugins.
  try {
    if (!(await createCurrentPluginRepository().findById(PLUGIN_ID))) {
      return result;
    }
  } catch {
    return result;
  }

  const coreSettings = createCurrentSettingsRepository();
  const pluginSettings = createCurrentPluginSettingsRepository();

  const moves: Array<[string, string, unknown]> = [];
  if ((await coreSettings.get("analytics_enabled")) === "false") {
    moves.push(["analytics_enabled", "enabled", false]);
  }
  const instanceId = await coreSettings.get("analytics_instance_id");
  if (instanceId) {
    moves.push(["analytics_instance_id", "instanceId", instanceId]);
  }

  for (const [, key, value] of moves) {
    const existing = await pluginSettings.get(PLUGIN_ID, "admin", null, key);
    if (existing && existing.value !== null) continue;
    await pluginSettings.set(
      PLUGIN_ID,
      "admin",
      null,
      key,
      JSON.stringify(value),
    );
    if (key === "enabled") result.movedEnabled = true;
    else result.movedInstanceId = true;
  }

  if (result.movedEnabled || result.movedInstanceId) {
    databaseLogger.info("Moved telemetry settings into plugin settings", {
      operation: "telemetry_settings_migration",
      ...result,
    });
  }
  return result;
}
