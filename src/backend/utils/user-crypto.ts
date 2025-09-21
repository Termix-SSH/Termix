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
  dataKey: Buffer;        // 直接存储DEK，删除just-in-time幻想
  lastActivity: number;
  expiresAt: number;
}

/**
 * UserCrypto - 简单直接的用户加密
 *
 * Linus原则：
 * - 删除just-in-time幻想，直接缓存DEK
 * - 合理的2小时超时，不是5分钟的用户体验灾难
 * - 简单可工作的实现，不是理论上完美的垃圾
 * - 服务器重启后session失效（这是合理的）
 */
class UserCrypto {
  private static instance: UserCrypto;
  private userSessions: Map<string, UserSession> = new Map();

  // 配置常量 - 合理的超时设置
  private static readonly PBKDF2_ITERATIONS = 100000;
  private static readonly KEK_LENGTH = 32;
  private static readonly DEK_LENGTH = 32;
  private static readonly SESSION_DURATION = 2 * 60 * 60 * 1000; // 2小时，合理的用户体验
  private static readonly MAX_INACTIVITY = 30 * 60 * 1000;       // 30分钟，不是1分钟的灾难

  private constructor() {
    // 合理的清理间隔
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000); // 每5分钟清理一次，不是30秒
  }

  static getInstance(): UserCrypto {
    if (!this.instance) {
      this.instance = new UserCrypto();
    }
    return this.instance;
  }

  /**
   * 用户注册：生成KEK salt和DEK
   */
  async setupUserEncryption(userId: string, password: string): Promise<void> {
    const kekSalt = await this.generateKEKSalt();
    await this.storeKEKSalt(userId, kekSalt);

    const KEK = this.deriveKEK(password, kekSalt);
    const DEK = crypto.randomBytes(UserCrypto.DEK_LENGTH);
    const encryptedDEK = this.encryptDEK(DEK, KEK);
    await this.storeEncryptedDEK(userId, encryptedDEK);

    // 立即清理临时密钥
    KEK.fill(0);
    DEK.fill(0);

    databaseLogger.success("User encryption setup completed", {
      operation: "user_crypto_setup",
      userId,
    });
  }

  /**
   * 用户认证：验证密码并缓存DEK
   * 删除了just-in-time幻想，直接工作
   */
  async authenticateUser(userId: string, password: string): Promise<boolean> {
    try {
      // 验证密码并解密DEK
      const kekSalt = await this.getKEKSalt(userId);
      if (!kekSalt) return false;

      const KEK = this.deriveKEK(password, kekSalt);
      const encryptedDEK = await this.getEncryptedDEK(userId);
      if (!encryptedDEK) {
        KEK.fill(0);
        return false;
      }

      const DEK = this.decryptDEK(encryptedDEK, KEK);
      KEK.fill(0); // 立即清理KEK

      // 创建用户会话，直接缓存DEK
      const now = Date.now();

      // 清理旧会话
      const oldSession = this.userSessions.get(userId);
      if (oldSession) {
        oldSession.dataKey.fill(0);
      }

      this.userSessions.set(userId, {
        dataKey: Buffer.from(DEK), // 复制DEK
        lastActivity: now,
        expiresAt: now + UserCrypto.SESSION_DURATION,
      });

      DEK.fill(0); // 清理临时DEK

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
   * 获取用户数据密钥 - 简单直接从缓存返回
   * 删除了just-in-time推导垃圾
   */
  getUserDataKey(userId: string): Buffer | null {
    const session = this.userSessions.get(userId);
    if (!session) {
      return null;
    }

    const now = Date.now();

    // 检查会话是否过期
    if (now > session.expiresAt) {
      this.userSessions.delete(userId);
      session.dataKey.fill(0);
      databaseLogger.info("User session expired", {
        operation: "user_session_expired",
        userId,
      });
      return null;
    }

    // 检查是否超过最大不活跃时间
    if (now - session.lastActivity > UserCrypto.MAX_INACTIVITY) {
      this.userSessions.delete(userId);
      session.dataKey.fill(0);
      databaseLogger.info("User session inactive timeout", {
        operation: "user_session_inactive",
        userId,
      });
      return null;
    }

    // 更新最后活动时间
    session.lastActivity = now;
    return session.dataKey;
  }


  /**
   * 用户登出：清理会话
   */
  logoutUser(userId: string): void {
    const session = this.userSessions.get(userId);
    if (session) {
      session.dataKey.fill(0); // 安全清理密钥
      this.userSessions.delete(userId);
    }
    databaseLogger.info("User logged out", {
      operation: "user_crypto_logout",
      userId,
    });
  }

  /**
   * 检查用户是否已解锁
   */
  isUserUnlocked(userId: string): boolean {
    return this.getUserDataKey(userId) !== null;
  }

  /**
   * 修改用户密码
   */
  async changeUserPassword(userId: string, oldPassword: string, newPassword: string): Promise<boolean> {
    try {
      // 验证旧密码
      const isValid = await this.validatePassword(userId, oldPassword);
      if (!isValid) return false;

      // 获取当前DEK
      const kekSalt = await this.getKEKSalt(userId);
      if (!kekSalt) return false;

      const oldKEK = this.deriveKEK(oldPassword, kekSalt);
      const encryptedDEK = await this.getEncryptedDEK(userId);
      if (!encryptedDEK) return false;

      const DEK = this.decryptDEK(encryptedDEK, oldKEK);

      // 生成新的KEK salt和加密DEK
      const newKekSalt = await this.generateKEKSalt();
      const newKEK = this.deriveKEK(newPassword, newKekSalt);
      const newEncryptedDEK = this.encryptDEK(DEK, newKEK);

      // 存储新的salt和encrypted DEK
      await this.storeKEKSalt(userId, newKekSalt);
      await this.storeEncryptedDEK(userId, newEncryptedDEK);

      // 清理所有临时密钥
      oldKEK.fill(0);
      newKEK.fill(0);
      DEK.fill(0);

      // 清理用户会话，要求重新登录
      this.logoutUser(userId);

      return true;
    } catch (error) {
      return false;
    }
  }

  // ===== 私有方法 =====

  private async validatePassword(userId: string, password: string): Promise<boolean> {
    try {
      const kekSalt = await this.getKEKSalt(userId);
      if (!kekSalt) return false;

      const KEK = this.deriveKEK(password, kekSalt);
      const encryptedDEK = await this.getEncryptedDEK(userId);
      if (!encryptedDEK) return false;

      const DEK = this.decryptDEK(encryptedDEK, KEK);

      // 清理临时密钥
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
        session.dataKey.fill(0); // 安全清理密钥
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

  // ===== 数据库操作和加密方法（简化版本） =====

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

  // 数据库操作方法
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