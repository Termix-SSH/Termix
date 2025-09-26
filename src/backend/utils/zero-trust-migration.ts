import crypto from "crypto";
import { getDb } from "../database/db/index.js";
import { users, settings } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import { databaseLogger } from "./logger.js";
import { UserCrypto, type EncryptedDEK } from "./user-crypto.js";

/**
 * ZeroTrustMigration - Handle migration between compromise and zero-trust modes
 *
 * Linus principles:
 * - Simple migration path with clear rollback capability
 * - User controls the security tradeoff
 * - Future-proof architecture for security upgrades
 */
export class ZeroTrustMigration {
  private static instance: ZeroTrustMigration;

  private constructor() {}

  static getInstance(): ZeroTrustMigration {
    if (!this.instance) {
      this.instance = new ZeroTrustMigration();
    }
    return this.instance;
  }

  /**
   * Check if user can migrate to zero-trust mode
   */
  async canMigrateToZeroTrust(userId: string): Promise<boolean> {
    try {
      const db = getDb();
      const user = await db.select().from(users).where(eq(users.id, userId));

      if (!user || user.length === 0) {
        return false;
      }

      // Must have recovery data and be in compromise mode
      return !!(user[0].recovery_dek && !user[0].zero_trust_mode);
    } catch (error) {
      databaseLogger.error("Failed to check zero-trust migration eligibility", error, {
        operation: "zero_trust_check_failed",
        userId,
      });
      return false;
    }
  }

  /**
   * Migrate user to zero-trust mode
   * Returns recovery seed for user to save
   */
  async migrateUserToZeroTrust(userId: string): Promise<string | null> {
    try {
      const db = getDb();
      const user = await db.select().from(users).where(eq(users.id, userId));

      if (!user || user.length === 0) {
        throw new Error("User not found");
      }

      const userData = user[0];
      if (!userData.recovery_dek || !userData.backup_encrypted_dek) {
        throw new Error("No recovery data available");
      }

      if (userData.zero_trust_mode) {
        throw new Error("User already in zero-trust mode");
      }

      // Generate user recovery seed (256-bit)
      const userRecoverySeed = crypto.randomBytes(32).toString('hex');

      // Get current DEK from plaintext recovery data
      const userCrypto = UserCrypto.getInstance();
      const recoveryDEK = Buffer.from(userData.recovery_dek, 'hex');
      const backupEncryptedDEK = JSON.parse(userData.backup_encrypted_dek);
      const originalDEK = (userCrypto as any).decryptDEK(backupEncryptedDEK, recoveryDEK);

      // Create user recovery key from seed
      const userRecoveryKey = crypto.pbkdf2Sync(
        userRecoverySeed,
        'zero_trust_recovery',
        100000,
        32,
        'sha256'
      );

      // Re-encrypt DEK with user recovery key
      const newBackupEncryptedDEK = (userCrypto as any).encryptDEK(originalDEK, userRecoveryKey);

      // 🔥 Remove plaintext recovery data and enable zero-trust mode
      await db
        .update(users)
        .set({
          recovery_dek: null,                           // Delete plaintext recovery key
          backup_encrypted_dek: JSON.stringify(newBackupEncryptedDEK),
          zero_trust_mode: true,                        // Enable zero-trust mode
        })
        .where(eq(users.id, userId));

      databaseLogger.success("User migrated to zero-trust mode", {
        operation: "zero_trust_migration_success",
        userId,
        mode: "zero_trust",
      });

      return userRecoverySeed;

    } catch (error) {
      databaseLogger.error("Failed to migrate user to zero-trust", error, {
        operation: "zero_trust_migration_failed",
        userId,
      });
      throw error;
    }
  }

