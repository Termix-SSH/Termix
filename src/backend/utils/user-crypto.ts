import crypto from "crypto";
import { getDb } from "../database/db/index.js";
import { settings, users } from "../database/db/schema.js";
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
  dataKey: Buffer;
  lastActivity: number;
  expiresAt: number;
}

class UserCrypto {
  private static instance: UserCrypto;
  private userSessions: Map<string, UserSession> = new Map();
  private sessionExpiredCallback?: (userId: string) => void;

  private static readonly PBKDF2_ITERATIONS = 100000;
  private static readonly KEK_LENGTH = 32;
  private static readonly DEK_LENGTH = 32;
  private static readonly SESSION_DURATION = 24 * 60 * 60 * 1000;
  private static readonly MAX_INACTIVITY = 6 * 60 * 60 * 1000;

  private constructor() {
    setInterval(
      () => {
        this.cleanupExpiredSessions();
      },
      5 * 60 * 1000,
    );
  }

  static getInstance(): UserCrypto {
    if (!this.instance) {
      this.instance = new UserCrypto();
    }
    return this.instance;
  }

  setSessionExpiredCallback(callback: (userId: string) => void): void {
    this.sessionExpiredCallback = callback;
  }

  async setupUserEncryption(userId: string, password: string): Promise<void> {
    const kekSalt = await this.generateKEKSalt();
    await this.storeKEKSalt(userId, kekSalt);

    const KEK = this.deriveKEK(password, kekSalt);
    const DEK = crypto.randomBytes(UserCrypto.DEK_LENGTH);
    const encryptedDEK = this.encryptDEK(DEK, KEK);
    await this.storeEncryptedDEK(userId, encryptedDEK);

    KEK.fill(0);
    DEK.fill(0);
  }

  async setupOIDCUserEncryption(userId: string): Promise<void> {
    const DEK = crypto.randomBytes(UserCrypto.DEK_LENGTH);

    const now = Date.now();
    this.userSessions.set(userId, {
      dataKey: Buffer.from(DEK),
      lastActivity: now,
      expiresAt: now + UserCrypto.SESSION_DURATION,
    });

    DEK.fill(0);
  }

