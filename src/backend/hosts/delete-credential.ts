import {
  createCurrentCredentialRepository,
  createCurrentHostRepository,
  createCurrentHostResolutionRepository,
} from "../database/repositories/factory.js";

/**
 * Deletes a credential the user owns: hosts using it fall back to password
 * auth with no secret, and shares are re-snapshotted. Shared by the delete
 * route and sync. Null when it does not exist or is not the user's.
 */
export async function deleteOwnedCredential(
  userId: string,
  credentialId: number,
): Promise<{ name: string | null } | null> {
  const credential =
    await createCurrentCredentialRepository().findDecryptedByIdForUser(
      userId,
      credentialId,
    );
  if (!credential) return null;

  const hostsUsingCredential =
    await createCurrentHostResolutionRepository().listHostsUsingCredentialForUser(
      userId,
      credentialId,
    );

  if (hostsUsingCredential.length > 0) {
    await createCurrentHostRepository().updateManyForUser(
      userId,
      hostsUsingCredential.map((host) => host.id),
      {
        credentialId: null,
        password: null,
        key: null,
        keyPassword: null,
        authType: "password",
      },
    );
  }

  const { SharedHostSecretsManager } =
    await import("../utils/shared-host-secrets-manager.js");
  const sharedSecretsManager = SharedHostSecretsManager.getInstance();
  await sharedSecretsManager.deleteForCredential(credentialId);

  await createCurrentCredentialRepository().deleteForUser(userId, credentialId);

  // Shares stay in place; re-snapshot so recipients fall back to whatever
  // auth the host still has (or lose the stale credential copy).
  for (const host of hostsUsingCredential) {
    await sharedSecretsManager.resyncHost(host.id);
  }
  return { name: (credential.name as string | null) ?? null };
}
