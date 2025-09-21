import crypto from "crypto";
import { db } from "../database/db/index.js";
import { settings } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import { databaseLogger } from "./logger.js";

/**
 * SystemCrypto - 系统级密钥管理
 *
 * Linus原则：
 * - JWT密钥必须加密存储，不是base64编码
 * - 使用系统级主密钥保护JWT密钥
 * - 如果攻击者getshell了，至少JWT密钥不是明文
 * - 简单直接，不需要外部依赖
 */
class SystemCrypto {
  private static instance: SystemCrypto;
  private jwtSecret: string | null = null;

  // 系统主密钥 - 在生产环境中应该从安全的地方获取
  private static readonly SYSTEM_MASTER_KEY = this.getSystemMasterKey();
  private static readonly ALGORITHM = "aes-256-gcm";

  private constructor() {}

  static getInstance(): SystemCrypto {
    if (!this.instance) {
      this.instance = new SystemCrypto();
    }
    return this.instance;
  }

  /**
   * 获取系统主密钥 - 简单直接
   *
   * 两种选择：
   * 1. 环境变量 SYSTEM_MASTER_KEY (生产环境必须)
   * 2. 固定密钥 (开发环境，会警告)
   *
   * 删除了硬件指纹垃圾 - 容器化环境下不可靠
   */
  private static getSystemMasterKey(): Buffer {
    // 1. 环境变量 (生产环境)
    const envKey = process.env.SYSTEM_MASTER_KEY;
    if (envKey && envKey.length >= 32) {
      databaseLogger.info("Using system master key from environment", {
        operation: "system_key_env"
      });
      return Buffer.from(envKey, 'hex');
    }

    // 2. 开发环境固定密钥
    databaseLogger.warn("Using default system master key - NOT SECURE FOR PRODUCTION", {
      operation: "system_key_default",
      warning: "Set SYSTEM_MASTER_KEY environment variable in production"
    });

    // 固定但足够长的开发密钥
    const devKey = "termix-development-master-key-not-for-production-use-32-bytes";
    return crypto.createHash('sha256').update(devKey).digest();
  }

  /**
   * 初始化JWT密钥
   */
  async initializeJWTSecret(): Promise<void> {
    try {
      databaseLogger.info("Initializing encrypted JWT secret", {
        operation: "jwt_init",
      });

      const existingSecret = await this.getStoredJWTSecret();
      if (existingSecret) {
        this.jwtSecret = existingSecret;
        databaseLogger.success("JWT secret loaded and decrypted", {
          operation: "jwt_loaded",
        });
      } else {
        const newSecret = await this.generateJWTSecret();
        this.jwtSecret = newSecret;
        databaseLogger.success("New encrypted JWT secret generated", {
          operation: "jwt_generated",
        });
      }
    } catch (error) {
      databaseLogger.error("Failed to initialize JWT secret", error, {
        operation: "jwt_init_failed",
      });
      throw new Error("JWT secret initialization failed");
    }
  }

  /**
   * 获取JWT密钥
   */
  async getJWTSecret(): Promise<string> {
    if (!this.jwtSecret) {
      await this.initializeJWTSecret();
    }
    return this.jwtSecret!;
  }

  /**
   * 生成新的JWT密钥并加密存储
   */
  private async generateJWTSecret(): Promise<string> {
    const secret = crypto.randomBytes(64).toString("hex");
    const secretId = crypto.randomBytes(8).toString("hex");

    // 加密JWT密钥
    const encryptedSecret = this.encryptSecret(secret);

    const secretData = {
      encrypted: encryptedSecret,
      secretId,
      createdAt: new Date().toISOString(),
      algorithm: "HS256",
      encryption: SystemCrypto.ALGORITHM,
    };

    try {
      const existing = await db
        .select()
        .from(settings)
        .where(eq(settings.key, "system_jwt_secret"));

      const encodedData = JSON.stringify(secretData);

      if (existing.length > 0) {
        await db
          .update(settings)
          .set({ value: encodedData })
          .where(eq(settings.key, "system_jwt_secret"));
      } else {
        await db.insert(settings).values({
          key: "system_jwt_secret",
          value: encodedData,
        });
      }

      databaseLogger.info("Encrypted JWT secret stored", {
        operation: "jwt_stored",
        secretId,
        encryption: SystemCrypto.ALGORITHM,
      });

      return secret;
    } catch (error) {
      databaseLogger.error("Failed to store encrypted JWT secret", error, {
        operation: "jwt_store_failed",
      });
      throw error;
    }
  }

