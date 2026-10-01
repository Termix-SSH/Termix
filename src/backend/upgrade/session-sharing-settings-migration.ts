/**
 * Moves session sharing's two settings into the session-sharing plugin:
 * the instance-wide switch (settings.session_sharing_globally_enabled) into
 * its admin setting, and ssh_data.allow_session_sharing into its host setting.
 *
 * Idempotent: nothing is written where the plugin already has a row, so it is
 * safe on every boot. Both default to on, so only a switch that was turned off
 * needs a row. The legacy settings row is left in place for a release.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import { selectLegacyRows } from "../utils/crypto-migration/raw-rows.js";
import {
  createCurrentPluginSettingsRepository,
  createCurrentSettingsRepository,
} from "../database/repositories/factory.js";

const PLUGIN_ID = "session-sharing";
const LEGACY_GLOBAL_KEY = "session_sharing_globally_enabled";

export interface SessionSharingSettingsMigrationResult {
  movedGlobal: boolean;
  movedHosts: number;
  skipped: number;
}

interface LegacyHostRow {
  id: number;
}

export async function runSessionSharingSettingsMigration(): Promise<SessionSharingSettingsMigrationResult> {
  const result: SessionSharingSettingsMigrationResult = {
    movedGlobal: false,
    movedHosts: 0,
    skipped: 0,
  };

  try {
    const pluginSettings = createCurrentPluginSettingsRepository();

    const legacy =
      await createCurrentSettingsRepository().get(LEGACY_GLOBAL_KEY);
    if (legacy === "false") {
      const existing = await pluginSettings.get(
        PLUGIN_ID,
        "admin",
        null,
        "globallyEnabled",
      );
      if (existing && existing.value !== null) {
        result.skipped++;
      } else {
        await pluginSettings.set(
          PLUGIN_ID,
          "admin",
          null,
          "globallyEnabled",
          JSON.stringify(false),
        );
        result.movedGlobal = true;
      }
    }

    // Raw SQL, so this keeps working once schema.ts stops declaring the column.
    const rows = await selectLegacyRows<LegacyHostRow>(sql`
      SELECT id FROM ssh_data WHERE allow_session_sharing = false
    `);
    for (const row of rows) {
      const scopeId = String(row.id);
      const existing = await pluginSettings.get(
        PLUGIN_ID,
        "host",
        scopeId,
        "allowSessionSharing",
      );
      if (existing && existing.value !== null) {
        result.skipped++;
        continue;
      }
      await pluginSettings.set(
        PLUGIN_ID,
        "host",
        scopeId,
        "allowSessionSharing",
        JSON.stringify(false),
      );
      result.movedHosts++;
    }

    if (result.movedGlobal || result.movedHosts > 0) {
      databaseLogger.info("Moved session sharing settings into the plugin", {
        operation: "session_sharing_settings_migration",
        movedGlobal: result.movedGlobal,
        movedHosts: result.movedHosts,
      });
    }
  } catch (error) {
    // Never stops the backend. Sharing then stays on, the plugin's default.
    databaseLogger.warn("Session sharing settings migration failed", {
      operation: "session_sharing_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}
