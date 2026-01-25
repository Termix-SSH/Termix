import { db } from "../database/db/index.js";
import {
  sharedCredentials,
  sshCredentials,
  hostAccess,
  users,
  userRoles,
  sshData,
} from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
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

        await db.insert(sharedCredentials).values({
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

        await db.insert(sharedCredentials).values({
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
      const roleUsers = await db
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.roleId, roleId));

      for (const { userId } of roleUsers) {
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

  async getSharedCredentialForUser(
    hostId: number,
    userId: string,
  ): Promise<CredentialData | null> {
    try {
      const userDEK = DataCrypto.getUserDataKey(userId);
      if (!userDEK) {
        throw new Error(`User ${userId} data not unlocked`);
      }

      const sharedCred = await db
        .select()
        .from(sharedCredentials)
        .innerJoin(
          hostAccess,
          eq(sharedCredentials.hostAccessId, hostAccess.id),
        )
        .where(
          and(
            eq(hostAccess.hostId, hostId),
            eq(sharedCredentials.targetUserId, userId),
          ),
        )
        .limit(1);

      if (sharedCred.length === 0) {
        return null;
      }

      const cred = sharedCred[0].shared_credentials;

      if (cred.needsReEncryption) {
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
      const sharedCreds = await db
        .select()
        .from(sharedCredentials)
        .where(eq(sharedCredentials.originalCredentialId, credentialId));

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
          await db
            .update(sharedCredentials)
            .set({ needsReEncryption: true })
            .where(eq(sharedCredentials.originalCredentialId, credentialId));
          return;
        }
      }

      for (const sharedCred of sharedCreds) {
        const targetDEK = DataCrypto.getUserDataKey(sharedCred.targetUserId);

        if (!targetDEK) {
          await db
            .update(sharedCredentials)
            .set({ needsReEncryption: true })
            .where(eq(sharedCredentials.id, sharedCred.id));
          continue;
        }

        const encryptedForTarget = this.encryptCredentialForUser(
          credentialData,
          sharedCred.targetUserId,
          targetDEK,
          sharedCred.hostAccessId,
        );

        await db
          .update(sharedCredentials)
          .set({
            ...encryptedForTarget,
            needsReEncryption: false,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(sharedCredentials.id, sharedCred.id));
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
      const result = await db
        .delete(sharedCredentials)
        .where(eq(sharedCredentials.originalCredentialId, credentialId))
        .returning({ id: sharedCredentials.id });
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

      const pendingCreds = await db
        .select()
        .from(sharedCredentials)
        .where(
          and(
            eq(sharedCredentials.targetUserId, userId),
            eq(sharedCredentials.needsReEncryption, true),
          ),
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
    const creds = await db
      .select()
      .from(sshCredentials)
      .where(
        and(
          eq(sshCredentials.id, credentialId),
          eq(sshCredentials.userId, ownerId),
        ),
      )
      .limit(1);

    if (creds.length === 0) {
      throw new Error(`Credential ${credentialId} not found`);
    }

    const cred = creds[0];

    return {
      username: cred.username,
      authType: cred.authType,
      password: cred.password
        ? this.decryptField(cred.password, ownerDEK, credentialId, "password")
        : undefined,
      key: cred.key
        ? this.decryptField(cred.key, ownerDEK, credentialId, "key")
        : undefined,
      keyPassword: cred.key_password
        ? this.decryptField(
            cred.key_password,
            ownerDEK,
            credentialId,
            "key_password",
          )
        : undefined,
      keyType: cred.keyType,
    };
  }

  private async getDecryptedCredentialViaSystemKey(
    credentialId: number,
  ): Promise<CredentialData> {
    const creds = await db
      .select()
      .from(sshCredentials)
      .where(eq(sshCredentials.id, credentialId))
      .limit(1);

    if (creds.length === 0) {
      throw new Error(`Credential ${credentialId} not found`);
    }

    const cred = creds[0];

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
    sharedCred: typeof sharedCredentials.$inferSelect,
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
    } catch (error) {
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
    await db.insert(sharedCredentials).values({
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
      const sharedCred = await db
        .select()
        .from(sharedCredentials)
        .where(eq(sharedCredentials.id, sharedCredId))
        .limit(1);

      if (sharedCred.length === 0) {
        databaseLogger.warn("Re-encrypt: shared credential not found", {
          operation: "reencrypt_not_found",
          sharedCredId,
        });
        return;
      }

      const cred = sharedCred[0];

      const access = await db
        .select()
        .from(hostAccess)
        .innerJoin(sshData, eq(hostAccess.hostId, sshData.id))
        .where(eq(hostAccess.id, cred.hostAccessId))
        .limit(1);

      if (access.length === 0) {
        databaseLogger.warn("Re-encrypt: host access not found", {
          operation: "reencrypt_access_not_found",
          sharedCredId,
        });
        return;
      }

      const ownerId = access[0].ssh_data.userId;

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

      await db
        .update(sharedCredentials)
        .set({
          ...encryptedForTarget,
          needsReEncryption: false,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(sharedCredentials.id, sharedCredId));
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
