/**
 * Moves the tmux monitor host column into the tmux-monitor plugin's host-scope
 * settings, before the column is dropped from ssh_data.
 *
 * Idempotent: skips a host that already has a tmux-monitor settings row, so it
 * is safe to run on every boot. Lossless: reads straight off the still-present
 * ssh_data column, so it must run and finish before that column is ever
 * dropped from schema.ts.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../logger.js";
import { getDb } from "../../database/db/index.js";
import { createCurrentPluginSettingsRepository } from "../../database/repositories/factory.js";

export interface TmuxMonitorSettingsMigrationResult {
  moved: number;
  skipped: number;
}

interface LegacyTmuxMonitorRow {
  id: number;
  enable_tmux_monitor: number | boolean | null;
}

export async function runTmuxMonitorSettingsMigration(): Promise<TmuxMonitorSettingsMigrationResult> {
  const result: TmuxMonitorSettingsMigrationResult = { moved: 0, skipped: 0 };

  try {
    const drizzleDb = getDb();
    // Raw SQL, not the typed schema, so this keeps working once schema.ts
    // stops declaring this column. The plugin's enable switch defaults to
    // off, matching the old column's default, so only hosts that turned it
    // on need a row.
    const rows = await drizzleDb.all<LegacyTmuxMonitorRow>(sql`
      SELECT id, enable_tmux_monitor
      FROM ssh_data
      WHERE enable_tmux_monitor = true
    `);

    if (rows.length === 0) return result;

    const pluginSettingsRepository = createCurrentPluginSettingsRepository();

    for (const row of rows) {
      const scopeId = String(row.id);
      const existing = await pluginSettingsRepository.get(
        "tmux-monitor",
        "host",
        scopeId,
        "enableTmuxMonitor",
      );
      if (existing && existing.value !== null) {
        result.skipped++;
        continue;
      }

      await pluginSettingsRepository.set(
        "tmux-monitor",
        "host",
        scopeId,
        "enableTmuxMonitor",
        JSON.stringify(!!row.enable_tmux_monitor),
      );
      result.moved++;
    }

    if (result.moved > 0) {
      databaseLogger.info(
        `Moved tmux monitor settings for ${result.moved} host(s) into plugin settings`,
        { operation: "tmux_monitor_settings_migration", moved: result.moved },
      );
    }
  } catch (error) {
    // A failed migration must not stop the backend. Hosts simply keep the
    // monitor off, the plugin's default.
    databaseLogger.warn("Tmux monitor settings migration failed", {
      operation: "tmux_monitor_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}
