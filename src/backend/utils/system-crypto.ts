import crypto from "crypto";
import { databaseLogger } from "./logger.js";

/**
 * SystemCrypto - Open source friendly system key management
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
  private databaseKey: Buffer | null = null;


  private constructor() {}

  static getInstance(): SystemCrypto {
    if (!this.instance) {
      this.instance = new SystemCrypto();
    }
    return this.instance;
  }

  /**
   * Initialize JWT secret - environment variable only
   */
  async initializeJWTSecret(): Promise<void> {
    try {
      databaseLogger.info("Initializing JWT secret", {
        operation: "jwt_init",
      });

      // Check environment variable
      const envSecret = process.env.JWT_SECRET;
      if (envSecret && envSecret.length >= 64) {
        this.jwtSecret = envSecret;
        databaseLogger.info("✅ Using JWT secret from environment variable", {
          operation: "jwt_env_loaded",
          source: "environment"
        });
        return;
      }

      // No environment variable - generate and guide user
      await this.generateAndGuideUser();

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
   * Initialize database encryption key - environment variable only
   */
  async initializeDatabaseKey(): Promise<void> {
    try {
      databaseLogger.info("Initializing database encryption key", {
        operation: "db_key_init",
      });

      // Check environment variable
      const envKey = process.env.DATABASE_KEY;
      if (envKey && envKey.length >= 64) {
        this.databaseKey = Buffer.from(envKey, 'hex');
        databaseLogger.info("✅ Using database key from environment variable", {
          operation: "db_key_env_loaded",
          source: "environment"
        });
        return;
      }

      // No environment variable - generate and guide user
      await this.generateAndGuideDatabaseKey();

    } catch (error) {
      databaseLogger.error("Failed to initialize database key", error, {
        operation: "db_key_init_failed",
      });
      throw new Error("Database key initialization failed");
    }
  }

  /**
   * Get database encryption key
   */
  async getDatabaseKey(): Promise<Buffer> {
    if (!this.databaseKey) {
      await this.initializeDatabaseKey();
    }
    return this.databaseKey!;
  }

  /**
   * Generate and guide user - no fallback storage
   */
  private async generateAndGuideUser(): Promise<void> {
    const newSecret = crypto.randomBytes(32).toString('hex');
    const instanceId = crypto.randomBytes(8).toString('hex');

    // Set in memory for current session
    this.jwtSecret = newSecret;

    // Guide user to set environment variable
    console.log("\n" + "=".repeat(80));
    console.log("🔐 TERMIX FIRST STARTUP - JWT SECRET REQUIRED");
    console.log("=".repeat(80));
    console.log(`Generated JWT Secret: ${newSecret}`);
    console.log("");
    console.log("⚠️  REQUIRED: Set this environment variable:");
    console.log(`   export JWT_SECRET=${newSecret}`);
    console.log("");
    console.log("🔄 Restart Termix after setting the environment variable");
    console.log("=".repeat(80) + "\n");

    databaseLogger.warn("⚠️  JWT secret generated for current session only", {
      operation: "jwt_temp_generated",
      instanceId,
      envVarName: "JWT_SECRET",
      note: "Set environment variable and restart for persistent operation"
    });
  }


  // ===== Database key generation and storage methods =====

  /**
   * Generate and guide database key - no fallback storage
   */
  private async generateAndGuideDatabaseKey(): Promise<void> {
    const newKey = crypto.randomBytes(32); // 256-bit key for AES-256
    const newKeyHex = newKey.toString('hex');
    const instanceId = crypto.randomBytes(8).toString('hex');

    // Set in memory for current session
    this.databaseKey = newKey;

    // Guide user to set environment variable
    console.log("\n" + "=".repeat(80));
    console.log("🔒 TERMIX FIRST STARTUP - DATABASE KEY REQUIRED");
    console.log("=".repeat(80));
    console.log(`Generated Database Key: ${newKeyHex}`);
    console.log("");
    console.log("⚠️  REQUIRED: Set this environment variable:");
    console.log(`   export DATABASE_KEY=${newKeyHex}`);
    console.log("");
    console.log("🔄 Restart Termix after setting the environment variable");
    console.log("=".repeat(80) + "\n");

    databaseLogger.warn("⚠️  Database key generated for current session only", {
      operation: "db_key_temp_generated",
      instanceId,
      envVarName: "DATABASE_KEY",
      note: "Set environment variable and restart for persistent operation"
    });
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


    // Check environment variable
    const hasEnvVar = !!(process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 64);

    return {
      hasSecret,
      isValid,
      storage: {
        environment: hasEnvVar
      },
      algorithm: "HS256",
      note: "Using simplified key management without encryption layers"
    };
  }
}

export { SystemCrypto };