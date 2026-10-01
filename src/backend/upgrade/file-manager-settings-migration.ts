/**
 * Moves the three file-manager host columns into the file-manager plugin's
 * host-scope settings, before those columns are dropped from ssh_data.
 *
 * Idempotent: skips a host that already has a file-manager settings row, so
 * it is safe to run on every boot. Lossless: reads straight off the
 * still-present ssh_data columns, so it must run and finish before those
 * columns are ever dropped from schema.ts.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import {
  legacyFlag,
  selectLegacyRows,
} from "../utils/crypto-migration/raw-rows.js";
import { createCurrentPluginSettingsRepository } from "../database/repositories/factory.js";

export interface FileManagerSettingsMigrationResult {
  moved: number;
  skipped: number;
}

interface LegacyFileManagerRow {
  id: number;
  enable_file_manager: number | boolean | null;
  default_path: string | null;
  scp_legacy: number | boolean | null;
}

export async function runFileManagerSettingsMigration(): Promise<FileManagerSettingsMigrationResult> {
  const result: FileManagerSettingsMigrationResult = { moved: 0, skipped: 0 };

  try {
    // Raw SQL, not the typed schema: this runs once schema.ts has already
    // dropped these columns, so the query is the only thing left that still
    // knows they used to exist.
    const rows = await selectLegacyRows<LegacyFileManagerRow>(sql`
      SELECT id, enable_file_manager, default_path, scp_legacy
      FROM ssh_data
      WHERE enable_file_manager = false OR default_path IS NOT NULL
         OR scp_legacy = true
    `);

    if (rows.length === 0) return result;

    const pluginSettingsRepository = createCurrentPluginSettingsRepository();

    for (const row of rows) {
      const scopeId = String(row.id);
      const existing = await pluginSettingsRepository.get(
        "file-manager",
        "host",
        scopeId,
        "enableFileManager",
      );
      if (existing && existing.value !== null) {
        result.skipped++;
        continue;
      }

      await pluginSettingsRepository.set(
        "file-manager",
        "host",
        scopeId,
        "enableFileManager",
        JSON.stringify(legacyFlag(row.enable_file_manager, true)),
      );
      await pluginSettingsRepository.set(
        "file-manager",
        "host",
        scopeId,
        "defaultPath",
        JSON.stringify(row.default_path ?? null),
      );
      await pluginSettingsRepository.set(
        "file-manager",
        "host",
        scopeId,
        "scpLegacy",
        JSON.stringify(!!row.scp_legacy),
      );
      result.moved++;
    }

    if (result.moved > 0) {
      databaseLogger.info(
        `Moved file manager settings for ${result.moved} host(s) into plugin settings`,
        { operation: "file_manager_settings_migration", moved: result.moved },
      );
    }
  } catch (error) {
    // A failed migration must not stop the backend. Hosts simply keep
    // whatever file-manager settings they already had (none, on a fresh run).
    databaseLogger.warn("File manager settings migration failed", {
      operation: "file_manager_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}
