import {
  createCurrentCredentialAccessRepository,
  createCurrentCredentialRepository,
  createCurrentHostRepository,
  createCurrentRbacAccessRepository,
} from "../database/repositories/factory.js";
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
  const credentialIds =
    await createCurrentCredentialRepository().transferAllToUser(
      fromUserId,
      toUserId,
    );
  const hostIds = await createCurrentHostRepository().transferAllToUser(
    fromUserId,
    toUserId,
  );
  await createCurrentRbacAccessRepository().reassignHostAccessGrantedBy(
    fromUserId,
    toUserId,
  );
  await createCurrentCredentialAccessRepository().reassignGrantedBy(
    fromUserId,
    toUserId,
  );

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
