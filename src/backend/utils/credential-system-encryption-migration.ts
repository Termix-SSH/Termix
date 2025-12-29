import { db } from "../database/db/index.js";
import { sshCredentials } from "../database/db/schema.js";
import { eq, and, or, isNull } from "drizzle-orm";
import { DataCrypto } from "./data-crypto.js";
import { SystemCrypto } from "./system-crypto.js";
import { FieldCrypto } from "./field-crypto.js";
import { databaseLogger } from "./logger.js";

export class CredentialSystemEncryptionMigration {
  async migrateUserCredentials(userId: string): Promise<{
    migrated: number;
    failed: number;
    skipped: number;
  }> {
    try {
      const userDEK = DataCrypto.getUserDataKey(userId);
      if (!userDEK) {
        throw new Error("User must be logged in to migrate credentials");
      }

      const systemCrypto = SystemCrypto.getInstance();
      const CSKEK = await systemCrypto.getCredentialSharingKey();

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
        } catch (error) {
          databaseLogger.error("Failed to migrate credential", error, {
            credentialId: cred.id,
            userId,
          });
          failed++;
        }
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
