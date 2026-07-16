import {
  createCurrentCredentialRepository,
  createCurrentRbacAccessRepository,
  createCurrentRoleRepository,
  createCurrentSharedCredentialRepository,
} from "../database/repositories/factory.js";
import type { SharedCredentialRecord } from "../database/repositories/shared-credential-repository.js";
import { DataCrypto } from "./data-crypto.js";
import { FieldCrypto } from "./field-crypto.js";
import { databaseLogger } from "./logger.js";

interface CredentialData {
  username: string;
  authType: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
}

// Shared credentials are per-target copies of the owner's credential,
// re-encrypted under the target user's DEK at share time.
class SharedCredentialManager {
  private static instance: SharedCredentialManager;

  private constructor() {}

  static getInstance(): SharedCredentialManager {
    if (!this.instance) {
      this.instance = new SharedCredentialManager();
    }
    return this.instance;
  }

  async createSharedCredentialForUser(
    hostAccessId: number,
    originalCredentialId: number,
    targetUserId: string,
    ownerId: string,
  ): Promise<void> {
    try {
      const sharedCredentialRepository =
        createCurrentSharedCredentialRepository();
      const existing =
        await sharedCredentialRepository.existsForHostAccessAndTargetUser(
          hostAccessId,
          targetUserId,
        );

      if (existing) return;

      const ownerDEK = DataCrypto.validateUserAccess(ownerId);
      const targetDEK = DataCrypto.validateUserAccess(targetUserId);

      const credentialData = await this.getDecryptedCredential(
        originalCredentialId,
        ownerId,
        ownerDEK,
      );

      const encryptedForTarget = this.encryptCredentialForUser(
        credentialData,
        targetUserId,
        targetDEK,
        hostAccessId,
      );

      await sharedCredentialRepository.create({
        hostAccessId,
        originalCredentialId,
        targetUserId,
        ...encryptedForTarget,
      });
    } catch (error) {
      databaseLogger.error("Failed to create shared credential", error, {
        operation: "create_shared_credential",
        hostAccessId,
        targetUserId,
      });
      throw error;
    }
  }

  async createSharedCredentialsForRole(
    hostAccessId: number,
    originalCredentialId: number,
    roleId: number,
    ownerId: string,
  ): Promise<void> {
    try {
      const roleUserIds =
        await createCurrentRoleRepository().listRoleUserIds(roleId);

      for (const userId of roleUserIds) {
        try {
          await this.createSharedCredentialForUser(
            hostAccessId,
            originalCredentialId,
            userId,
            ownerId,
          );
        } catch (error) {
          databaseLogger.error(
            "Failed to create shared credential for role member",
            error,
            {
              operation: "create_shared_credentials_role",
              hostAccessId,
              roleId,
              userId,
            },
          );
        }
      }
    } catch (error) {
      databaseLogger.error(
        "Failed to create shared credentials for role",
        error,
        {
          operation: "create_shared_credentials_role",
          hostAccessId,
          roleId,
        },
      );
      throw error;
    }
  }

  async createSharedCredentialsForRoleMember(
    roleId: number,
    targetUserId: string,
  ): Promise<void> {
    try {
      const hostsSharedWithRole =
        await createCurrentRbacAccessRepository().listRoleHostAccessCredentialSources(
          roleId,
        );

      for (const sharedHost of hostsSharedWithRole) {
        const activeCredentialId =
          sharedHost.credentialId ??
          sharedHost.rdpCredentialId ??
          sharedHost.vncCredentialId ??
          sharedHost.telnetCredentialId;

        if (!activeCredentialId) continue;

        try {
          await this.createSharedCredentialForUser(
            sharedHost.hostAccessId,
            activeCredentialId,
            targetUserId,
            sharedHost.hostOwnerId,
          );
        } catch (error) {
          databaseLogger.error(
            "Failed to create shared credential for role member",
            error,
            {
              operation: "create_shared_credentials_role_member",
              roleId,
              targetUserId,
              hostId: sharedHost.hostId,
            },
          );
        }
      }
    } catch (error) {
      databaseLogger.error(
        "Failed to create shared credentials for role member",
        error,
        {
          operation: "create_shared_credentials_role_member",
          roleId,
          targetUserId,
        },
      );
      throw error;
    }
  }

  async createSharedCredentialsForUserRoles(userId: string): Promise<void> {
    try {
      const roleIds =
        await createCurrentRoleRepository().listUserRoleIds(userId);

      for (const roleId of roleIds) {
        await this.createSharedCredentialsForRoleMember(roleId, userId);
      }
    } catch (error) {
      databaseLogger.error(
        "Failed to create shared credentials for user roles",
        error,
        {
          operation: "create_shared_credentials_user_roles",
          userId,
        },
      );
      throw error;
    }
  }

  async getSharedCredentialForUser(
    hostId: number,
    userId: string,
  ): Promise<CredentialData | null> {
    try {
      const userDEK = DataCrypto.validateUserAccess(userId);

      const cred =
        await createCurrentRbacAccessRepository().findSharedCredentialForHostAndUser(
          hostId,
          userId,
        );

      if (!cred) {
        return null;
      }

      return this.decryptSharedCredential(cred, userDEK);
    } catch (error) {
      databaseLogger.error("Failed to get shared credential", error, {
        operation: "get_shared_credential",
        hostId,
        userId,
      });
      throw error;
    }
  }

