import { databaseLogger } from "../logger.js";
import { DataCrypto } from "../data-crypto.js";
import { DatabaseSaveTrigger } from "../database-save-trigger.js";
import {
  createCurrentSettingsRepository,
  getCurrentRepositorySqlite,
} from "../../database/repositories/factory.js";
import { SharedHostSecretsManager } from "../shared-host-secrets-manager.js";

const MIGRATION_FLAG = "shared_host_secrets_migrated_v1";

interface GrantRow {
  hostAccessId: number;
  hostId: number;
  userId: string | null;
  roleId: number | null;
  ownerId: string;
}

// One-time 2.5.x migration: rebuild every active share as per-protocol
// secret snapshots in shared_host_secrets, then drop the SSH-only
// shared_credentials table it replaces. Grants whose owner or recipient DEK
// is unavailable are skipped (logged), never fatal to boot.
export async function runSharedHostSecretsMigration(): Promise<{
  snapshotted: number;
  skipped: number;
} | null> {
  const settingsRepository = createCurrentSettingsRepository();

  try {
    if ((await settingsRepository.get(MIGRATION_FLAG)) === "done") {
      return null;
    }
  } catch {
    return null;
  }

  const sqlite = getCurrentRepositorySqlite();
  const result = { snapshotted: 0, skipped: 0 };

  try {
    const grants = sqlite
      .prepare(
        `SELECT ha.id AS hostAccessId, ha.host_id AS hostId,
                ha.user_id AS userId, ha.role_id AS roleId,
                h.user_id AS ownerId
         FROM host_access ha
         JOIN ssh_data h ON h.id = ha.host_id
         WHERE ha.expires_at IS NULL OR ha.expires_at >= ?`,
      )
      .all(new Date().toISOString()) as GrantRow[];

    const manager = SharedHostSecretsManager.getInstance();

    for (const grant of grants) {
      const targetUserIds = grant.userId
        ? [grant.userId]
        : grant.roleId
          ? (
              sqlite
                .prepare(`SELECT user_id FROM user_roles WHERE role_id = ?`)
                .all(grant.roleId) as Array<{ user_id: string }>
            ).map((row) => row.user_id)
          : [];

      for (const targetUserId of targetUserIds) {
        if (targetUserId === grant.ownerId) continue;

        if (
          !DataCrypto.canUserAccessData(grant.ownerId) ||
          !DataCrypto.canUserAccessData(targetUserId)
        ) {
          result.skipped++;
          databaseLogger.warn(
            "Skipping share snapshot migration: missing DEK",
            {
              operation: "shared_host_secrets_migration_skip",
              hostAccessId: grant.hostAccessId,
              targetUserId,
            },
          );
          continue;
        }

        try {
          await manager.snapshotForUser(
            grant.hostAccessId,
            grant.hostId,
            targetUserId,
            grant.ownerId,
          );
          result.snapshotted++;
        } catch (error) {
          result.skipped++;
          databaseLogger.warn("Failed to migrate share snapshot", {
            operation: "shared_host_secrets_migration_failed",
            hostAccessId: grant.hostAccessId,
            targetUserId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    }

    sqlite.exec("DROP TABLE IF EXISTS shared_credentials");
    await settingsRepository.set(MIGRATION_FLAG, "done");
    await DatabaseSaveTrigger.forceSave("shared_host_secrets_migration");

    databaseLogger.info("Shared host secrets migration finished", {
      operation: "shared_host_secrets_migration",
      ...result,
    });

    return result;
  } catch (error) {
    databaseLogger.error("Shared host secrets migration failed", error, {
      operation: "shared_host_secrets_migration",
    });
    return result;
  }
}
