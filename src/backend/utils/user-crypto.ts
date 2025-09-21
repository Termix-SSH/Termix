import crypto from "crypto";
import { db } from "../database/db/index.js";
import { settings } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import { databaseLogger } from "./logger.js";

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

interface UserSession {
  dataKey: Buffer;        // Store DEK directly, delete just-in-time fantasy
  lastActivity: number;
  expiresAt: number;
}

/**
 * UserCrypto - Simple direct user encryption
 *
 * Linus principles:
 * - Delete just-in-time fantasy, cache DEK directly
 * - Reasonable 2-hour timeout, not 5-minute user experience disaster
 * - Simple working implementation, not theoretically perfect garbage
 * - Server restart invalidates sessions (this is reasonable)
 */
class UserCrypto {
  private static instance: UserCrypto;
  private userSessions: Map<string, UserSession> = new Map();

  // Configuration constants - reasonable timeout settings
  private static readonly PBKDF2_ITERATIONS = 100000;
  private static readonly KEK_LENGTH = 32;
  private static readonly DEK_LENGTH = 32;
  private static readonly SESSION_DURATION = 2 * 60 * 60 * 1000; // 2 hours, reasonable user experience
  private static readonly MAX_INACTIVITY = 30 * 60 * 1000;       // 30 minutes, not 1-minute disaster

