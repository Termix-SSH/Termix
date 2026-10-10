/**
 * Boot copies of 2.8 data into plugin settings and plugin tables. Only the
 * ones that need a user's data key are left: they finish once it opens.
 *
 * They run after the plugins are seeded and activated: plugin_settings has a
 * foreign key to plugins, and some copies write into tables a plugin adopts
 * in its own migrations. Each one is idempotent, so they also run again when
 * an admin enables a plugin without a restart.
 */

import { databaseLogger } from "../utils/logger.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";
import { getErrorMessage } from "../utils/error-message.js";
import { runAiSettingsMigration } from "./ai-settings-migration.js";
import { runSecretSourcesTokenMigration } from "./secret-sources-token-migration.js";
import { runTotpMigration } from "./totp-migration.js";
import { runNotificationChannelMigration } from "./notification-channel-migration.js";
import { runTermixIdentityCaMigration } from "./termix-identity-ca-migration.js";

const MIGRATIONS: Array<[string, () => Promise<unknown>]> = [
  ["runAiSettingsMigration", runAiSettingsMigration],
  ["runSecretSourcesTokenMigration", runSecretSourcesTokenMigration],
  ["runTotpMigration", runTotpMigration],
  ["runNotificationChannelMigration", runNotificationChannelMigration],
  ["runTermixIdentityCaMigration", runTermixIdentityCaMigration],
];

export const runPluginDataMigrations = DatabaseSaveTrigger.batched(
  async (): Promise<void> => {
    for (const [name, run] of MIGRATIONS) {
      try {
        await run();
      } catch (error) {
        databaseLogger.warn(`Plugin data migration ${name} failed`, {
          operation: "plugin_data_migration",
          error: getErrorMessage(error),
        });
      }
    }
    await applyHostDefaults();
  },
);

/**
 * Classifies hosts nobody classified yet (from an older release, or for a
 * plugin just started) and brings every host up to date with its defaults.
 * A linked desktop gets its hosts already resolved from its server.
 */
async function applyHostDefaults(): Promise<void> {
  try {
    const { getLink } = await import("../sync/client/link-store.js");
    if (await getLink().catch(() => null)) return;
    const { recomputeEverything } =
      await import("../hosts/defaults/recompute.js");
    recomputeEverything("plugins started");
  } catch (error) {
    databaseLogger.warn("Could not apply host defaults", {
      operation: "plugin_data_migration",
      error: getErrorMessage(error),
    });
  }
}