  async updateSharedCredentialsForOriginal(
    credentialId: number,
    ownerId: string,
  ): Promise<void> {
    try {
      const sharedCredentialRepository =
        createCurrentSharedCredentialRepository();
      const sharedCreds =
        await sharedCredentialRepository.listByOriginalCredentialId(
          credentialId,
        );

      if (sharedCreds.length === 0) return;

      const ownerDEK = DataCrypto.validateUserAccess(ownerId);
      const credentialData = await this.getDecryptedCredential(
        credentialId,
        ownerId,
        ownerDEK,
      );

      for (const sharedCred of sharedCreds) {
        const targetDEK = DataCrypto.validateUserAccess(
          sharedCred.targetUserId,
        );

        const encryptedForTarget = this.encryptCredentialForUser(
          credentialData,
          sharedCred.targetUserId,
          targetDEK,
          sharedCred.hostAccessId,
        );

        await sharedCredentialRepository.updateById(sharedCred.id, {
          ...encryptedForTarget,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      databaseLogger.error("Failed to update shared credentials", error, {
        operation: "update_shared_credentials",
        credentialId,
      });
    }
  }

  async deleteSharedCredentialsForOriginal(
    credentialId: number,
  ): Promise<void> {
    try {
      await createCurrentSharedCredentialRepository().deleteByOriginalCredentialId(
        credentialId,
      );
    } catch (error) {
      databaseLogger.error("Failed to delete shared credentials", error, {
        operation: "delete_shared_credentials",
        credentialId,
      });
    }
  }

  private async getDecryptedCredential(
    credentialId: number,
    ownerId: string,
    ownerDEK: Buffer,
  ): Promise<CredentialData> {
    const cred = await createCurrentCredentialRepository().findByIdForUser(
      ownerId,
      credentialId,
    );

    if (!cred) {
      throw new Error(`Credential ${credentialId} not found`);
    }

    return {
      username: cred.username,
      authType: cred.authType,
      password: cred.password
        ? this.decryptField(cred.password, ownerDEK, credentialId, "password")
        : undefined,
      key: cred.key
        ? this.decryptField(cred.key, ownerDEK, credentialId, "key")
        : undefined,
      keyPassword: cred.keyPassword
        ? this.decryptField(
            cred.keyPassword,
            ownerDEK,
            credentialId,
            "keyPassword",
          )
        : undefined,
      keyType: cred.keyType,
    };
  }

  private encryptCredentialForUser(
    credentialData: CredentialData,
    targetUserId: string,
    targetDEK: Buffer,
    hostAccessId: number,
  ): {
    encryptedUsername: string;
    encryptedAuthType: string;
    encryptedPassword: string | null;
    encryptedKey: string | null;
    encryptedKeyPassword: string | null;
    encryptedKeyType: string | null;
  } {
    const recordId = `shared-${hostAccessId}-${targetUserId}`;

    return {
      encryptedUsername: FieldCrypto.encryptField(
        credentialData.username,
        targetDEK,
        recordId,
        "username",
      ),
      encryptedAuthType: credentialData.authType,
      encryptedPassword: credentialData.password
        ? FieldCrypto.encryptField(
            credentialData.password,
            targetDEK,
            recordId,
            "password",
          )
        : null,
      encryptedKey: credentialData.key
        ? FieldCrypto.encryptField(
            credentialData.key,
            targetDEK,
            recordId,
            "key",
          )
        : null,
      encryptedKeyPassword: credentialData.keyPassword
        ? FieldCrypto.encryptField(
            credentialData.keyPassword,
            targetDEK,
            recordId,
            "key_password",
          )
        : null,
      encryptedKeyType: credentialData.keyType || null,
    };
  }

  private decryptSharedCredential(
    sharedCred: SharedCredentialRecord,
    userDEK: Buffer,
  ): CredentialData {
    const recordId = `shared-${sharedCred.hostAccessId}-${sharedCred.targetUserId}`;

    return {
      username: FieldCrypto.decryptField(
        sharedCred.encryptedUsername,
        userDEK,
        recordId,
        "username",
      ),
      authType: sharedCred.encryptedAuthType,
      password: sharedCred.encryptedPassword
        ? FieldCrypto.decryptField(
            sharedCred.encryptedPassword,
            userDEK,
            recordId,
            "password",
          )
        : undefined,
      key: sharedCred.encryptedKey
        ? FieldCrypto.decryptField(
            sharedCred.encryptedKey,
            userDEK,
            recordId,
            "key",
          )
        : undefined,
      keyPassword: sharedCred.encryptedKeyPassword
        ? FieldCrypto.decryptField(
            sharedCred.encryptedKeyPassword,
            userDEK,
            recordId,
            "key_password",
          )
        : undefined,
      keyType: sharedCred.encryptedKeyType || undefined,
    };
  }

  private decryptField(
    encryptedValue: string,
    dek: Buffer,
    recordId: number | string,
    fieldName: string,
  ): string {
    try {
      return FieldCrypto.decryptField(
        encryptedValue,
        dek,
        recordId.toString(),
        fieldName,
      );
    } catch {
      databaseLogger.warn("Field decryption failed, returning as-is", {
        operation: "decrypt_field",
        fieldName,
        recordId,
      });
      return encryptedValue;
    }
  }
}

export { SharedCredentialManager };
