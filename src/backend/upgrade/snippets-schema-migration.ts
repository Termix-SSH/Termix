import type Database from "better-sqlite3";

// Columns old SQLite snippet tables can be missing, for tables made before
// they were added, or adopted by the plugin before core added them.
const SNIPPET_COLUMNS: Array<[string, string]> = [
  ["folder", "TEXT"],
  ["order", "INTEGER NOT NULL DEFAULT 0"],
  ["host_filter", "TEXT"],
  ["is_note", "INTEGER NOT NULL DEFAULT 0"],
  ["sync_id", "TEXT"],
];
const FOLDER_COLUMNS: Array<[string, string]> = [
  ["color", "TEXT"],
  ["icon", "TEXT"],
  ["sync_id", "TEXT"],
];

const TABLES: Array<[string, Array<[string, string]>]> = [
  ["snippets", SNIPPET_COLUMNS],
  ["p_snippets_snippets", SNIPPET_COLUMNS],
  ["snippet_folders", FOLDER_COLUMNS],
  ["p_snippets_snippet_folders", FOLDER_COLUMNS],
];

/** Repair older SQLite tables before adoption, or after an incomplete 2.9 upgrade. */
export function repairSnippetsColumns(sqlite: Database.Database): void {
  for (const [table, wanted] of TABLES) {
    const columns = sqlite.pragma(`table_info("${table}")`) as Array<{
      name: string;
    }>;
    if (columns.length === 0) continue;
    const have = new Set(columns.map(({ name }) => name));
    for (const [column, type] of wanted) {
      if (!have.has(column)) {
        sqlite.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${type}`);
      }
    }
    // Sync matches rows by sync_id, so every row needs one.
    sqlite.exec(
      `UPDATE "${table}" SET "sync_id" = lower(hex(randomblob(16))) WHERE "sync_id" IS NULL`,
    );
    if (!have.has("sync_id")) {
      sqlite.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${table}_sync_id" ON "${table}" ("sync_id")`,
      );
    }
  }
}
