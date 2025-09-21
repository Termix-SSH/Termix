import crypto from "crypto";
import { db } from "../database/db/index.js";
import { settings, users } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import { databaseLogger } from "./logger.js";

interface UserSession {
  dataKey: Buffer;
  createdAt: number;
  lastActivity: number;
  expiresAt: number;
}

interface KEKSalt {
  salt: string;
  iterations: number;
  algorithm: string;
  createdAt: string;
}

interface EncryptedDEK {
  data: string;
  iv: string;
  tag: string;
  algorithm: string;
  createdAt: string;
}

/**
 * UserKeyManager - Manage user-level data keys (KEK-DEK architecture)
 *
 * Key hierarchy:
 * User password → KEK (PBKDF2) → DEK (AES-256-GCM) → Field encryption
 *
 * Features:
 * - KEK never stored, derived from user password
 * - DEK encrypted storage, protected by KEK
 * - DEK stored in memory during session
 * - Automatic cleanup on user logout or expiration
 */
class UserKeyManager {
  private static instance: UserKeyManager;
  private userSessions: Map<string, UserSession> = new Map();

  // Configuration constants
  private static readonly PBKDF2_ITERATIONS = 100000;
  private static readonly KEK_LENGTH = 32;
  private static readonly DEK_LENGTH = 32;
  private static readonly SESSION_DURATION = 8 * 60 * 60 * 1000; // 8小时
  private static readonly MAX_INACTIVITY = 2 * 60 * 60 * 1000; // 2小时

