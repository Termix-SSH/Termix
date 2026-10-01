/**
 * Moves what a 2.8 install kept for session recordings into the
 * session-recording plugin, before the plugin activates. Its retention sweep
 * runs on activate, so both have to be in place first:
 *
 * - The retention period: the `session_recording_retention_days` setting, or
 *   the SESSION_RECORDING_RETENTION_DAYS environment variable 2.8 fell back
 *   to, becomes the plugin's `retentionDays`. Without it the plugin's 30 day
 *   default would prune an install that kept a year.
 * - The files: 2.8 wrote them under DATA_DIR/session_logs (SSH) and
 *   DATA_DIR/session_recordings (guacd). The plugin only plays back and
 *   prunes files inside its own data folder, so each file a row points at is
 *   moved there, keeping its path below DATA_DIR, and the row follows it.
 *   Moved rather than copied: recordings can be large, and 2.8 cannot read
 *   the adopted table after a downgrade anyway.
 *
 * Idempotent: an existing retention value is kept, and a row that already
 * points inside the plugin's folder is skipped.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
  createCurrentSettingsRepository,
} from "../database/repositories/factory.js";
import {
  runStatement,
  selectRows,
} from "../utils/crypto-migration/raw-rows.js";
import { getPluginDataDir } from "../plugins/paths.js";

const PLUGIN_ID = "session-recording";
const TABLE = "p_session_recording_session_recordings";
const LEGACY_DIRS = ["session_logs", "session_recordings"];

export interface SessionRecordingDataMigrationResult {
  retentionDays: number | null;
  moved: number;
}

function days(value: unknown): number | null {
  const parsed = parseInt(String(value ?? ""), 10);
  return parsed >= 1 && parsed <= 3650 ? parsed : null;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function move(source: string, target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.rename(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await fs.copyFile(source, target);
    await fs.unlink(source);
  }
}

async function migrateRetention(): Promise<number | null> {
  const settings = createCurrentPluginSettingsRepository();
  const existing = await settings.get(
    PLUGIN_ID,
    "admin",
    null,
    "retentionDays",
  );
  if (existing && existing.value !== null) return null;

  const legacy =
    days(
      await createCurrentSettingsRepository().get(
        "session_recording_retention_days",
      ),
    ) ?? days(process.env.SESSION_RECORDING_RETENTION_DAYS);
  if (legacy === null) return null;

  await settings.set(
    PLUGIN_ID,
    "admin",
    null,
    "retentionDays",
    JSON.stringify(legacy),
  );
  return legacy;
}

async function migrateFiles(): Promise<number> {
  let rows: Array<{ id: number; recording_path: string | null }>;
  try {
    rows = await selectRows(
      sql`SELECT id, recording_path FROM ${sql.identifier(TABLE)} WHERE recording_path IS NOT NULL`,
    );
  } catch {
    // The plugin has not adopted the table yet.
    return 0;
  }

  const dataDir = path.resolve(process.env.DATA_DIR || "./db/data");
  const pluginDir = getPluginDataDir(PLUGIN_ID);
  let moved = 0;

  for (const row of rows) {
    const source = path.resolve(row.recording_path!);
    const relative = path.relative(dataDir, source);
    const [top] = relative.split(path.sep);
    if (relative.startsWith("..") || !LEGACY_DIRS.includes(top)) continue;

    const target = path.join(pluginDir, relative);
    try {
      if (!(await exists(target))) {
        if (!(await exists(source))) continue;
        await move(source, target);
      }
      await runStatement(
        sql`UPDATE ${sql.identifier(TABLE)} SET recording_path = ${target} WHERE id = ${row.id}`,
      );
      moved++;
    } catch (error) {
      databaseLogger.warn("Could not move a session recording file", {
        operation: "session_recording_data_migration",
        recordingId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return moved;
}

export async function runSessionRecordingDataMigration(): Promise<SessionRecordingDataMigrationResult> {
  const result: SessionRecordingDataMigrationResult = {
    retentionDays: null,
    moved: 0,
  };

  try {
    const plugin = await createCurrentPluginRepository().findById(PLUGIN_ID);
    if (!plugin) return result;
    result.retentionDays = await migrateRetention();
    result.moved = await migrateFiles();
  } catch (error) {
    databaseLogger.warn("Session recording data migration failed", {
      operation: "session_recording_data_migration",
      error: error instanceof Error ? error.message : String(error),
    });
    return result;
  }

  if (result.retentionDays !== null || result.moved > 0) {
    databaseLogger.info("Moved 2.8 session recordings into the plugin", {
      operation: "session_recording_data_migration",
      retentionDays: result.retentionDays,
      moved: result.moved,
    });
  }
  return result;
}
