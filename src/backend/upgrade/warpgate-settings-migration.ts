/**
 * Moves each host's Warpgate flag out of ssh_data and into the warpgate
 * plugin's useWarpgate host setting. Hosts from before 2.7 that still carry
 * auth_type "warpgate" get the setting too, and auth type "none", which is
 * what that auth type meant.
 *
 * The column stays in the database, unused: core's drizzle migrations run
 * before this does, so dropping it there would lose the data first.
 *
 * Idempotent: a host that already has the setting is skipped, so this is
 * safe on every boot.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
} from "../database/repositories/factory.js";
import {
  runStatement,
  selectRows,
} from "../utils/crypto-migration/raw-rows.js";

const PLUGIN_ID = "warpgate";
const SETTING_KEY = "useWarpgate";

interface LegacyHostRow {
  id: number;
  use_warpgate?: number | boolean | string | null;
  auth_type: string | null;
}

export function usesWarpgate(row: LegacyHostRow): boolean {
  const flag = row.use_warpgate;
  return (
    flag === true ||
    flag === 1 ||
    flag === "1" ||
    flag === "true" ||
    row.auth_type === "warpgate"
  );
}

export interface WarpgateSettingsMigrationResult {
  hostsMoved: number;
  hostsSkipped: number;
  authTypesFixed: number;
}

async function legacyRows(): Promise<LegacyHostRow[]> {
  try {
    // Raw SQL: schema.ts no longer declares use_warpgate.
    return await selectRows<LegacyHostRow>(
      sql`SELECT id, use_warpgate, auth_type FROM ssh_data`,
    );
  } catch {
    // A fresh install never had the column.
    try {
      return await selectRows<LegacyHostRow>(
        sql`SELECT id, auth_type FROM ssh_data WHERE auth_type = 'warpgate'`,
      );
    } catch {
      return [];
    }
  }
}

export async function runWarpgateSettingsMigration(): Promise<WarpgateSettingsMigrationResult> {
  const result: WarpgateSettingsMigrationResult = {
    hostsMoved: 0,
    hostsSkipped: 0,
    authTypesFixed: 0,
  };

  // plugin_settings has a foreign key to plugins: nothing to migrate into
  // until the plugin row exists.
  try {
    const plugin = await createCurrentPluginRepository().findById(PLUGIN_ID);
    if (!plugin) return result;
  } catch {
    return result;
  }

  const pluginSettings = createCurrentPluginSettingsRepository();

  for (const row of await legacyRows()) {
    if (!usesWarpgate(row)) continue;
    const scopeId = String(row.id);
    try {
      const existing = await pluginSettings.get(
        PLUGIN_ID,
        "host",
        scopeId,
        SETTING_KEY,
      );
      if (existing) {
        result.hostsSkipped++;
      } else {
        await pluginSettings.set(
          PLUGIN_ID,
          "host",
          scopeId,
          SETTING_KEY,
          JSON.stringify(true),
        );
        result.hostsMoved++;
      }
      if (row.auth_type === "warpgate") {
        await runStatement(
          sql`UPDATE ssh_data SET auth_type = 'none' WHERE id = ${row.id}`,
        );
        result.authTypesFixed++;
      }
    } catch (error) {
      databaseLogger.warn(
        "Warpgate host settings migration failed for a host",
        {
          operation: "warpgate_settings_migration",
          hostId: row.id,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  if (result.hostsMoved > 0) {
    databaseLogger.info(
      `Moved the Warpgate flag for ${result.hostsMoved} host(s) into plugin settings`,
      { operation: "warpgate_settings_migration" },
    );
  }
  return result;
}
