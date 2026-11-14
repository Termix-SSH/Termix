import type Database from "better-sqlite3";

// 2.8 added these on start. 2.9 left the tables to the Homepage and Vault
// plugins and dropped that code, so a database that skipped 2.8 never got
// them, and sync failed on every pass reading sync_id.
const SYNC_ID: Array<[string, string]> = [["sync_id", "TEXT"]];
const SERVICE_LINK_COLUMNS: Array<[string, string]> = [
  ["sync_id", "TEXT"],
  ["updated_at", "TEXT"],
];

const TABLES: Array<[string, Array<[string, string]>]> = [
  ["homepage_items", SYNC_ID],
  ["p_homepage_homepage_items", SYNC_ID],
  ["dashboard_service_links", SERVICE_LINK_COLUMNS],
  ["p_homepage_dashboard_service_links", SERVICE_LINK_COLUMNS],
  ["vault_profiles", SYNC_ID],
  ["p_vault_profiles", SYNC_ID],
];

/** Adds the 2.8 sync columns to Homepage and Vault tables, before or after adoption. */
export function repairSyncIdColumns(sqlite: Database.Database): void {
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
    sqlite.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${table}_sync_id" ON "${table}" ("sync_id")`,
    );
  }
}
