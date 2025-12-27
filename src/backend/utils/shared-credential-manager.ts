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

/**
 * Manages shared credentials for RBAC host sharing.
 * Creates per-user encrypted credential copies to enable credential sharing
 * without requiring the credential owner to be online.
 */
class SharedCredentialManager {
  private static instance: SharedCredentialManager;

  private constructor() {}

  static getInstance(): SharedCredentialManager {
    if (!this.instance) {
      this.instance = new SharedCredentialManager();
    }
    return this.instance;
  }

  /**
   * Create shared credential for a specific user
   * Called when sharing a host with a user
   */
  async createSharedCredentialForUser(
    hostAccessId: number,
    originalCredentialId: number,
    targetUserId: string,
    ownerId: string,
  ): Promise<void> {
    try {
      // Try owner's DEK first (existing path)
      const ownerDEK = DataCrypto.getUserDataKey(ownerId);

      if (ownerDEK) {
        // Owner online - use existing flow
        const targetDEK = DataCrypto.getUserDataKey(targetUserId);
        if (!targetDEK) {
          // Target user is offline, mark for lazy re-encryption
          await this.createPendingSharedCredential(
            hostAccessId,
            originalCredentialId,
            targetUserId,
          );
          return;
        }

        // Fetch and decrypt original credential using owner's DEK
        const credentialData = await this.getDecryptedCredential(
          originalCredentialId,
          ownerId,
          ownerDEK,
        );

        // Encrypt credential data with target user's DEK
        const encryptedForTarget = this.encryptCredentialForUser(
          credentialData,
          targetUserId,
          targetDEK,
          hostAccessId,
        );

        // Store shared credential
        await db.insert(sharedCredentials).values({
          hostAccessId,
          originalCredentialId,
          targetUserId,
          ...encryptedForTarget,
          needsReEncryption: false,
        });

        databaseLogger.info("Created shared credential for user", {
          operation: "create_shared_credential",
          hostAccessId,
          targetUserId,
        });
      } else {
        // NEW: Owner offline - use system key fallback
        databaseLogger.info(
          "Owner offline, attempting to share using system key",
          {
            operation: "create_shared_credential_system_key",
            hostAccessId,
            targetUserId,
            ownerId,
          },
        );

        // Get target user's DEK
        const targetDEK = DataCrypto.getUserDataKey(targetUserId);
        if (!targetDEK) {
          // Both offline - create pending
          await this.createPendingSharedCredential(
            hostAccessId,
            originalCredentialId,
            targetUserId,
          );
          return;
        }

        // Decrypt using system key
        const credentialData =
          await this.getDecryptedCredentialViaSystemKey(originalCredentialId);

        // Encrypt for target user
        const encryptedForTarget = this.encryptCredentialForUser(
          credentialData,
          targetUserId,
          targetDEK,
          hostAccessId,
        );

        // Store shared credential
        await db.insert(sharedCredentials).values({
          hostAccessId,
          originalCredentialId,
          targetUserId,
          ...encryptedForTarget,
          needsReEncryption: false,
        });

        databaseLogger.info("Created shared credential using system key", {
          operation: "create_shared_credential_system_key",
          hostAccessId,
          targetUserId,
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

  /**
   * Create shared credentials for all users in a role
   * Called when sharing a host with a role
   */
  async createSharedCredentialsForRole(
    hostAccessId: number,
    originalCredentialId: number,
    roleId: number,
    ownerId: string,
  ): Promise<void> {
    try {
      // Get all users in the role
      const roleUsers = await db
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.roleId, roleId));

      // Create shared credential for each user
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
          // Continue with other users even if one fails
        }
      }

      databaseLogger.info("Created shared credentials for role", {
        operation: "create_shared_credentials_role",
        hostAccessId,
        roleId,
        userCount: roleUsers.length,
      });
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

  /**
   * Get credential data for a shared user
   * Called when a shared user connects to a host
   */
  async getSharedCredentialForUser(
    hostId: number,
    userId: string,
  ): Promise<CredentialData | null> {
    try {
      const userDEK = DataCrypto.getUserDataKey(userId);
      if (!userDEK) {
        throw new Error(`User ${userId} data not unlocked`);
      }

      // Find shared credential via hostAccess
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

      // Check if needs re-encryption
      if (cred.needsReEncryption) {
        databaseLogger.warn(
          "Shared credential needs re-encryption but cannot be accessed yet",
          {
            operation: "get_shared_credential_pending",
            hostId,
            userId,
          },
        );
        // Credential is pending re-encryption - owner must be offline
        // Return null instead of trying to re-encrypt (which would cause infinite loop)
        return null;
      }

      // Decrypt credential data with user's DEK
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

  /**
   * Update all shared credentials when original credential is updated
   * Called when credential owner updates credential
   */
  async updateSharedCredentialsForOriginal(
    credentialId: number,
    ownerId: string,
  ): Promise<void> {
    try {
      // Get all shared credentials for this original credential
      const sharedCreds = await db
        .select()
        .from(sharedCredentials)
        .where(eq(sharedCredentials.originalCredentialId, credentialId));

      // Try owner's DEK first
      const ownerDEK = DataCrypto.getUserDataKey(ownerId);
      let credentialData: CredentialData;

      if (ownerDEK) {
        // Owner online - use owner's DEK
        credentialData = await this.getDecryptedCredential(
          credentialId,
          ownerId,
          ownerDEK,
        );
      } else {
        // Owner offline - use system key fallback
        databaseLogger.info(
          "Updating shared credentials using system key (owner offline)",
          {
            operation: "update_shared_credentials_system_key",
            credentialId,
            ownerId,
          },
        );

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
          // Mark all shared credentials for re-encryption
          await db
            .update(sharedCredentials)
            .set({ needsReEncryption: true })
            .where(eq(sharedCredentials.originalCredentialId, credentialId));
          return;
        }
      }

      // Update each shared credential
      for (const sharedCred of sharedCreds) {
        const targetDEK = DataCrypto.getUserDataKey(sharedCred.targetUserId);

        if (!targetDEK) {
          // Target user offline, mark for lazy re-encryption
          await db
            .update(sharedCredentials)
            .set({ needsReEncryption: true })
            .where(eq(sharedCredentials.id, sharedCred.id));
          continue;
        }

        // Re-encrypt with target user's DEK
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

      databaseLogger.info("Updated shared credentials for original", {
        operation: "update_shared_credentials",
        credentialId,
        count: sharedCreds.length,
      });
    } catch (error) {
      databaseLogger.error("Failed to update shared credentials", error, {
        operation: "update_shared_credentials",
        credentialId,
      });
    }
  }

  /**
   * Delete shared credentials when original credential is deleted
   * Called from credential deletion route
   */
  async deleteSharedCredentialsForOriginal(
    credentialId: number,
  ): Promise<void> {
    try {
      const result = await db
        .delete(sharedCredentials)
        .where(eq(sharedCredentials.originalCredentialId, credentialId))
        .returning({ id: sharedCredentials.id });

      databaseLogger.info("Deleted shared credentials for original", {
        operation: "delete_shared_credentials",
        credentialId,
        count: result.length,
      });
    } catch (error) {
      databaseLogger.error("Failed to delete shared credentials", error, {
        operation: "delete_shared_credentials",
        credentialId,
      });
    }
  }

  /**
   * Re-encrypt pending shared credentials for a user when they log in
   * Called during user login
   */
  async reEncryptPendingCredentialsForUser(userId: string): Promise<void> {
    try {
      const userDEK = DataCrypto.getUserDataKey(userId);
      if (!userDEK) {
        return; // User not unlocked yet
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

      if (pendingCreds.length > 0) {
        databaseLogger.info("Re-encrypted pending credentials for user", {
          operation: "reencrypt_pending_credentials",
          userId,
          count: pendingCreds.length,
        });
      }
    } catch (error) {
      databaseLogger.error("Failed to re-encrypt pending credentials", error, {
        operation: "reencrypt_pending_credentials",
        userId,
      });
    }
  }

  // ========== PRIVATE HELPER METHODS ==========

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

    // Decrypt sensitive fields
    // Note: username and authType are NOT encrypted
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

  /**
   * Decrypt credential using system key (for offline sharing when owner is offline)
   */
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

    // Check if system fields exist
    if (!cred.systemPassword && !cred.systemKey && !cred.systemKeyPassword) {
      throw new Error(
        "Credential not yet migrated for offline sharing. " +
          "Please ask credential owner to log in to enable sharing.",
      );
    }

    // Get system key
    const { SystemCrypto } = await import("./system-crypto.js");
    const systemCrypto = SystemCrypto.getInstance();
    const CSKEK = await systemCrypto.getCredentialSharingKey();

    // Decrypt using system-encrypted fields
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
      encryptedAuthType: credentialData.authType, // authType is not sensitive
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
      // If decryption fails, value might not be encrypted (legacy data)
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
    // Create placeholder with needsReEncryption flag
    await db.insert(sharedCredentials).values({
      hostAccessId,
      originalCredentialId,
      targetUserId,
      encryptedUsername: "", // Will be filled during re-encryption
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
      // Get the shared credential
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

      // Get the host access to find the owner
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

      // Get user's DEK (must be available)
      const userDEK = DataCrypto.getUserDataKey(userId);
      if (!userDEK) {
        databaseLogger.warn("Re-encrypt: user DEK not available", {
          operation: "reencrypt_user_offline",
          sharedCredId,
          userId,
        });
        // User offline, keep pending
        return;
      }

      // Try owner's DEK first
      const ownerDEK = DataCrypto.getUserDataKey(ownerId);
      let credentialData: CredentialData;

      if (ownerDEK) {
        // Owner online - use owner's DEK
        credentialData = await this.getDecryptedCredential(
          cred.originalCredentialId,
          ownerId,
          ownerDEK,
        );
      } else {
        // Owner offline - use system key fallback
        databaseLogger.info("Re-encrypt: using system key (owner offline)", {
          operation: "reencrypt_system_key",
          sharedCredId,
          ownerId,
        });

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
          // Keep pending if system fields don't exist yet
          return;
        }
      }

      // Re-encrypt for user
      const encryptedForTarget = this.encryptCredentialForUser(
        credentialData,
        userId,
        userDEK,
        cred.hostAccessId,
      );

      // Update shared credential
      await db
        .update(sharedCredentials)
        .set({
          ...encryptedForTarget,
          needsReEncryption: false,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(sharedCredentials.id, sharedCredId));

      databaseLogger.info("Re-encrypted shared credential successfully", {
        operation: "reencrypt_shared_credential",
        sharedCredId,
        userId,
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
