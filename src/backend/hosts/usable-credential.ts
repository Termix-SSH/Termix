import {
  createCurrentCredentialAccessRepository,
  createCurrentCredentialRepository,
  createCurrentHostResolutionRepository,
  createCurrentRoleRepository,
} from "../database/repositories/factory.js";
import type { HostResolutionCredentialRecord } from "../database/repositories/host-resolution-repository.js";
import {
  SharedCredentialSecretsManager,
  snapshotAsCredentialRecord,
} from "../utils/shared-credential-secrets-manager.js";

/**
 * A credential the user may use: their own, or one shared with them (read
 * from their re-encrypted snapshot). This is the one gate that replaces
 * "credentials are a private namespace" - every place that turned a
 * credentialId into secrets goes through here.
 */
export async function findUsableCredential(
  credentialId: number,
  userId: string,
): Promise<HostResolutionCredentialRecord | null> {
  const own =
    await createCurrentHostResolutionRepository().findCredentialByIdForUser(
      credentialId,
      userId,
    );
  if (own) return own;

  const row = await createCurrentCredentialRepository().findById(credentialId);
  if (!row || row.userId === userId) return null;
  const roleIds = await createCurrentRoleRepository().listUserRoleIds(userId);
  const grant = await createCurrentCredentialAccessRepository().findActiveGrant(
    credentialId,
    userId,
    roleIds,
  );
  if (!grant) return null;

  const manager = SharedCredentialSecretsManager.getInstance();
  let data = await manager.getSecretForUser(credentialId, userId);
  if (!data) {
    // No snapshot yet (granted while this user's key was unavailable).
    await manager.snapshotForUser(grant.id, credentialId, userId, row.userId);
    data = await manager.getSecretForUser(credentialId, userId);
  }
  return data ? snapshotAsCredentialRecord(credentialId, row.userId, data) : null;
}
