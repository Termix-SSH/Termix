/**
 * The core half of boot that runs once the database is open: user keys, the
 * auth singletons and the one-off data migrations core owns. The starter and
 * the boot integration tests share it so they cannot drift apart.
 */

import { AuthManager } from "./utils/auth-manager.js";
import { DataCrypto } from "./utils/data-crypto.js";

export async function runCoreBootMigrations(): Promise<void> {
  const { UserKeyManager } = await import("./utils/user-keys.js");
  await UserKeyManager.getInstance().initialize();

  const { runBootDekMigration } =
    await import("./utils/crypto-migration/dek-migration.js");
  await runBootDekMigration({ cleanupLegacy: true });

  const { runLegacySharedCredentialCleanup } =
    await import("./utils/crypto-migration/legacy-share-cleanup.js");
  await runLegacySharedCredentialCleanup();

  await AuthManager.getInstance().initialize();
  DataCrypto.initialize();

  const { runLegacySharedSshAuthOptInMigration } =
    await import("./utils/crypto-migration/legacy-shared-ssh-auth-opt-in-migration.js");
  await runLegacySharedSshAuthOptInMigration();

  const { runSharedHostSecretsMigration } =
    await import("./utils/crypto-migration/shared-host-secrets-migration.js");
  await runSharedHostSecretsMigration();

  const { runPrivateSharedSshAuthMigration } =
    await import("./utils/crypto-migration/private-shared-ssh-auth-migration.js");
  await runPrivateSharedSshAuthMigration();

  const { runChannelConfigEncryptionMigration } =
    await import("./utils/crypto-migration/channel-config-encryption.js");
  await runChannelConfigEncryptionMigration();

  const { runExternalIdentityMigration } =
    await import("./upgrade/external-identity-migration.js");
  await runExternalIdentityMigration();

  const { runHostStatusConfigMigration } =
    await import("./utils/crypto-migration/host-status-config-migration.js");
  await runHostStatusConfigMigration();
}