  private constructor() {
    // Reasonable cleanup interval
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000); // Clean every 5 minutes, not 30 seconds
  }

  static getInstance(): UserCrypto {
    if (!this.instance) {
      this.instance = new UserCrypto();
    }
    return this.instance;
  }

  /**
   * User registration: generate KEK salt and DEK
   */
  async setupUserEncryption(userId: string, password: string): Promise<void> {
    const kekSalt = await this.generateKEKSalt();
    await this.storeKEKSalt(userId, kekSalt);

    const KEK = this.deriveKEK(password, kekSalt);
    const DEK = crypto.randomBytes(UserCrypto.DEK_LENGTH);
    const encryptedDEK = this.encryptDEK(DEK, KEK);
    await this.storeEncryptedDEK(userId, encryptedDEK);

    // Immediately clean temporary keys
    KEK.fill(0);
    DEK.fill(0);

    databaseLogger.success("User encryption setup completed", {
      operation: "user_crypto_setup",
      userId,
    });
  }

  /**
   * User authentication: validate password and cache DEK
   * Deleted just-in-time fantasy, works directly
   */
  async authenticateUser(userId: string, password: string): Promise<boolean> {
    try {
      // Validate password and decrypt DEK
      const kekSalt = await this.getKEKSalt(userId);
      if (!kekSalt) return false;

      const KEK = this.deriveKEK(password, kekSalt);
      const encryptedDEK = await this.getEncryptedDEK(userId);
      if (!encryptedDEK) {
        KEK.fill(0);
        return false;
      }

      const DEK = this.decryptDEK(encryptedDEK, KEK);
      KEK.fill(0); // Immediately clean KEK

      // Create user session, cache DEK directly
      const now = Date.now();

      // Clean old session
      const oldSession = this.userSessions.get(userId);
      if (oldSession) {
        oldSession.dataKey.fill(0);
      }

      this.userSessions.set(userId, {
        dataKey: Buffer.from(DEK), // Copy DEK
        lastActivity: now,
        expiresAt: now + UserCrypto.SESSION_DURATION,
      });

      DEK.fill(0); // Clean temporary DEK

      databaseLogger.success("User authenticated and DEK cached", {
        operation: "user_crypto_auth",
        userId,
        duration: UserCrypto.SESSION_DURATION,
      });

      return true;
    } catch (error) {
      databaseLogger.warn("User authentication failed", {
        operation: "user_crypto_auth_failed",
        userId,
        error: error instanceof Error ? error.message : "Unknown",
      });
      return false;
    }
  }

  /**
   * Get user data key - simple direct return from cache
   * Deleted just-in-time derivation garbage
   */
  getUserDataKey(userId: string): Buffer | null {
    const session = this.userSessions.get(userId);
    if (!session) {
      return null;
    }

    const now = Date.now();

    // Check if session has expired
    if (now > session.expiresAt) {
      this.userSessions.delete(userId);
      session.dataKey.fill(0);
      databaseLogger.info("User session expired", {
        operation: "user_session_expired",
        userId,
      });
      return null;
    }

    // Check if max inactivity time exceeded
    if (now - session.lastActivity > UserCrypto.MAX_INACTIVITY) {
      this.userSessions.delete(userId);
      session.dataKey.fill(0);
      databaseLogger.info("User session inactive timeout", {
        operation: "user_session_inactive",
        userId,
      });
      return null;
    }

    // Update last activity time
    session.lastActivity = now;
    return session.dataKey;
  }


  /**
   * User logout: clear session
   */
  logoutUser(userId: string): void {
    const session = this.userSessions.get(userId);
    if (session) {
      session.dataKey.fill(0); // Securely clear key
      this.userSessions.delete(userId);
    }
    databaseLogger.info("User logged out", {
      operation: "user_crypto_logout",
      userId,
    });
  }

  /**
   * Check if user is unlocked
   */
  isUserUnlocked(userId: string): boolean {
    return this.getUserDataKey(userId) !== null;
  }

  /**
   * Change user password
   */
  async changeUserPassword(userId: string, oldPassword: string, newPassword: string): Promise<boolean> {
    try {
      // Validate old password
      const isValid = await this.validatePassword(userId, oldPassword);
      if (!isValid) return false;

      // Get current DEK
      const kekSalt = await this.getKEKSalt(userId);
      if (!kekSalt) return false;

      const oldKEK = this.deriveKEK(oldPassword, kekSalt);
      const encryptedDEK = await this.getEncryptedDEK(userId);
      if (!encryptedDEK) return false;

      const DEK = this.decryptDEK(encryptedDEK, oldKEK);

      // Generate new KEK salt and encrypt DEK
      const newKekSalt = await this.generateKEKSalt();
      const newKEK = this.deriveKEK(newPassword, newKekSalt);
      const newEncryptedDEK = this.encryptDEK(DEK, newKEK);

      // Store new salt and encrypted DEK
      await this.storeKEKSalt(userId, newKekSalt);
      await this.storeEncryptedDEK(userId, newEncryptedDEK);

      // Clean all temporary keys
      oldKEK.fill(0);
      newKEK.fill(0);
      DEK.fill(0);

      // Clean user session, require re-login
      this.logoutUser(userId);

      return true;
    } catch (error) {
      return false;
    }
  }

  // ===== Private methods =====

  private async validatePassword(userId: string, password: string): Promise<boolean> {
    try {
      const kekSalt = await this.getKEKSalt(userId);
      if (!kekSalt) return false;

      const KEK = this.deriveKEK(password, kekSalt);
      const encryptedDEK = await this.getEncryptedDEK(userId);
      if (!encryptedDEK) return false;

      const DEK = this.decryptDEK(encryptedDEK, KEK);

      // Clean temporary keys
      KEK.fill(0);
      DEK.fill(0);

      return true;
    } catch (error) {
      return false;
    }
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredUsers: string[] = [];

    for (const [userId, session] of this.userSessions.entries()) {
      if (now > session.expiresAt || now - session.lastActivity > UserCrypto.MAX_INACTIVITY) {
        session.dataKey.fill(0); // Securely clear key
        expiredUsers.push(userId);
      }
    }

    expiredUsers.forEach(userId => {
      this.userSessions.delete(userId);
    });

    if (expiredUsers.length > 0) {
      databaseLogger.info(`Cleaned up ${expiredUsers.length} expired sessions`, {
        operation: "session_cleanup",
        count: expiredUsers.length,
      });
    }
  }

  // ===== Database operations and encryption methods (simplified version) =====

  private async generateKEKSalt(): Promise<KEKSalt> {
    return {
      salt: crypto.randomBytes(32).toString("hex"),
      iterations: UserCrypto.PBKDF2_ITERATIONS,
      algorithm: "pbkdf2-sha256",
      createdAt: new Date().toISOString(),
    };
  }

  private deriveKEK(password: string, kekSalt: KEKSalt): Buffer {
    return crypto.pbkdf2Sync(
      password,
      Buffer.from(kekSalt.salt, "hex"),
      kekSalt.iterations,
      UserCrypto.KEK_LENGTH,
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

  // Database operation methods
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
}

export { UserCrypto, type KEKSalt, type EncryptedDEK };