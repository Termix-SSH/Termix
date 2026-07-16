import { databaseLogger } from "../logger.js";
import { DataCrypto } from "../data-crypto.js";
import { DatabaseSaveTrigger } from "../database-save-trigger.js";
import { getCurrentRepositorySqlite } from "../../database/repositories/factory.js";
import { SharedCredentialManager } from "../shared-credential-manager.js";

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

interface PendingShareRow {
  id: number;
  host_access_id: number;
  original_credential_id: number;
  target_user_id: string;
}

// One-time cleanup of the pre-2.5 sharing machinery: pending share copies
// (rows that were waiting for an offline user's DEK) are re-created now that
// every migrated user's DEK is server-side, then the queue flag and the
// CREDENTIAL_SHARING_KEY shadow columns are dropped.
export async function runLegacySharedCredentialCleanup(): Promise<{
  resolved: number;
  dropped: number;
  columnsDropped: number;
}> {
  const sqlite = getCurrentRepositorySqlite() as unknown as SqliteLike;
  const result = { resolved: 0, dropped: 0, columnsDropped: 0 };

  if (tableHasColumn(sqlite, "shared_credentials", "needs_re_encryption")) {
    const pendingRows = sqlite
      .prepare(
        `SELECT id, host_access_id, original_credential_id, target_user_id
         FROM shared_credentials
         WHERE needs_re_encryption = 1 OR encrypted_username = ''`,
      )
      .all() as PendingShareRow[];

    for (const row of pendingRows) {
      const owner = sqlite
        .prepare(
          `SELECT h.user_id AS ownerId
           FROM host_access ha JOIN ssh_data h ON h.id = ha.host_id
           WHERE ha.id = ?`,
        )
        .get(row.host_access_id) as { ownerId?: string } | undefined;

      sqlite.prepare(`DELETE FROM shared_credentials WHERE id = ?`).run(row.id);

      const ownerId = owner?.ownerId;
      if (
        ownerId &&
        DataCrypto.canUserAccessData(ownerId) &&
        DataCrypto.canUserAccessData(row.target_user_id)
      ) {
        try {
          await SharedCredentialManager.getInstance().createSharedCredentialForUser(
            row.host_access_id,
            row.original_credential_id,
            row.target_user_id,
            ownerId,
          );
          result.resolved++;
          continue;
        } catch (error) {
          databaseLogger.warn("Could not re-create pending shared credential", {
            operation: "legacy_share_cleanup_recreate_failed",
            sharedCredentialId: row.id,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      result.dropped++;
      databaseLogger.warn(
        "Dropped unresolvable pending shared credential; the owner can re-share the host",
        {
          operation: "legacy_share_cleanup_dropped",
          hostAccessId: row.host_access_id,
          targetUserId: row.target_user_id,
        },
      );
    }
  }

  for (const [table, column] of [
    ["shared_credentials", "needs_re_encryption"],
    ["ssh_credentials", "system_password"],
    ["ssh_credentials", "system_key"],
    ["ssh_credentials", "system_key_password"],
  ] as const) {
    if (dropColumnIfExists(sqlite, table, column)) {
      result.columnsDropped++;
    }
  }

  if (result.resolved || result.dropped || result.columnsDropped) {
    await DatabaseSaveTrigger.forceSave("legacy_share_cleanup");
    databaseLogger.info("Legacy shared-credential cleanup finished", {
      operation: "legacy_share_cleanup",
      ...result,
    });
  }

  return result;
}
