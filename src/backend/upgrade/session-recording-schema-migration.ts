import type Database from "better-sqlite3";

const TABLES = ["session_recordings", "p_session_recording_session_recordings"];

/**
 * Older SQLite recording tables have no username column, and adopting one
 * keeps it that way. The plugin can't change its tables from its own process,
 * so core adds the column at boot, before or after adoption.
 */
export function repairSessionRecordingColumns(sqlite: Database.Database): void {
  for (const table of TABLES) {
    const columns = sqlite.pragma(`table_info("${table}")`) as Array<{
      name: string;
    }>;
    if (columns.length === 0) continue;
    if (!columns.some(({ name }) => name === "username")) {
      sqlite.exec(`ALTER TABLE "${table}" ADD COLUMN "username" TEXT`);
    }
  }
}
