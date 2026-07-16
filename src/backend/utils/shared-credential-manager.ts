import { createCurrentCredentialRepository } from "../database/repositories/current-credential-repository.js";
import { createCurrentRbacAccessRepository } from "../database/repositories/current-rbac-access-repository.js";
import { createCurrentRoleRepository } from "../database/repositories/current-role-repository.js";
import { createCurrentSharedCredentialRepository } from "../database/repositories/current-shared-credential-repository.js";
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

      const ownerDEK = DataCrypto.getUserDataKey(ownerId);

      if (ownerDEK) {
        const targetDEK = DataCrypto.getUserDataKey(targetUserId);
        if (!targetDEK) {
          await this.createPendingSharedCredential(
            hostAccessId,
            originalCredentialId,
            targetUserId,
          );
          return;
        }

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
          needsReEncryption: false,
        });
      } else {
        const targetDEK = DataCrypto.getUserDataKey(targetUserId);
        if (!targetDEK) {
          await this.createPendingSharedCredential(
            hostAccessId,
            originalCredentialId,
            targetUserId,
          );
          return;
        }

        const credentialData =
          await this.getDecryptedCredentialViaSystemKey(originalCredentialId);

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
          needsReEncryption: false,
        });
      }
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
      const userDEK = DataCrypto.getUserDataKey(userId);
      if (!userDEK) {
        throw new Error(`User ${userId} data not unlocked`);
      }

      const cred =
        await createCurrentRbacAccessRepository().findSharedCredentialForHostAndUser(
          hostId,
          userId,
        );

      if (!cred) {
        return null;
      }

      if (cred.needsReEncryption) {
        await this.reEncryptSharedCredential(cred.id, userId);

        const refreshed =
          await createCurrentSharedCredentialRepository().findById(cred.id);

        if (!refreshed || refreshed.needsReEncryption) {
          databaseLogger.warn(
            "Shared credential needs re-encryption but cannot be accessed yet",
            {
              operation: "get_shared_credential_pending",
              hostId,
              userId,
            },
          );
          return null;
        }

        return this.decryptSharedCredential(refreshed, userDEK);
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

      const ownerDEK = DataCrypto.getUserDataKey(ownerId);
      let credentialData: CredentialData;

      if (ownerDEK) {
        credentialData = await this.getDecryptedCredential(
          credentialId,
          ownerId,
          ownerDEK,
        );
      } else {
        try {
          credentialData =
            await this.getDecryptedCredentialViaSystemKey(credentialId);
        } catch (error) {
          databaseLogger.warn(
            "Cannot update shared credentials: owner offline and credential not migrated",
            {
              operation: "update_shared_credentials_failed",
              credentialId,
              ownerId,
              error: error instanceof Error ? error.message : "Unknown error",
            },
          );
          await sharedCredentialRepository.markNeedsReEncryptionByOriginalCredentialId(
            credentialId,
          );
          return;
        }
      }

      for (const sharedCred of sharedCreds) {
        const targetDEK = DataCrypto.getUserDataKey(sharedCred.targetUserId);

        if (!targetDEK) {
          await sharedCredentialRepository.updateById(sharedCred.id, {
            needsReEncryption: true,
          });
          continue;
        }

        const encryptedForTarget = this.encryptCredentialForUser(
          credentialData,
          sharedCred.targetUserId,
          targetDEK,
          sharedCred.hostAccessId,
        );

        await sharedCredentialRepository.updateById(sharedCred.id, {
          ...encryptedForTarget,
          needsReEncryption: false,
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

  async reEncryptPendingCredentialsForUser(userId: string): Promise<void> {
    try {
      const userDEK = DataCrypto.getUserDataKey(userId);
      if (!userDEK) {
        return;
      }

      const pendingCreds =
        await createCurrentSharedCredentialRepository().listPendingByTargetUserId(
          userId,
        );

      for (const cred of pendingCreds) {
        await this.reEncryptSharedCredential(cred.id, userId);
      }
    } catch (error) {
      databaseLogger.error("Failed to re-encrypt pending credentials", error, {
        operation: "reencrypt_pending_credentials",
        userId,
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

  private async getDecryptedCredentialViaSystemKey(
    credentialId: number,
  ): Promise<CredentialData> {
    const cred =
      await createCurrentCredentialRepository().findById(credentialId);

    if (!cred) {
      throw new Error(`Credential ${credentialId} not found`);
    }

    if (!cred.systemPassword && !cred.systemKey && !cred.systemKeyPassword) {
      throw new Error(
        "Credential not yet migrated for offline sharing. " +
          "Please ask credential owner to log in to enable sharing.",
      );
    }

    const { SystemCrypto } = await import("./system-crypto.js");
    const systemCrypto = SystemCrypto.getInstance();
    const CSKEK = await systemCrypto.getCredentialSharingKey();

    return {
      username: cred.username,
      authType: cred.authType,
      password: cred.systemPassword
        ? this.decryptField(
            cred.systemPassword,
            CSKEK,
            credentialId,
            "password",
          )
        : undefined,
      key: cred.systemKey
        ? this.decryptField(cred.systemKey, CSKEK, credentialId, "key")
        : undefined,
      keyPassword: cred.systemKeyPassword
        ? this.decryptField(
            cred.systemKeyPassword,
            CSKEK,
            credentialId,
            "key_password",
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

  private async createPendingSharedCredential(
    hostAccessId: number,
    originalCredentialId: number,
    targetUserId: string,
  ): Promise<void> {
    await createCurrentSharedCredentialRepository().create({
      hostAccessId,
      originalCredentialId,
      targetUserId,
      encryptedUsername: "",
      encryptedAuthType: "",
      needsReEncryption: true,
    });

    databaseLogger.info("Created pending shared credential", {
      operation: "create_pending_shared_credential",
      hostAccessId,
      targetUserId,
    });
  }

  private async reEncryptSharedCredential(
    sharedCredId: number,
    userId: string,
  ): Promise<void> {
    try {
      const cred =
        await createCurrentSharedCredentialRepository().findById(sharedCredId);

      if (!cred) {
        databaseLogger.warn("Re-encrypt: shared credential not found", {
          operation: "reencrypt_not_found",
          sharedCredId,
        });
        return;
      }

      const ownerId =
        await createCurrentRbacAccessRepository().findHostAccessOwnerId(
          cred.hostAccessId,
        );

      if (!ownerId) {
        databaseLogger.warn("Re-encrypt: host access not found", {
          operation: "reencrypt_access_not_found",
          sharedCredId,
        });
        return;
      }

      const userDEK = DataCrypto.getUserDataKey(userId);
      if (!userDEK) {
        databaseLogger.warn("Re-encrypt: user DEK not available", {
          operation: "reencrypt_user_offline",
          sharedCredId,
          userId,
        });
        return;
      }

      const ownerDEK = DataCrypto.getUserDataKey(ownerId);
      let credentialData: CredentialData;

      if (ownerDEK) {
        credentialData = await this.getDecryptedCredential(
          cred.originalCredentialId,
          ownerId,
          ownerDEK,
        );
      } else {
        try {
          credentialData = await this.getDecryptedCredentialViaSystemKey(
            cred.originalCredentialId,
          );
        } catch (error) {
          databaseLogger.warn(
            "Re-encrypt: system key decryption failed, credential may not be migrated yet",
            {
              operation: "reencrypt_system_key_failed",
              sharedCredId,
              error: error instanceof Error ? error.message : "Unknown error",
            },
          );
          return;
        }
      }

      const encryptedForTarget = this.encryptCredentialForUser(
        credentialData,
        userId,
        userDEK,
        cred.hostAccessId,
      );

      await createCurrentSharedCredentialRepository().updateById(sharedCredId, {
        ...encryptedForTarget,
        needsReEncryption: false,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      databaseLogger.error("Failed to re-encrypt shared credential", error, {
        operation: "reencrypt_shared_credential",
        sharedCredId,
        userId,
      });
    }
  }
}

export { SharedCredentialManager };
