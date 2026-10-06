/**
 * The core half of boot that runs once the database is open: user keys, the
 * auth singletons and the one-off data migrations core owns. The starter and
 * the boot integration tests share it so they cannot drift apart.
 */

import { AuthManager } from "./utils/auth-manager.js";
import { DataCrypto } from "./utils/data-crypto.js";
import { ensurePreupgradeBackup } from "./utils/database-layer-preupgrade-backup.js";
import { systemLogger } from "./utils/logger.js";

/**
 * Copies the SQLite file before anything opens it, so the copy is the database
 * exactly as the previous version left it: before core's schema patches and
 * before any plugin adopts a table. Client-server engines are the operator's
 * to back up.
 */
export async function backupBeforeUpgrade(options: {
  dataDir: string;
  version: string;
}): Promise<void> {
  const { needsExplicitPersist, resolveDatabaseDialect } =
    await import("./database/db/dialect.js");
  const dialect = resolveDatabaseDialect();
  if (needsExplicitPersist(dialect)) {
    ensurePreupgradeBackup(options);
    return;
  }
  systemLogger.info(
    `Skipping pre-upgrade backup on ${dialect} - back up the database yourself`,
    { operation: "backend_init_db_backup_skipped", dialect },
  );
}

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

  // Before anything snapshots shared secrets, which would drop a protocol
  // snapshot whose login has not been copied yet.
  const { runProtocolAuthMigration } =
    await import("./upgrade/protocol-auth-migration.js");
  await runProtocolAuthMigration();

  const { runLegacySharedSshAuthOptInMigration } =
    await import("./utils/crypto-migration/legacy-shared-ssh-auth-opt-in-migration.js");
  await runLegacySharedSshAuthOptInMigration();

  const { runSharedHostSecretsMigration } =
    await import("./utils/crypto-migration/shared-host-secrets-migration.js");
  await runSharedHostSecretsMigration();

  const { runPrivateSharedSshAuthMigration } =
    await import("./utils/crypto-migration/private-shared-ssh-auth-migration.js");
  await runPrivateSharedSshAuthMigration();

  const { runExternalIdentityMigration } =
    await import("./upgrade/external-identity-migration.js");
  await runExternalIdentityMigration();

  const { runHostStatusConfigMigration } =
    await import("./utils/crypto-migration/host-status-config-migration.js");
  await runHostStatusConfigMigration();

  const { runSshOptionsMigration } =
    await import("./utils/crypto-migration/ssh-options-migration.js");
  await runSshOptionsMigration();

  const { runAuditNoiseCleanup } =
    await import("./upgrade/audit-noise-cleanup.js");
  await runAuditNoiseCleanup();
}
