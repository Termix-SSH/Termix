import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { db } from "../database/db/index.js";
import { settings } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import { databaseLogger } from "./logger.js";

/**
 * SystemCrypto - 开源友好的JWT密钥管理
 *
 * Linus原则：
 * - 删除复杂的"系统主密钥"层 - 不解决真实威胁
 * - 删除硬编码默认密钥 - 开源软件的安全灾难
 * - 首次启动自动生成 - 每个实例独立安全
 * - 简单直接，专注真正的安全边界
 */
class SystemCrypto {
  private static instance: SystemCrypto;
  private jwtSecret: string | null = null;

  // 存储路径配置
  private static readonly JWT_SECRET_FILE = path.join(process.cwd(), '.termix', 'jwt.key');
  private static readonly JWT_SECRET_DB_KEY = 'system_jwt_secret';

  private constructor() {}

  static getInstance(): SystemCrypto {
    if (!this.instance) {
      this.instance = new SystemCrypto();
    }
    return this.instance;
  }

  /**
   * 初始化JWT密钥 - 开源友好的方式
   */
  async initializeJWTSecret(): Promise<void> {
    try {
      databaseLogger.info("Initializing JWT secret", {
        operation: "jwt_init",
      });

      // 1. 环境变量优先（生产环境最佳实践）
      const envSecret = process.env.JWT_SECRET;
      if (envSecret && envSecret.length >= 64) {
        this.jwtSecret = envSecret;
        databaseLogger.info("✅ Using JWT secret from environment variable", {
          operation: "jwt_env_loaded",
          source: "environment"
        });
        return;
      }

      // 2. 检查文件系统存储
      const fileSecret = await this.loadSecretFromFile();
      if (fileSecret) {
        this.jwtSecret = fileSecret;
        databaseLogger.info("✅ Loaded JWT secret from file", {
          operation: "jwt_file_loaded",
          source: "file"
        });
        return;
      }

      // 3. 检查数据库存储
      const dbSecret = await this.loadSecretFromDB();
      if (dbSecret) {
        this.jwtSecret = dbSecret;
        databaseLogger.info("✅ Loaded JWT secret from database", {
          operation: "jwt_db_loaded",
          source: "database"
        });
        return;
      }

      // 4. 生成新密钥并持久化
      await this.generateAndStoreSecret();

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
   * 生成新密钥并持久化存储
   */
  private async generateAndStoreSecret(): Promise<void> {
    const newSecret = crypto.randomBytes(32).toString('hex');
    const instanceId = crypto.randomBytes(8).toString('hex');

    databaseLogger.info("🔑 Generating new JWT secret for this Termix instance", {
      operation: "jwt_generate",
      instanceId
    });

    // 尝试文件存储（优先，因为更快且不依赖数据库）
    try {
      await this.saveSecretToFile(newSecret);
      databaseLogger.info("✅ JWT secret saved to file", {
        operation: "jwt_file_saved",
        path: SystemCrypto.JWT_SECRET_FILE
      });
    } catch (fileError) {
      databaseLogger.warn("⚠️  Cannot save to file, using database storage", {
        operation: "jwt_file_save_failed",
        error: fileError instanceof Error ? fileError.message : "Unknown error"
      });

      // 文件存储失败，使用数据库
      await this.saveSecretToDB(newSecret, instanceId);
      databaseLogger.info("✅ JWT secret saved to database", {
        operation: "jwt_db_saved"
      });
    }

    this.jwtSecret = newSecret;

    databaseLogger.success("🔐 This Termix instance now has a unique JWT secret", {
      operation: "jwt_generated_success",
      instanceId,
      note: "All tokens from previous sessions are invalidated"
    });
  }

  // ===== 文件存储方法 =====

  /**
   * 保存密钥到文件
   */
  private async saveSecretToFile(secret: string): Promise<void> {
    const dir = path.dirname(SystemCrypto.JWT_SECRET_FILE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(SystemCrypto.JWT_SECRET_FILE, secret, {
      mode: 0o600 // 只有owner可读写
    });
  }

  /**
   * 从文件加载密钥
   */
  private async loadSecretFromFile(): Promise<string | null> {
    try {
      const secret = await fs.readFile(SystemCrypto.JWT_SECRET_FILE, 'utf8');
      if (secret.trim().length >= 64) {
        return secret.trim();
      }
      databaseLogger.warn("JWT secret file exists but too short", {
        operation: "jwt_file_invalid",
        length: secret.length
      });
    } catch (error) {
      // 文件不存在或无法读取，这是正常的
    }
    return null;
  }

  // ===== 数据库存储方法 =====

  /**
   * 保存密钥到数据库（明文存储，不假装加密有用）
   */
  private async saveSecretToDB(secret: string, instanceId: string): Promise<void> {
    const secretData = {
      secret,
      generatedAt: new Date().toISOString(),
      instanceId,
      algorithm: "HS256"
    };

    const existing = await db
      .select()
      .from(settings)
      .where(eq(settings.key, SystemCrypto.JWT_SECRET_DB_KEY));

    const encodedData = JSON.stringify(secretData);

    if (existing.length > 0) {
      await db
        .update(settings)
        .set({ value: encodedData })
        .where(eq(settings.key, SystemCrypto.JWT_SECRET_DB_KEY));
    } else {
      await db.insert(settings).values({
        key: SystemCrypto.JWT_SECRET_DB_KEY,
        value: encodedData,
      });
    }
  }

  /**
   * 从数据库加载密钥
   */
  private async loadSecretFromDB(): Promise<string | null> {
    try {
      const result = await db
        .select()
        .from(settings)
        .where(eq(settings.key, SystemCrypto.JWT_SECRET_DB_KEY));

      if (result.length === 0) {
        return null;
      }

      const secretData = JSON.parse(result[0].value);

      // 检查密钥有效性
      if (!secretData.secret || secretData.secret.length < 64) {
        databaseLogger.warn("Invalid JWT secret in database", {
          operation: "jwt_db_invalid",
          hasSecret: !!secretData.secret,
          length: secretData.secret?.length || 0
        });
        return null;
      }

      return secretData.secret;
    } catch (error) {
      databaseLogger.warn("Failed to load JWT secret from database", {
        operation: "jwt_db_load_failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }

  /**
   * 重新生成JWT密钥（管理功能）
   */
  async regenerateJWTSecret(): Promise<string> {
    databaseLogger.warn("🔄 Regenerating JWT secret - ALL TOKENS WILL BE INVALIDATED", {
      operation: "jwt_regenerate",
    });

    await this.generateAndStoreSecret();

    databaseLogger.success("JWT secret regenerated successfully", {
      operation: "jwt_regenerated",
      warning: "All existing JWT tokens are now invalid",
    });

    return this.jwtSecret!;
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
   * 获取JWT密钥状态（简化版本）
   */
  async getSystemKeyStatus() {
    const isValid = await this.validateJWTSecret();
    const hasSecret = this.jwtSecret !== null;

    // 检查文件存储
    let hasFileStorage = false;
    try {
      await fs.access(SystemCrypto.JWT_SECRET_FILE);
      hasFileStorage = true;
    } catch {
      // 文件不存在
    }

    // 检查数据库存储
    let hasDBStorage = false;
    let dbInfo = null;
    try {
      const result = await db
        .select()
        .from(settings)
        .where(eq(settings.key, SystemCrypto.JWT_SECRET_DB_KEY));

      if (result.length > 0) {
        hasDBStorage = true;
        const secretData = JSON.parse(result[0].value);
        dbInfo = {
          generatedAt: secretData.generatedAt,
          instanceId: secretData.instanceId,
          algorithm: secretData.algorithm
        };
      }
    } catch (error) {
      // 数据库读取失败
    }

    // 检查环境变量
    const hasEnvVar = !!(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 64);

    return {
      hasSecret,
      isValid,
      storage: {
        environment: hasEnvVar,
        file: hasFileStorage,
        database: hasDBStorage
      },
      dbInfo,
      algorithm: "HS256",
      note: "Using simplified key management without encryption layers"
    };
  }
}

export { SystemCrypto };