  /**
   * Zero-trust recovery (requires user recovery seed)
   */
  async recoverInZeroTrustMode(
    username: string,
    code: string,
    userSeed: string
  ): Promise<{ success: boolean; tempToken?: string; expiresAt?: number }> {
    try {
      const db = getDb();

      // Verify recovery code (same mechanism as compromise mode)
      const key = `recovery_code_${username}`;
      const result = await db.select().from(settings).where(eq(settings.key, key));

      if (result.length === 0) {
        return { success: false };
      }

      const codeData = JSON.parse(result[0].value);
      const now = Date.now();

      // Check expiry and attempts
      if (now > codeData.expiresAt || codeData.attempts >= 3) {
        await db.delete(settings).where(eq(settings.key, key));
        return { success: false };
      }

      // Verify code
      if (codeData.code !== code) {
        codeData.attempts++;
        await db.update(settings)
          .set({ value: JSON.stringify(codeData) })
          .where(eq(settings.key, key));
        return { success: false };
      }

      // Get user
      const user = await db.select().from(users).where(eq(users.username, username));
      if (!user || user.length === 0) {
        return { success: false };
      }

      const userData = user[0];
      if (!userData.zero_trust_mode || !userData.backup_encrypted_dek) {
        return { success: false };
      }

      // Derive user recovery key from seed
      const userRecoveryKey = crypto.pbkdf2Sync(
        userSeed,
        'zero_trust_recovery',
        100000,
        32,
        'sha256'
      );

      try {
        // Decrypt DEK using user recovery key
        const userCrypto = UserCrypto.getInstance();
        const backupEncryptedDEK = JSON.parse(userData.backup_encrypted_dek);
        const originalDEK = (userCrypto as any).decryptDEK(backupEncryptedDEK, userRecoveryKey);

        // Create temporary session
        const tempToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

        const tempKey = `temp_recovery_session_${username}`;
        const tempValue = JSON.stringify({
          userId: userData.id,
          tempToken,
          expiresAt,
          dekHex: originalDEK.toString('hex'),
          mode: 'zero_trust'
        });

        const existingTemp = await db.select().from(settings).where(eq(settings.key, tempKey));
        if (existingTemp.length > 0) {
          await db.update(settings).set({ value: tempValue }).where(eq(settings.key, tempKey));
        } else {
          await db.insert(settings).values({ key: tempKey, value: tempValue });
        }

        // Clean up recovery code
        await db.delete(settings).where(eq(settings.key, key));

        databaseLogger.success("Zero-trust recovery successful", {
          operation: "zero_trust_recovery_success",
          username,
          userId: userData.id,
        });

        return { success: true, tempToken, expiresAt };

      } catch (decryptError) {
        // Invalid seed - decryption failed
        databaseLogger.warn("Zero-trust recovery failed - invalid seed", {
          operation: "zero_trust_recovery_invalid_seed",
          username,
        });
        return { success: false };
      }

    } catch (error) {
      databaseLogger.error("Zero-trust recovery failed", error, {
        operation: "zero_trust_recovery_error",
        username,
      });
      return { success: false };
    }
  }

  /**
   * Get user security mode status
   */
  async getUserSecurityMode(userId: string): Promise<{
    mode: 'compromise' | 'zero_trust';
    canMigrate: boolean;
    hasRecoveryData: boolean;
  }> {
    try {
      const db = getDb();
      const user = await db.select().from(users).where(eq(users.id, userId));

      if (!user || user.length === 0) {
        return { mode: 'compromise', canMigrate: false, hasRecoveryData: false };
      }

      const userData = user[0];
      const mode = userData.zero_trust_mode ? 'zero_trust' : 'compromise';
      const hasRecoveryData = !!(userData.recovery_dek || userData.backup_encrypted_dek);
      const canMigrate = mode === 'compromise' && hasRecoveryData;

      return { mode, canMigrate, hasRecoveryData };

    } catch (error) {
      databaseLogger.error("Failed to get user security mode", error, {
        operation: "get_security_mode_failed",
        userId,
      });
      return { mode: 'compromise', canMigrate: false, hasRecoveryData: false };
    }
  }
}