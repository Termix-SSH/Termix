/**
 * Moves each host's Wake-on-LAN settings out of ssh_data and into the
 * wake-on-lan plugin's host settings: mac_address becomes macAddress and
 * wol_broadcast_address becomes broadcastAddress.
 *
 * The columns stay in the database, unused: core's drizzle migrations run
 * before this does, so dropping them there would lose the data first.
 *
 * Idempotent: a host that already has any wake-on-lan row is skipped, so
 * this is safe on every boot.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
} from "../../database/repositories/factory.js";
import { selectRows } from "./raw-rows.js";

const PLUGIN_ID = "wake-on-lan";

interface LegacyHostRow {
  id: number;
  mac_address: string | null;
  wol_broadcast_address: string | null;
}

/** The plugin's host settings for one legacy row, defaults left out. */
export function wakeOnLanSettingsFromRow(
  row: LegacyHostRow,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (row.mac_address) values.macAddress = row.mac_address;
  if (row.wol_broadcast_address) {
    values.broadcastAddress = row.wol_broadcast_address;
  }
  return values;
}

export interface WakeOnLanSettingsMigrationResult {
  hostsMoved: number;
  hostsSkipped: number;
}

export async function runWakeOnLanSettingsMigration(): Promise<WakeOnLanSettingsMigrationResult> {
  const result: WakeOnLanSettingsMigrationResult = {
    hostsMoved: 0,
    hostsSkipped: 0,
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

  let rows: LegacyHostRow[];
  try {
    // Raw SQL: schema.ts no longer declares these columns.
    rows = await selectRows<LegacyHostRow>(
      sql`SELECT id, mac_address, wol_broadcast_address FROM ssh_data`,
    );
  } catch {
    // A fresh install never had the columns.
    return result;
  }

  for (const row of rows) {
    const values = wakeOnLanSettingsFromRow(row);
    if (Object.keys(values).length === 0) continue;
    const scopeId = String(row.id);
    try {
      const existing = await pluginSettings.getAll(PLUGIN_ID, "host", scopeId);
      if (existing.length > 0) {
        result.hostsSkipped++;
        continue;
      }
      for (const [key, value] of Object.entries(values)) {
        await pluginSettings.set(
          PLUGIN_ID,
          "host",
          scopeId,
          key,
          JSON.stringify(value),
        );
      }
      result.hostsMoved++;
    } catch (error) {
      databaseLogger.warn(
        "Wake-on-LAN host settings migration failed for a host",
        {
          operation: "wake_on_lan_settings_migration",
          hostId: row.id,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  if (result.hostsMoved > 0) {
    databaseLogger.info(
      `Moved Wake-on-LAN settings for ${result.hostsMoved} host(s) into plugin settings`,
      { operation: "wake_on_lan_settings_migration" },
    );
  }
  return result;
}
