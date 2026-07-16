import { createCurrentCredentialRepository } from "../database/repositories/current-credential-repository.js";
import { createCurrentSharedCredentialRepository } from "../database/repositories/current-shared-credential-repository.js";
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
      const credentialRepository = createCurrentCredentialRepository();
      const sharedCredentialRepository =
        createCurrentSharedCredentialRepository();

      const credentials =
        await credentialRepository.listMissingSystemEncryptionByUserId(userId);

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

          const plainKeyPassword = cred.keyPassword
            ? FieldCrypto.decryptField(
                cred.keyPassword,
                userDEK,
                cred.id.toString(),
                "keyPassword",
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

          await credentialRepository.updateSystemEncryptionForUser(
            userId,
            cred.id,
            {
              systemPassword,
              systemKey,
              systemKeyPassword,
              updatedAt: new Date().toISOString(),
            },
          );

          await sharedCredentialRepository.markNeedsReEncryptionByOriginalCredentialId(
            cred.id,
          );

          migrated++;
        } catch (error) {
          databaseLogger.warn(
            `Skipping credential migration for credential ${cred.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
            {
              operation: "credential_migration_skip",
              credentialId: cred.id,
              userId,
            },
          );
          failed++;
        }
      }
      return { migrated, failed, skipped };
    } catch (error) {
      databaseLogger.warn("Credential system encryption migration incomplete", {
        operation: "credential_migration_incomplete",
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }
}
