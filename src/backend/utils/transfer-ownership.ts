import { eq } from "drizzle-orm";
import {
  credentialAccess,
  hostAccess,
  hosts,
  sshCredentials,
} from "../database/db/schema.js";
import { needsExplicitPersist } from "../database/db/dialect.js";
import { createCurrentRepositoryContext } from "../database/repositories/factory.js";
import type { HostUpdate } from "../database/repositories/host-repository.js";
import type { NewCredentialRecord } from "../database/repositories/credential-repository.js";
import { DataCrypto } from "./data-crypto.js";
import { DatabaseSaveTrigger } from "./database-save-trigger.js";
import { databaseLogger } from "./logger.js";
import { SharedHostSecretsManager } from "./shared-host-secrets-manager.js";
import { SharedCredentialSecretsManager } from "./shared-credential-secrets-manager.js";

/**
 * Hands one user's hosts and credentials to another before the account is
 * deleted, so what they shared keeps working for everyone else: rows are
 * re-encrypted under the successor's key, the grants they issued are now
 * the successor's, and every recipient's snapshot is rebuilt from the new
 * owner's copy.
 */
export async function transferOwnership(
  fromUserId: string,
  toUserId: string,
): Promise<{ hosts: number; credentials: number }> {
  if (fromUserId === toUserId) {
    throw new Error("Cannot transfer ownership to the same user");
  }
  const context = createCurrentRepositoryContext();
  const fromKey = DataCrypto.validateUserAccess(fromUserId);
  const toKey = DataCrypto.validateUserAccess(toUserId);
  const credentialRows = await context.drizzle
    .select()
    .from(sshCredentials)
    .where(eq(sshCredentials.userId, fromUserId));
  const hostRows = await context.drizzle
    .select()
    .from(hosts)
    .where(eq(hosts.userId, fromUserId));

  // Decrypt and re-encrypt everything before opening the write transaction.
  // A corrupt row therefore fails without changing ownership of earlier rows.
  const credentials = credentialRows.map((row) => {
    const plain = DataCrypto.decryptRecord(
      "ssh_credentials",
      row,
      fromUserId,
      fromKey,
    );
    const {
      id: _id,
      userId: _userId,
      ...fields
    } = plain as Record<string, unknown>;
    const encrypted = DataCrypto.encryptRecord(
      "ssh_credentials",
      { ...fields, id: row.id },
      toUserId,
      toKey,
    ) as Record<string, unknown>;
    delete encrypted.id;
    return { id: row.id, update: encrypted as Partial<NewCredentialRecord> };
  });
  const transferredHosts = hostRows.map((row) => {
    const plain = DataCrypto.decryptRecord(
      "ssh_data",
      row,
      fromUserId,
      fromKey,
    );
    const {
      id: _id,
      userId: _userId,
      ...fields
    } = plain as Record<string, unknown>;
    const encrypted = DataCrypto.encryptRecord(
      "ssh_data",
      { ...fields, id: row.id },
      toUserId,
      toKey,
    ) as Record<string, unknown>;
    delete encrypted.id;
    return { id: row.id, update: encrypted as HostUpdate };
  });

  const apply = (tx: typeof context.drizzle, sync: boolean) => {
    const writes = [
      ...credentials.map(({ id, update }) =>
        tx
          .update(sshCredentials)
          .set({ ...update, userId: toUserId })
          .where(eq(sshCredentials.id, id)),
      ),
      ...transferredHosts.map(({ id, update }) =>
        tx
          .update(hosts)
          .set({ ...update, userId: toUserId })
          .where(eq(hosts.id, id)),
      ),
      tx
        .update(hostAccess)
        .set({ grantedBy: toUserId })
        .where(eq(hostAccess.grantedBy, fromUserId)),
      tx
        .update(credentialAccess)
        .set({ grantedBy: toUserId })
        .where(eq(credentialAccess.grantedBy, fromUserId)),
    ];
    if (sync) {
      for (const write of writes) write.run();
      return undefined;
    }
    return Promise.all(writes);
  };

  if (context.dialect === "sqlite") {
    context.drizzle.transaction((tx) => apply(tx, true));
  } else {
    await context.drizzle.transaction((tx) => apply(tx, false));
  }
  if (needsExplicitPersist(context.dialect)) {
    await DatabaseSaveTrigger.forceSave("transfer_ownership");
  }

  const credentialIds = credentials.map(({ id }) => id);
  const hostIds = transferredHosts.map(({ id }) => id);

  const hostSecrets = SharedHostSecretsManager.getInstance();
  for (const hostId of hostIds) {
    try {
      await hostSecrets.resyncHost(hostId);
    } catch (error) {
      databaseLogger.warn("Failed to resync host shares after transfer", {
        operation: "transfer_ownership_host_resync",
        hostId,
        error,
      });
    }
  }
  const credentialSecrets = SharedCredentialSecretsManager.getInstance();
  for (const credentialId of credentialIds) {
    try {
      await credentialSecrets.resyncCredential(credentialId, toUserId);
    } catch (error) {
      databaseLogger.warn("Failed to resync credential shares after transfer", {
        operation: "transfer_ownership_credential_resync",
        credentialId,
        error,
      });
    }
  }

  databaseLogger.info("Ownership transferred", {
    operation: "transfer_ownership",
    fromUserId,
    toUserId,
    hosts: hostIds.length,
    credentials: credentialIds.length,
  });
  return { hosts: hostIds.length, credentials: credentialIds.length };
}
