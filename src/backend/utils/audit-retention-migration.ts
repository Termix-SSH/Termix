import { databaseLogger } from "./logger.js";

export interface MigratableSqlite {
  exec(sql: string): unknown;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
}

interface ForeignKeyRow {
  table?: string;
  from?: string;
  on_delete?: string;
}

interface RetainedTable {
  name: string;
  /** Column list for the copy, in the order the rebuilt table declares them. */
  columns: string[];
  createSql: string;
}

/**
 * `audit_logs` denormalises `username`, so nulling `user_id` still leaves a
 * record of who acted.
 */
const AUDIT_LOGS: RetainedTable = {
  name: "audit_logs",
  columns: [
    "id",
    "user_id",
    "username",
    "action",
    "resource_type",
    "resource_id",
    "resource_name",
    "details",
    "ip_address",
    "user_agent",
    "success",
    "error_message",
    "timestamp",
  ],
  createSql: `
    CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        resource_name TEXT,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        success INTEGER NOT NULL,
        error_message TEXT,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
    );
  `,
};

const RETAINED_TABLES = [AUDIT_LOGS];

export function userDeleteIsDestructive(
  sqlite: MigratableSqlite,
  table: string,
): boolean {
  let rows: ForeignKeyRow[];
  try {
    rows = sqlite
      .prepare(`PRAGMA foreign_key_list(${table})`)
      .all() as ForeignKeyRow[];
  } catch {
    // Table absent on a fresh database; it is created in the target shape.
    return false;
  }

  return rows.some(
    (row) =>
      row.table === "users" &&
      row.from === "user_id" &&
      (row.on_delete ?? "").toUpperCase() === "CASCADE",
  );
}

/**
 * SQLite cannot alter a foreign key in place, so the table is copied into a new
 * one with the intended constraint and swapped. Foreign keys must be off.
 */
function rebuildTable(sqlite: MigratableSqlite, table: RetainedTable): void {
  const columns = table.columns.join(", ");
  const temp = `${table.name}_retained`;

  sqlite.exec(table.createSql.replace(table.name, temp));
  sqlite.exec(
    `INSERT INTO ${temp} (${columns}) SELECT ${columns} FROM ${table.name};`,
  );
  sqlite.exec(`DROP TABLE ${table.name};`);
  sqlite.exec(`ALTER TABLE ${temp} RENAME TO ${table.name};`);
}

/**
 * Turns ON DELETE CASCADE into ON DELETE SET NULL for the tables that have to
 * outlive the account they reference. Idempotent.
 */
export function migrateAuditRetention(sqlite: MigratableSqlite): string[] {
  const migrated: string[] = [];

  for (const table of RETAINED_TABLES) {
    if (!userDeleteIsDestructive(sqlite, table.name)) continue;

    try {
      sqlite.exec("PRAGMA foreign_keys = OFF");
      sqlite.exec("BEGIN TRANSACTION");
      rebuildTable(sqlite, table);
      sqlite.exec("COMMIT");

      migrated.push(table.name);
      databaseLogger.info(`${table.name} now survives user deletion`, {
        operation: "audit_retention_migration",
        table: table.name,
      });
    } catch (error) {
      try {
        sqlite.exec("ROLLBACK");
      } catch {
        // no transaction open
      }
      databaseLogger.warn(`Could not migrate ${table.name} retention`, {
        operation: "audit_retention_migration_failed",
        table: table.name,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      sqlite.exec("PRAGMA foreign_keys = ON");
    }
  }

  return migrated;
}
