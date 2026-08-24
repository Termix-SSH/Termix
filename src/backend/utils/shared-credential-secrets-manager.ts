import { DataCrypto } from "./data-crypto.js";
import { FieldCrypto } from "./field-crypto.js";
import { databaseLogger } from "./logger.js";
import {
  createCurrentCredentialAccessRepository,
  createCurrentHostResolutionRepository,
  createCurrentRoleRepository,
  createCurrentSharedCredentialSecretsRepository,
} from "../database/repositories/factory.js";
import type { HostResolutionCredentialRecord } from "../database/repositories/host-resolution-repository.js";

/**
 * Keeps recipients' re-encrypted copies of shared credentials in step with
 * the owner's row. Mirrors SharedHostSecretsManager: snapshots are taken when
 * a share is created, when someone joins a role that holds one, on login as a
 * backstop, and rebuilt whenever the owner edits the credential.
 */
function recordId(accessId: number, targetUserId: string): string {
  return `shared-credential-${accessId}-${targetUserId}`;
}

export interface SharedCredentialData {
  username?: string;
  authType: string;
  password?: string;
  privateKey?: string;
  keyPassword?: string;
  keyType?: string;
  publicKey?: string;
  certPublicKey?: string;
}

class SharedCredentialSecretsManager {
  private static instance: SharedCredentialSecretsManager;

  static getInstance(): SharedCredentialSecretsManager {
    if (!this.instance) this.instance = new SharedCredentialSecretsManager();
    return this.instance;
  }

  async snapshotForUser(
    accessId: number,
    credentialId: number,
    targetUserId: string,
    ownerId: string,
  ): Promise<void> {
    if (targetUserId === ownerId) return;
    const targetDEK = DataCrypto.validateUserAccess(targetUserId);
    DataCrypto.validateUserAccess(ownerId);

    const credential =
      await createCurrentHostResolutionRepository().findCredentialByIdForUser(
        credentialId,
        ownerId,
      );
    if (!credential) throw new Error(`Credential ${credentialId} not found`);

    const id = recordId(accessId, targetUserId);
    const encrypt = (value: string | null | undefined, field: string) =>
      value ? FieldCrypto.encryptField(value, targetDEK, id, field) : null;

    await createCurrentSharedCredentialSecretsRepository().upsert({
      credentialAccessId: accessId,
      targetUserId,
      credentialId,
      encryptedUsername: encrypt(credential.username, "username"),
      authType: credential.authType,
      encryptedPassword: encrypt(credential.password, "password"),
      encryptedKey: encrypt(credential.privateKey || credential.key, "key"),
      encryptedKeyPassword: encrypt(credential.keyPassword, "key_password"),
      keyType: credential.keyType ?? null,
      publicKey: credential.publicKey ?? null,
      certPublicKey: credential.certPublicKey ?? null,
    });
  }

  async snapshotForRole(
    accessId: number,
    credentialId: number,
    roleId: number,
    ownerId: string,
  ): Promise<void> {
    const members = await createCurrentRoleRepository().listRoleUserIds(roleId);
    for (const memberId of members) {
      try {
        await this.snapshotForUser(accessId, credentialId, memberId, ownerId);
      } catch (error) {
        databaseLogger.warn("Failed to snapshot shared credential for role member", {
          operation: "shared_credential_snapshot_role_member",
          accessId,
          memberId,
          error,
        });
      }
    }
  }

  /** A user just joined a role: give them every credential the role holds. */
  async snapshotForRoleMember(roleId: number, targetUserId: string): Promise<void> {
    const grants = await createCurrentCredentialAccessRepository().listRoleGrants(roleId);
    for (const grant of grants) {
      try {
        await this.snapshotForUser(
          grant.accessId,
          grant.credentialId,
          targetUserId,
          grant.ownerId,
        );
      } catch (error) {
        databaseLogger.warn("Failed to snapshot shared credential for new role member", {
          operation: "shared_credential_snapshot_new_member",
          accessId: grant.accessId,
          targetUserId,
          error,
        });
      }
    }
  }

  /** Login backstop: every role the user holds. */
  async snapshotForUserRoles(userId: string): Promise<void> {
    const roleIds = await createCurrentRoleRepository().listUserRoleIds(userId);
    for (const roleId of roleIds) {
      await this.snapshotForRoleMember(roleId, userId);
    }
  }

  /** The owner changed the credential: rebuild every recipient's copy. */
  async resyncCredential(credentialId: number, ownerId: string): Promise<void> {
    const accessRepository = createCurrentCredentialAccessRepository();
    const roleRepository = createCurrentRoleRepository();
    for (const grant of await accessRepository.listActiveGrants(credentialId)) {
      const targets = grant.userId
        ? [grant.userId]
        : grant.roleId
          ? await roleRepository.listRoleUserIds(grant.roleId)
          : [];
      for (const targetUserId of targets) {
        try {
          await this.snapshotForUser(grant.id, credentialId, targetUserId, ownerId);
        } catch (error) {
          databaseLogger.warn("Failed to resync shared credential", {
            operation: "shared_credential_resync",
            credentialId,
            targetUserId,
            error,
          });
        }
      }
    }
  }

  /** The recipient's decrypted copy, if any. */
  async getSecretForUser(
    credentialId: number,
    userId: string,
  ): Promise<SharedCredentialData | null> {
    const secret =
      await createCurrentSharedCredentialSecretsRepository().findForCredentialUser(
        credentialId,
        userId,
      );
    if (!secret) return null;
    const userDEK = DataCrypto.getUserDataKey(userId);
    if (!userDEK) return null;
    const id = recordId(secret.credentialAccessId, secret.targetUserId);
    const decrypt = (value: string | null, field: string) =>
      value ? FieldCrypto.decryptField(value, userDEK, id, field) : undefined;
    return {
      username: decrypt(secret.encryptedUsername, "username"),
      authType: secret.authType,
      password: decrypt(secret.encryptedPassword, "password"),
      privateKey: decrypt(secret.encryptedKey, "key"),
      keyPassword: decrypt(secret.encryptedKeyPassword, "key_password"),
      keyType: secret.keyType ?? undefined,
      publicKey: secret.publicKey ?? undefined,
      certPublicKey: secret.certPublicKey ?? undefined,
    };
  }
}

/** Shapes a recipient's snapshot like the owner's decrypted credential row. */
export function snapshotAsCredentialRecord(
  credentialId: number,
  ownerId: string,
  data: SharedCredentialData,
): HostResolutionCredentialRecord {
  return {
    id: credentialId,
    userId: ownerId,
    username: data.username ?? null,
    authType: data.authType,
    password: data.password ?? null,
    key: null,
    privateKey: data.privateKey ?? null,
    keyPassword: data.keyPassword ?? null,
    keyType: data.keyType ?? null,
    publicKey: data.publicKey ?? null,
    certPublicKey: data.certPublicKey ?? null,
  } as unknown as HostResolutionCredentialRecord;
}

export { SharedCredentialSecretsManager };