  async authenticateUser(userId: string, password: string): Promise<boolean> {
    try {
      const kekSalt = await this.getKEKSalt(userId);
      if (!kekSalt) return false;

      const KEK = this.deriveKEK(password, kekSalt);
      const encryptedDEK = await this.getEncryptedDEK(userId);
      if (!encryptedDEK) {
        KEK.fill(0);
        return false;
      }

      const DEK = this.decryptDEK(encryptedDEK, KEK);
      KEK.fill(0);

      if (!DEK || DEK.length === 0) {
        databaseLogger.error("DEK is empty or invalid after decryption", {
          operation: "user_crypto_auth_debug",
          userId,
          dekLength: DEK ? DEK.length : 0,
        });
        return false;
      }

      const now = Date.now();

      const oldSession = this.userSessions.get(userId);
      if (oldSession) {
        oldSession.dataKey.fill(0);
      }

      this.userSessions.set(userId, {
        dataKey: Buffer.from(DEK),
        lastActivity: now,
        expiresAt: now + UserCrypto.SESSION_DURATION,
      });

      DEK.fill(0);

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

  async authenticateOIDCUser(userId: string): Promise<boolean> {
    try {
      const kekSalt = await this.getKEKSalt(userId);
      if (!kekSalt) {
        await this.setupOIDCUserEncryption(userId);
        return true;
      }

      const systemKey = this.deriveOIDCSystemKey(userId);
      const encryptedDEK = await this.getEncryptedDEK(userId);
      if (!encryptedDEK) {
        systemKey.fill(0);
        await this.setupOIDCUserEncryption(userId);
        return true;
      }

      const DEK = this.decryptDEK(encryptedDEK, systemKey);
      systemKey.fill(0);

      if (!DEK || DEK.length === 0) {
        await this.setupOIDCUserEncryption(userId);
        return true;
      }

      const now = Date.now();

      const oldSession = this.userSessions.get(userId);
      if (oldSession) {
        oldSession.dataKey.fill(0);
      }

      this.userSessions.set(userId, {
        dataKey: Buffer.from(DEK),
        lastActivity: now,
        expiresAt: now + UserCrypto.SESSION_DURATION,
      });

      DEK.fill(0);

      return true;
    } catch (error) {
      await this.setupOIDCUserEncryption(userId);
      return true;
    }
  }

  getUserDataKey(userId: string): Buffer | null {
    const session = this.userSessions.get(userId);
    if (!session) {
      return null;
    }

    const now = Date.now();

    if (now > session.expiresAt) {
      this.userSessions.delete(userId);
      session.dataKey.fill(0);
      if (this.sessionExpiredCallback) {
        this.sessionExpiredCallback(userId);
      }
      return null;
    }

    if (now - session.lastActivity > UserCrypto.MAX_INACTIVITY) {
      this.userSessions.delete(userId);
      session.dataKey.fill(0);
      if (this.sessionExpiredCallback) {
        this.sessionExpiredCallback(userId);
      }
      return null;
    }

    session.lastActivity = now;
    return session.dataKey;
  }

  logoutUser(userId: string): void {
    const session = this.userSessions.get(userId);
    if (session) {
      session.dataKey.fill(0);
      this.userSessions.delete(userId);
    }
  }

  isUserUnlocked(userId: string): boolean {
    return this.getUserDataKey(userId) !== null;
  }

  async changeUserPassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    try {
      const isValid = await this.validatePassword(userId, oldPassword);
      if (!isValid) return false;

      const kekSalt = await this.getKEKSalt(userId);
      if (!kekSalt) return false;

      const oldKEK = this.deriveKEK(oldPassword, kekSalt);
      const encryptedDEK = await this.getEncryptedDEK(userId);
      if (!encryptedDEK) return false;

      const DEK = this.decryptDEK(encryptedDEK, oldKEK);

      const newKekSalt = await this.generateKEKSalt();
      const newKEK = this.deriveKEK(newPassword, newKekSalt);
      const newEncryptedDEK = this.encryptDEK(DEK, newKEK);

      await this.storeKEKSalt(userId, newKekSalt);
      await this.storeEncryptedDEK(userId, newEncryptedDEK);

      oldKEK.fill(0);
      newKEK.fill(0);
      DEK.fill(0);

      this.logoutUser(userId);

      return true;
    } catch (error) {
      return false;
    }
  }

  private async validatePassword(
    userId: string,
    password: string,
  ): Promise<boolean> {
    try {
      const kekSalt = await this.getKEKSalt(userId);
      if (!kekSalt) return false;

      const KEK = this.deriveKEK(password, kekSalt);
      const encryptedDEK = await this.getEncryptedDEK(userId);
      if (!encryptedDEK) return false;

      const DEK = this.decryptDEK(encryptedDEK, KEK);

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
      if (
        now > session.expiresAt ||
        now - session.lastActivity > UserCrypto.MAX_INACTIVITY
      ) {
        session.dataKey.fill(0);
        expiredUsers.push(userId);
      }
    }

    expiredUsers.forEach((userId) => {
      this.userSessions.delete(userId);
    });
  }

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
      "sha256",
    );
  }

  private deriveOIDCSystemKey(userId: string): Buffer {
    const systemSecret =
      process.env.OIDC_SYSTEM_SECRET || "termix-oidc-system-secret-default";
    const salt = Buffer.from(userId, "utf8");
    return crypto.pbkdf2Sync(
      systemSecret,
      salt,
      100000,
      UserCrypto.KEK_LENGTH,
      "sha256",
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
      Buffer.from(encryptedDEK.iv, "hex"),
    );

    decipher.setAuthTag(Buffer.from(encryptedDEK.tag, "hex"));
    let decrypted = decipher.update(Buffer.from(encryptedDEK.data, "hex"));
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted;
  }

  private async storeKEKSalt(userId: string, kekSalt: KEKSalt): Promise<void> {
    const key = `user_kek_salt_${userId}`;
    const value = JSON.stringify(kekSalt);

    const existing = await getDb()
      .select()
      .from(settings)
      .where(eq(settings.key, key));

    if (existing.length > 0) {
      await getDb()
        .update(settings)
        .set({ value })
        .where(eq(settings.key, key));
    } else {
      await getDb().insert(settings).values({ key, value });
    }
  }

  private async getKEKSalt(userId: string): Promise<KEKSalt | null> {
    try {
      const key = `user_kek_salt_${userId}`;
      const result = await getDb()
        .select()
        .from(settings)
        .where(eq(settings.key, key));

      if (result.length === 0) {
        return null;
      }

      return JSON.parse(result[0].value);
    } catch (error) {
      return null;
    }
  }

  private async storeEncryptedDEK(
    userId: string,
    encryptedDEK: EncryptedDEK,
  ): Promise<void> {
    const key = `user_encrypted_dek_${userId}`;
    const value = JSON.stringify(encryptedDEK);

    const existing = await getDb()
      .select()
      .from(settings)
      .where(eq(settings.key, key));

    if (existing.length > 0) {
      await getDb()
        .update(settings)
        .set({ value })
        .where(eq(settings.key, key));
    } else {
      await getDb().insert(settings).values({ key, value });
    }
  }

  private async getEncryptedDEK(userId: string): Promise<EncryptedDEK | null> {
    try {
      const key = `user_encrypted_dek_${userId}`;
      const result = await getDb()
        .select()
        .from(settings)
        .where(eq(settings.key, key));

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
