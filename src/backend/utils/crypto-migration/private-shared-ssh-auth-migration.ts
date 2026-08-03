import { databaseLogger } from "../logger.js";
import { DatabaseSaveTrigger } from "../database-save-trigger.js";
import {
  createCurrentSettingsRepository,
  getCurrentRepositorySqlite,
} from "../../database/repositories/factory.js";

const MIGRATION_FLAG = "private_shared_ssh_auth_v1";

/**
 * Remove SSH snapshots only for hosts whose owners have not enabled SSH auth
 * sharing. Legacy shared hosts are opted in before this cleanup runs.
 */
export async function runPrivateSharedSshAuthMigration(): Promise<
  number | null
> {
  const settingsRepository = createCurrentSettingsRepository();

  try {
    if ((await settingsRepository.get(MIGRATION_FLAG)) === "done") {
      return null;
    }

    const result = getCurrentRepositorySqlite()
      .prepare(
        `DELETE FROM shared_host_secrets
         WHERE protocol = ?
           AND NOT EXISTS (
             SELECT 1
             FROM host_access ha
             INNER JOIN ssh_data h ON h.id = ha.host_id
             WHERE ha.id = shared_host_secrets.host_access_id
               AND h.share_ssh_auth = 1
           )`,
      )
      .run("ssh");

    await settingsRepository.set(MIGRATION_FLAG, "done");
    await DatabaseSaveTrigger.forceSave("private_shared_ssh_auth_migration");

    databaseLogger.info("Removed legacy shared SSH authentication snapshots", {
      operation: "private_shared_ssh_auth_migration",
      removed: result.changes,
    });

    return result.changes;
  } catch (error) {
    databaseLogger.error(
      "Failed to remove legacy shared SSH authentication snapshots",
      error,
      {
        operation: "private_shared_ssh_auth_migration",
      },
    );
    return 0;
  }
}
