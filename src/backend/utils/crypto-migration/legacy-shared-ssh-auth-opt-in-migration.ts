import { DatabaseSaveTrigger } from "../database-save-trigger.js";
import { databaseLogger } from "../logger.js";
import {
  createCurrentSettingsRepository,
  getCurrentRepositorySqlite,
} from "../../database/repositories/factory.js";
import { SharedHostSecretsManager } from "../shared-host-secrets-manager.js";

const MIGRATION_FLAG = "legacy_shared_ssh_auth_opt_in_v1";

interface SharedHostRow {
  id: number;
}

export interface LegacySharedSshAuthOptInResult {
  enabled: number;
  resynced: number;
  skipped: number;
}

/**
 * Before SSH authentication became owner-controlled, every shared host shared
 * its SSH auth automatically. Preserve that behavior for hosts which already
 * have access grants while keeping the schema default private for new hosts.
 *
 * Re-syncing also repairs snapshots for hosts already marked as shared. If the
 * privacy migration has previously completed, false values are treated as an
 * explicit choice and are never changed back to shared.
 */
export async function runLegacySharedSshAuthOptInMigration(): Promise<LegacySharedSshAuthOptInResult | null> {
  const settingsRepository = createCurrentSettingsRepository();

  try {
    if ((await settingsRepository.get(MIGRATION_FLAG)) === "done") {
      return null;
    }

    const sqlite = getCurrentRepositorySqlite();
    const privacyMigrationAlreadyRan =
      (await settingsRepository.get("private_shared_ssh_auth_v1")) === "done";
    const hasLegacySharedCredentialsTable = !!sqlite
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shared_credentials'",
      )
      .get();
    const now = new Date().toISOString();
    const legacySnapshotEvidence = hasLegacySharedCredentialsTable
      ? ` OR EXISTS (
            SELECT 1
            FROM shared_credentials sc
            INNER JOIN host_access legacy_ha
              ON legacy_ha.id = sc.host_access_id
            WHERE legacy_ha.host_id = ssh_data.id
              AND (
                legacy_ha.expires_at IS NULL
                OR legacy_ha.expires_at >= ?
              )
          )`
      : "";
    const updateResult = privacyMigrationAlreadyRan
      ? { changes: 0 }
      : sqlite
          .prepare(
            `UPDATE ssh_data
             SET share_ssh_auth = 1
             WHERE share_ssh_auth = 0
               AND (
                 EXISTS (
                   SELECT 1
                   FROM shared_host_secrets shs
                   INNER JOIN host_access ha
                     ON ha.id = shs.host_access_id
                   WHERE ha.host_id = ssh_data.id
                     AND shs.protocol = 'ssh'
                     AND (
                       ha.expires_at IS NULL
                       OR ha.expires_at >= ?
                     )
                 )
                 ${legacySnapshotEvidence}
               )`,
          )
          .run(...(hasLegacySharedCredentialsTable ? [now, now] : [now]));
    const sharedHosts = sqlite
      .prepare(
        `SELECT DISTINCT h.id
         FROM ssh_data h
         INNER JOIN host_access ha ON ha.host_id = h.id
         WHERE h.share_ssh_auth = 1`,
      )
      .all() as SharedHostRow[];

    const result: LegacySharedSshAuthOptInResult = {
      enabled: updateResult.changes,
      resynced: 0,
      skipped: 0,
    };
    const secretsManager = SharedHostSecretsManager.getInstance();

    for (const host of sharedHosts) {
      try {
        await secretsManager.resyncHost(host.id);
        result.resynced++;
      } catch (error) {
        result.skipped++;
        databaseLogger.warn(
          "Failed to resync legacy shared SSH authentication",
          {
            operation: "legacy_shared_ssh_auth_opt_in_resync_skip",
            hostId: host.id,
            error: error instanceof Error ? error.message : "Unknown error",
          },
        );
      }
    }

    await settingsRepository.set(MIGRATION_FLAG, "done");
    await DatabaseSaveTrigger.forceSave(
      "legacy_shared_ssh_auth_opt_in_migration",
    );

    databaseLogger.info("Preserved legacy shared SSH authentication behavior", {
      operation: "legacy_shared_ssh_auth_opt_in_migration",
      ...result,
    });

    return result;
  } catch (error) {
    databaseLogger.error(
      "Failed to preserve legacy shared SSH authentication behavior",
      error,
      {
        operation: "legacy_shared_ssh_auth_opt_in_migration",
      },
    );
    return { enabled: 0, resynced: 0, skipped: 0 };
  }
}
