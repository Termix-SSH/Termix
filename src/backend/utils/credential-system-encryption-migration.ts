import { db } from "../database/db/index.js";
import { sshCredentials } from "../database/db/schema.js";
import { eq, and, or, isNull } from "drizzle-orm";
import { DataCrypto } from "./data-crypto.js";
import { SystemCrypto } from "./system-crypto.js";
import { FieldCrypto } from "./field-crypto.js";
import { databaseLogger } from "./logger.js";

/**
 * Migrates credentials to include system-encrypted fields for offline sharing
 */
export class CredentialSystemEncryptionMigration {
  /**
   * Migrates a user's credentials to include system-encrypted fields
   * Requires user to be logged in (DEK available)
   */
  async migrateUserCredentials(userId: string): Promise<{
    migrated: number;
    failed: number;
    skipped: number;
  }> {
    try {
      // Get user's DEK (requires logged in)
      const userDEK = DataCrypto.getUserDataKey(userId);
      if (!userDEK) {
        throw new Error("User must be logged in to migrate credentials");
      }

      // Get system key
      const systemCrypto = SystemCrypto.getInstance();
      const CSKEK = await systemCrypto.getCredentialSharingKey();

      // Find credentials without system encryption
      const credentials = await db
        .select()
        .from(sshCredentials)
        .where(
          and(
            eq(sshCredentials.userId, userId),
            or(
              isNull(sshCredentials.systemPassword),
              isNull(sshCredentials.systemKey),
              isNull(sshCredentials.systemKeyPassword),
            ),
          ),
        );

      let migrated = 0;
      let failed = 0;
      const skipped = 0;

      for (const cred of credentials) {
        try {
          // Decrypt with user DEK
          const plainPassword = cred.password
            ? FieldCrypto.decryptField(
                cred.password,
                userDEK,
                cred.id.toString(),
                "password",
              )
            : null;

          const plainKey = cred.key
            ? FieldCrypto.decryptField(
                cred.key,
                userDEK,
                cred.id.toString(),
                "key",
              )
            : null;

          const plainKeyPassword = cred.key_password
            ? FieldCrypto.decryptField(
                cred.key_password,
                userDEK,
                cred.id.toString(),
                "key_password",
              )
            : null;

          // Re-encrypt with CSKEK
          const systemPassword = plainPassword
            ? FieldCrypto.encryptField(
                plainPassword,
                CSKEK,
                cred.id.toString(),
                "password",
              )
            : null;

          const systemKey = plainKey
            ? FieldCrypto.encryptField(
                plainKey,
                CSKEK,
                cred.id.toString(),
                "key",
              )
            : null;

          const systemKeyPassword = plainKeyPassword
            ? FieldCrypto.encryptField(
                plainKeyPassword,
                CSKEK,
                cred.id.toString(),
                "key_password",
              )
            : null;

          // Update database
          await db
            .update(sshCredentials)
            .set({
              systemPassword,
              systemKey,
              systemKeyPassword,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(sshCredentials.id, cred.id));

          migrated++;

          databaseLogger.info("Credential migrated for offline sharing", {
            operation: "credential_system_encryption_migrated",
            credentialId: cred.id,
            userId,
          });
        } catch (error) {
          databaseLogger.error("Failed to migrate credential", error, {
            credentialId: cred.id,
            userId,
          });
          failed++;
        }
      }

      if (migrated > 0) {
        databaseLogger.success(
          "Credential system encryption migration completed",
          {
            operation: "credential_migration_complete",
            userId,
            migrated,
            failed,
            skipped,
          },
        );
      }

      return { migrated, failed, skipped };
    } catch (error) {
      databaseLogger.error(
        "Credential system encryption migration failed",
        error,
        {
          operation: "credential_migration_failed",
          userId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
      throw error;
    }
  }
}