  /**
   * 从数据库读取并解密JWT密钥
   */
  private async getStoredJWTSecret(): Promise<string | null> {
    try {
      const result = await db
        .select()
        .from(settings)
        .where(eq(settings.key, "system_jwt_secret"));

      if (result.length === 0) {
        return null;
      }

      const secretData = JSON.parse(result[0].value);

      // 只支持加密格式 - 删除了Legacy兼容垃圾
      if (!secretData.encrypted) {
        databaseLogger.error("Found unencrypted JWT secret - not supported", {
          operation: "jwt_unencrypted_rejected",
          action: "DELETE old secret and restart server"
        });
        return null;
      }

      return this.decryptSecret(secretData.encrypted);
    } catch (error) {
      databaseLogger.warn("Failed to load stored JWT secret", {
        operation: "jwt_load_failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }

  /**
   * 加密密钥
   */
  private encryptSecret(plaintext: string): object {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(SystemCrypto.ALGORITHM, SystemCrypto.SYSTEM_MASTER_KEY, iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();

    return {
      data: encrypted,
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
    };
  }

  /**
   * 解密密钥
   */
  private decryptSecret(encryptedData: any): string {
    const decipher = crypto.createDecipheriv(
      SystemCrypto.ALGORITHM,
      SystemCrypto.SYSTEM_MASTER_KEY,
      Buffer.from(encryptedData.iv, "hex")
    );

    decipher.setAuthTag(Buffer.from(encryptedData.tag, "hex"));

    let decrypted = decipher.update(encryptedData.data, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * 重新生成JWT密钥
   */
  async regenerateJWTSecret(): Promise<string> {
    databaseLogger.warn("Regenerating JWT secret - ALL TOKENS WILL BE INVALIDATED", {
      operation: "jwt_regenerate",
    });

    const newSecret = await this.generateJWTSecret();
    this.jwtSecret = newSecret;

    databaseLogger.success("JWT secret regenerated and encrypted", {
      operation: "jwt_regenerated",
      warning: "All existing JWT tokens are now invalid",
    });

    return newSecret;
  }

  /**
   * 验证JWT密钥系统
   */
  async validateJWTSecret(): Promise<boolean> {
    try {
      const secret = await this.getJWTSecret();
      if (!secret || secret.length < 32) {
        return false;
      }

      // 测试JWT操作
      const jwt = await import("jsonwebtoken");
      const testPayload = { test: true, timestamp: Date.now() };
      const token = jwt.default.sign(testPayload, secret, { expiresIn: "1s" });
      const decoded = jwt.default.verify(token, secret);

      return !!decoded;
    } catch (error) {
      databaseLogger.error("JWT secret validation failed", error, {
        operation: "jwt_validation_failed",
      });
      return false;
    }
  }

  /**
   * 获取系统密钥状态
   */
  async getSystemKeyStatus() {
    const isValid = await this.validateJWTSecret();
    const hasSecret = this.jwtSecret !== null;

    try {
      const result = await db
        .select()
        .from(settings)
        .where(eq(settings.key, "system_jwt_secret"));

      const hasStored = result.length > 0;
      let createdAt = null;
      let secretId = null;
      let isEncrypted = false;

      if (hasStored) {
        const secretData = JSON.parse(result[0].value);
        createdAt = secretData.createdAt;
        secretId = secretData.secretId;
        isEncrypted = !!secretData.encrypted;
      }

      return {
        hasSecret,
        hasStored,
        isValid,
        isEncrypted,
        createdAt,
        secretId,
        algorithm: "HS256",
        encryption: SystemCrypto.ALGORITHM,
      };
    } catch (error) {
      return {
        hasSecret,
        hasStored: false,
        isValid: false,
        isEncrypted: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export { SystemCrypto };