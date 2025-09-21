import crypto from "crypto";
import path from "path";
import { promises as fs } from "fs";
import { db } from "../database/db/index.js";
import { settings } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import { databaseLogger } from "./logger.js";

/**
 * SystemCrypto - Open source friendly JWT key management
 *
 * Linus principles:
 * - Remove complex "system master key" layer - doesn't solve real threats
 * - Remove hardcoded default keys - security disaster for open source software
 * - Auto-generate on first startup - each instance independently secure
 * - Simple and direct, focus on real security boundaries
 */
class SystemCrypto {
  private static instance: SystemCrypto;
  private jwtSecret: string | null = null;

  // Storage path configuration
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
   * Initialize JWT secret - open source friendly way
   */
  async initializeJWTSecret(): Promise<void> {
    try {
      databaseLogger.info("Initializing JWT secret", {
        operation: "jwt_init",
      });

      // 1. Environment variable priority (production best practice)
      const envSecret = process.env.JWT_SECRET;
      if (envSecret && envSecret.length >= 64) {
        this.jwtSecret = envSecret;
        databaseLogger.info("✅ Using JWT secret from environment variable", {
          operation: "jwt_env_loaded",
          source: "environment"
        });
        return;
      }

      // 2. Check filesystem storage
      const fileSecret = await this.loadSecretFromFile();
      if (fileSecret) {
        this.jwtSecret = fileSecret;
        databaseLogger.info("✅ Loaded JWT secret from file", {
          operation: "jwt_file_loaded",
          source: "file"
        });
        return;
      }

      // 3. Check database storage
      const dbSecret = await this.loadSecretFromDB();
      if (dbSecret) {
        this.jwtSecret = dbSecret;
        databaseLogger.info("✅ Loaded JWT secret from database", {
          operation: "jwt_db_loaded",
          source: "database"
        });
        return;
      }

      // 4. Generate new key and persist
      await this.generateAndStoreSecret();

    } catch (error) {
      databaseLogger.error("Failed to initialize JWT secret", error, {
        operation: "jwt_init_failed",
      });
      throw new Error("JWT secret initialization failed");
    }
  }

  /**
   * Get JWT secret
   */
  async getJWTSecret(): Promise<string> {
    if (!this.jwtSecret) {
      await this.initializeJWTSecret();
    }
    return this.jwtSecret!;
  }

  /**
   * Generate new key and persist storage
   */
  private async generateAndStoreSecret(): Promise<void> {
    const newSecret = crypto.randomBytes(32).toString('hex');
    const instanceId = crypto.randomBytes(8).toString('hex');

    databaseLogger.info("🔑 Generating new JWT secret for this Termix instance", {
      operation: "jwt_generate",
      instanceId
    });

    // Try file storage (priority, faster and doesn't depend on database)
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

      // File storage failed, use database
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

  // ===== File storage methods =====

  /**
   * Save key to file
   */
  private async saveSecretToFile(secret: string): Promise<void> {
    const dir = path.dirname(SystemCrypto.JWT_SECRET_FILE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(SystemCrypto.JWT_SECRET_FILE, secret, {
      mode: 0o600 // Only owner can read/write
    });
  }

  /**
   * Load key from file
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
      // File doesn't exist or can't be read, this is normal
    }
    return null;
  }

  // ===== Database storage methods =====

  /**
   * Save key to database (plaintext storage, don't pretend encryption helps)
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
   * Load key from database
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

      // Check key validity
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
   * Regenerate JWT secret (admin function)
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
   * Validate JWT secret system
   */
  async validateJWTSecret(): Promise<boolean> {
    try {
      const secret = await this.getJWTSecret();
      if (!secret || secret.length < 32) {
        return false;
      }

      // Test JWT operations
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
   * Get JWT key status (simplified version)
   */
  async getSystemKeyStatus() {
    const isValid = await this.validateJWTSecret();
    const hasSecret = this.jwtSecret !== null;

    // Check file storage
    let hasFileStorage = false;
    try {
      await fs.access(SystemCrypto.JWT_SECRET_FILE);
      hasFileStorage = true;
    } catch {
      // File doesn't exist
    }

    // Check database storage
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
      // Database read failed
    }

    // Check environment variable
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