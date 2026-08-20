import { eq } from "drizzle-orm";
import { databaseLogger } from "../logger.js";
import {
  createCurrentRepositoryContext,
  createCurrentSettingsRepository,
} from "../../database/repositories/factory.js";
import { notificationChannels } from "../../database/db/schema.js";
import { DataCrypto } from "../data-crypto.js";
import { FieldCrypto } from "../field-crypto.js";

const MIGRATION_FLAG = "notification_channel_config_encrypted_v1";

export interface ChannelConfigEncryptionResult {
  encrypted: number;
  skipped: number;
}

/**
 * Notification channel configs hold ntfy tokens, webhook auth headers and
 * Discord webhook URLs, but shipped as plaintext JSON while every other secret
 * in the app was field-encrypted. This encrypts the rows already on disk.
 *
 * Rows whose owner has no usable data key are left alone and retried on a later
 * boot; the repository reads tolerate both shapes, so a partial run is safe.
 */
export async function runChannelConfigEncryptionMigration(): Promise<ChannelConfigEncryptionResult | null> {
  const settingsRepository = createCurrentSettingsRepository();

  try {
    if ((await settingsRepository.get(MIGRATION_FLAG)) === "done") {
      return null;
    }

    const { drizzle } = createCurrentRepositoryContext();
    const rows = await drizzle
      .select({
        id: notificationChannels.id,
        userId: notificationChannels.userId,
        config: notificationChannels.config,
      })
      .from(notificationChannels);

    let encrypted = 0;
    let skipped = 0;
    let deferred = 0;

    for (const row of rows) {
      if (!row.config || FieldCrypto.isEncrypted(row.config)) {
        skipped++;
        continue;
      }

      let userDataKey: Buffer | null = null;
      try {
        userDataKey = DataCrypto.getUserDataKey(row.userId);
      } catch {
        userDataKey = null;
      }

      // No usable key yet (legacy DEK pending migration); retry on a later boot.
      if (!userDataKey) {
        deferred++;
        continue;
      }

      const value = DataCrypto.encryptRecord(
        "notification_channels",
        { id: row.id, config: row.config },
        row.userId,
        userDataKey,
      ).config;

      await drizzle
        .update(notificationChannels)
        .set({ config: value })
        .where(eq(notificationChannels.id, row.id));
      encrypted++;
    }

    // Only close the migration out once no row is still waiting on a key, so a
    // boot that could not reach some users' keys retries those rows next time.
    if (deferred === 0) {
      await settingsRepository.set(MIGRATION_FLAG, "done");
    }

    if (encrypted > 0 || deferred > 0) {
      databaseLogger.info(
        `Encrypted ${encrypted} notification channel config(s)`,
        {
          operation: "channel_config_encryption_migration",
          encrypted,
          skipped,
          deferred,
        },
      );
    }

    return { encrypted, skipped: skipped + deferred };
  } catch (error) {
    databaseLogger.warn("Notification channel config encryption failed", {
      operation: "channel_config_encryption_error",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