  private constructor() {
    // Periodically clean up expired sessions
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000); // Clean up every 5 minutes
  }

  static getInstance(): UserKeyManager {
    if (!this.instance) {
      this.instance = new UserKeyManager();
    }
    return this.instance;
  }

  /**
   * User registration: generate KEK salt and DEK
   */
  async setupUserEncryption(userId: string, password: string): Promise<void> {
    try {
      databaseLogger.info("Setting up encryption for new user", {
        operation: "user_encryption_setup",
        userId,
      });

      // 1. Generate KEK salt
      const kekSalt = await this.generateKEKSalt();
      await this.storeKEKSalt(userId, kekSalt);

      // 2. 推导KEK
      const KEK = this.deriveKEK(password, kekSalt);

      // 3. 生成并加密DEK
      const DEK = crypto.randomBytes(UserKeyManager.DEK_LENGTH);
      const encryptedDEK = this.encryptDEK(DEK, KEK);
      await this.storeEncryptedDEK(userId, encryptedDEK);

      // 4. Clean up temporary keys
      KEK.fill(0);
      DEK.fill(0);

      databaseLogger.success("User encryption setup completed", {
        operation: "user_encryption_setup_complete",
        userId,
      });
    } catch (error) {
      databaseLogger.error("Failed to setup user encryption", error, {
        operation: "user_encryption_setup_failed",
        userId,
      });
      throw error;
    }
  }

  /**
   * User login: verify password and unlock data keys
   */
  async authenticateAndUnlockUser(userId: string, password: string): Promise<boolean> {
    try {
      databaseLogger.info("Authenticating user and unlocking data key", {
        operation: "user_authenticate_unlock",
        userId,
      });

      // 1. Get KEK salt
      const kekSalt = await this.getKEKSalt(userId);
      if (!kekSalt) {
        databaseLogger.warn("No KEK salt found for user", {
          operation: "user_authenticate_unlock",
          userId,
          error: "missing_kek_salt",
        });
        return false;
      }

      // 2. 推导KEK
      const KEK = this.deriveKEK(password, kekSalt);

      // 3. 尝试解密DEK
      const encryptedDEK = await this.getEncryptedDEK(userId);
      if (!encryptedDEK) {
        KEK.fill(0);
        databaseLogger.warn("No encrypted DEK found for user", {
          operation: "user_authenticate_unlock",
          userId,
          error: "missing_encrypted_dek",
        });
        return false;
      }

      try {
        const DEK = this.decryptDEK(encryptedDEK, KEK);

        // 4. Create user session
        this.createUserSession(userId, DEK);

        // 5. Clean up temporary keys
        KEK.fill(0);
        DEK.fill(0);

        databaseLogger.success("User authenticated and data key unlocked", {
          operation: "user_authenticate_unlock_success",
          userId,
        });

        return true;
      } catch (decryptError) {
        KEK.fill(0);
        databaseLogger.warn("Failed to decrypt DEK - invalid password", {
          operation: "user_authenticate_unlock",
          userId,
          error: "invalid_password",
        });
        return false;
      }
    } catch (error) {
      databaseLogger.error("Authentication and unlock failed", error, {
        operation: "user_authenticate_unlock_failed",
        userId,
      });
      return false;
    }
  }

  /**
   * Get user data key (for data encryption operations)
   */
  getUserDataKey(userId: string): Buffer | null {
    const session = this.userSessions.get(userId);
    if (!session) {
      return null;
    }

    const now = Date.now();

    // Check if session is expired
    if (now > session.expiresAt) {
      this.userSessions.delete(userId);
      databaseLogger.info("User session expired", {
        operation: "user_session_expired",
        userId,
      });
      return null;
    }

    // Check inactivity time
    if (now - session.lastActivity > UserKeyManager.MAX_INACTIVITY) {
      this.userSessions.delete(userId);
      databaseLogger.info("User session inactive timeout", {
        operation: "user_session_inactive",
        userId,
      });
      return null;
    }

    // Update activity time
    session.lastActivity = now;
    return session.dataKey;
  }

  /**
   * User logout: clean up session
   */
  logoutUser(userId: string): void {
    const session = this.userSessions.get(userId);
    if (session) {
      // Securely clean up data key
      session.dataKey.fill(0);
      this.userSessions.delete(userId);

      databaseLogger.info("User logged out, session cleared", {
        operation: "user_logout",
        userId,
      });
    }
  }

  /**
   * Check if user is unlocked
   */
  isUserUnlocked(userId: string): boolean {
    return this.getUserDataKey(userId) !== null;
  }

  /**
   * Change user password: re-encrypt DEK
   */
  async changeUserPassword(userId: string, oldPassword: string, newPassword: string): Promise<boolean> {
    try {
      databaseLogger.info("Changing user password", {
        operation: "user_change_password",
        userId,
      });

      // 1. Verify old password and get DEK
      const authenticated = await this.authenticateAndUnlockUser(userId, oldPassword);
      if (!authenticated) {
        return false;
      }

      const DEK = this.getUserDataKey(userId);
      if (!DEK) {
        return false;
      }

      // 2. Generate new KEK salt
      const newKekSalt = await this.generateKEKSalt();
      const newKEK = this.deriveKEK(newPassword, newKekSalt);

      // 3. Encrypt DEK with new KEK
      const newEncryptedDEK = this.encryptDEK(DEK, newKEK);

      // 4. Store new salt and encrypted DEK
      await this.storeKEKSalt(userId, newKekSalt);
      await this.storeEncryptedDEK(userId, newEncryptedDEK);

      // 5. 清理临时密钥
      newKEK.fill(0);

      databaseLogger.success("User password changed successfully", {
        operation: "user_change_password_success",
        userId,
      });

      return true;
    } catch (error) {
      databaseLogger.error("Failed to change user password", error, {
        operation: "user_change_password_failed",
        userId,
      });
      return false;
    }
  }

  // ===== Private methods =====

  private async generateKEKSalt(): Promise<KEKSalt> {
    return {
      salt: crypto.randomBytes(32).toString("hex"),
      iterations: UserKeyManager.PBKDF2_ITERATIONS,
      algorithm: "pbkdf2-sha256",
      createdAt: new Date().toISOString(),
    };
  }

  private deriveKEK(password: string, kekSalt: KEKSalt): Buffer {
    return crypto.pbkdf2Sync(
      password,
      Buffer.from(kekSalt.salt, "hex"),
      kekSalt.iterations,
      UserKeyManager.KEK_LENGTH,
      "sha256"
    );
  }

  private encryptDEK(dek: Buffer, kek: Buffer): EncryptedDEK {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv);

    let encrypted = cipher.update(dek);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      data: encrypted.toString("hex"),
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      algorithm: "aes-256-gcm",
      createdAt: new Date().toISOString(),
    };
  }

  private decryptDEK(encryptedDEK: EncryptedDEK, kek: Buffer): Buffer {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      kek,
      Buffer.from(encryptedDEK.iv, "hex")
    );

    decipher.setAuthTag(Buffer.from(encryptedDEK.tag, "hex"));

    let decrypted = decipher.update(Buffer.from(encryptedDEK.data, "hex"));
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted;
  }

  private createUserSession(userId: string, dataKey: Buffer): void {
    const now = Date.now();

    // Clean up old session
    const oldSession = this.userSessions.get(userId);
    if (oldSession) {
      oldSession.dataKey.fill(0);
    }

    // Create new session
    this.userSessions.set(userId, {
      dataKey: Buffer.from(dataKey), // Copy key
      createdAt: now,
      lastActivity: now,
      expiresAt: now + UserKeyManager.SESSION_DURATION,
    });
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredUsers: string[] = [];

    for (const [userId, session] of this.userSessions.entries()) {
      if (now > session.expiresAt ||
          now - session.lastActivity > UserKeyManager.MAX_INACTIVITY) {
        session.dataKey.fill(0);
        expiredUsers.push(userId);
      }
    }

    expiredUsers.forEach(userId => {
      this.userSessions.delete(userId);
      databaseLogger.info("Cleaned up expired user session", {
        operation: "session_cleanup",
        userId,
      });
    });
  }

  // ===== Database operations =====

  private async storeKEKSalt(userId: string, kekSalt: KEKSalt): Promise<void> {
    const key = `user_kek_salt_${userId}`;
    const value = JSON.stringify(kekSalt);

    const existing = await db.select().from(settings).where(eq(settings.key, key));

    if (existing.length > 0) {
      await db.update(settings).set({ value }).where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, value });
    }
  }

  private async getKEKSalt(userId: string): Promise<KEKSalt | null> {
    try {
      const key = `user_kek_salt_${userId}`;
      const result = await db.select().from(settings).where(eq(settings.key, key));

      if (result.length === 0) {
        return null;
      }

      return JSON.parse(result[0].value);
    } catch (error) {
      return null;
    }
  }

  private async storeEncryptedDEK(userId: string, encryptedDEK: EncryptedDEK): Promise<void> {
    const key = `user_encrypted_dek_${userId}`;
    const value = JSON.stringify(encryptedDEK);

    const existing = await db.select().from(settings).where(eq(settings.key, key));

    if (existing.length > 0) {
      await db.update(settings).set({ value }).where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, value });
    }
  }

  private async getEncryptedDEK(userId: string): Promise<EncryptedDEK | null> {
    try {
      const key = `user_encrypted_dek_${userId}`;
      const result = await db.select().from(settings).where(eq(settings.key, key));

      if (result.length === 0) {
        return null;
      }

      return JSON.parse(result[0].value);
    } catch (error) {
      return null;
    }
  }

  /**
   * Get user session status (for debugging and management)
   */
  getUserSessionStatus(userId: string) {
    const session = this.userSessions.get(userId);
    if (!session) {
      return { unlocked: false };
    }

    const now = Date.now();
    return {
      unlocked: true,
      createdAt: new Date(session.createdAt).toISOString(),
      lastActivity: new Date(session.lastActivity).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString(),
      remainingTime: Math.max(0, session.expiresAt - now),
      inactiveTime: now - session.lastActivity,
    };
  }

  /**
   * Get all active sessions (for management)
   */
  getAllActiveSessions() {
    const sessions: Record<string, any> = {};
    for (const [userId, session] of this.userSessions.entries()) {
      sessions[userId] = this.getUserSessionStatus(userId);
    }
    return sessions;
  }
}

export { UserKeyManager, type UserSession, type KEKSalt, type EncryptedDEK };