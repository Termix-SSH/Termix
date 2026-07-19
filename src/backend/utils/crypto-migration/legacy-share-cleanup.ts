import { databaseLogger } from "../logger.js";
import { DatabaseSaveTrigger } from "../database-save-trigger.js";
import { getCurrentRepositorySqlite } from "../../database/repositories/factory.js";

interface SqliteLike {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
  exec(sql: string): unknown;
}

function tableHasColumn(
  sqlite: SqliteLike,
  table: string,
  column: string,
): boolean {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return rows.some((row) => row.name === column);
}

function dropColumnIfExists(
  sqlite: SqliteLike,
  table: string,
  column: string,
): boolean {
  if (!tableHasColumn(sqlite, table, column)) return false;
  sqlite.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  return true;
}

// One-time cleanup of the pre-2.5 sharing machinery: the
// CREDENTIAL_SHARING_KEY shadow columns are dropped. Pending share copies are
// no longer re-created here; the shared_host_secrets migration rebuilds every
// active share from the live host_access grants instead.
export async function runLegacySharedCredentialCleanup(): Promise<{
  columnsDropped: number;
}> {
  const sqlite = getCurrentRepositorySqlite() as unknown as SqliteLike;
  const result = { columnsDropped: 0 };

  for (const [table, column] of [
    ["ssh_credentials", "system_password"],
    ["ssh_credentials", "system_key"],
    ["ssh_credentials", "system_key_password"],
  ] as const) {
    if (dropColumnIfExists(sqlite, table, column)) {
      result.columnsDropped++;
    }
  }

  if (result.columnsDropped) {
    await DatabaseSaveTrigger.forceSave("legacy_share_cleanup");
    databaseLogger.info("Legacy shared-credential cleanup finished", {
      operation: "legacy_share_cleanup",
      ...result,
    });
  }

  return result;
}
