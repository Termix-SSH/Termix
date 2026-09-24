/**
 * Moves the session logging host column into the session-recording plugin's
 * host-scope settings, before the column is dropped from ssh_data.
 *
 * The legacy column defaulted to true; the plugin's enable switch defaults to
 * false like every other plugin's. So unlike a migration whose old and new
 * defaults agree, every host needs an explicit row here, not just the ones
 * that turned the feature off.
 *
 * Idempotent: skips a host that already has a session-recording settings row,
 * so it is safe to run on every boot.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../logger.js";
import { getDb } from "../../database/db/index.js";
import { createCurrentPluginSettingsRepository } from "../../database/repositories/factory.js";

export interface SessionRecordingSettingsMigrationResult {
  moved: number;
  skipped: number;
}

interface LegacySessionLoggingRow {
  id: number;
  enable_session_logging: number | boolean | null;
}

export async function runSessionRecordingSettingsMigration(): Promise<SessionRecordingSettingsMigrationResult> {
  const result: SessionRecordingSettingsMigrationResult = {
    moved: 0,
    skipped: 0,
  };

  try {
    const drizzleDb = getDb();
    // Raw SQL, not the typed schema, so this keeps working once schema.ts
    // stops declaring this column.
    const rows = await drizzleDb.all<LegacySessionLoggingRow>(sql`
      SELECT id, enable_session_logging FROM ssh_data
    `);

    if (rows.length === 0) return result;

    const pluginSettingsRepository = createCurrentPluginSettingsRepository();

    for (const row of rows) {
      const scopeId = String(row.id);
      const existing = await pluginSettingsRepository.get(
        "session-recording",
        "host",
        scopeId,
        "enableSessionRecording",
      );
      if (existing && existing.value !== null) {
        result.skipped++;
        continue;
      }

      await pluginSettingsRepository.set(
        "session-recording",
        "host",
        scopeId,
        "enableSessionRecording",
        JSON.stringify(row.enable_session_logging !== false),
      );
      result.moved++;
    }

    if (result.moved > 0) {
      databaseLogger.info(
        `Moved session recording settings for ${result.moved} host(s) into plugin settings`,
        {
          operation: "session_recording_settings_migration",
          moved: result.moved,
        },
      );
    }
  } catch (error) {
    // A failed migration must not stop the backend. Hosts simply keep the
    // plugin's own default (off) until this runs successfully.
    databaseLogger.warn("Session recording settings migration failed", {
      operation: "session_recording_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}
