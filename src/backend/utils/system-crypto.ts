import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
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
  private internalAuthToken: string | null = null;


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
      databaseLogger.info("Checking DATABASE_KEY from environment", {
        operation: "db_key_check",
        hasKey: !!envKey,
        keyLength: envKey?.length || 0,
        meetsLengthRequirement: envKey && envKey.length >= 64
      });
      
      if (envKey && envKey.length >= 64) {
        this.databaseKey = Buffer.from(envKey, 'hex');
        databaseLogger.info("Using existing DATABASE_KEY from environment", {
          operation: "db_key_use_existing",
          keyLength: envKey.length
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
   * Initialize internal auth token - environment variable only
   */
  async initializeInternalAuthToken(): Promise<void> {
    try {
      databaseLogger.info("Initializing internal auth token", {
        operation: "internal_auth_init",
      });

      // Check environment variable
      const envToken = process.env.INTERNAL_AUTH_TOKEN;
      if (envToken && envToken.length >= 32) {
        this.internalAuthToken = envToken;
        return;
      }

      // No environment variable - generate and guide user
      await this.generateAndGuideInternalAuthToken();

    } catch (error) {
      databaseLogger.error("Failed to initialize internal auth token", error, {
        operation: "internal_auth_init_failed",
      });
      throw new Error("Internal auth token initialization failed");
    }
  }

  /**
   * Get internal auth token
   */
  async getInternalAuthToken(): Promise<string> {
    if (!this.internalAuthToken) {
      await this.initializeInternalAuthToken();
    }
    return this.internalAuthToken!;
  }

  /**
   * Generate and auto-save to .env file
   */
  private async generateAndGuideUser(): Promise<void> {
    const newSecret = crypto.randomBytes(32).toString('hex');
    const instanceId = crypto.randomBytes(8).toString('hex');

    // Set in memory for current session
    this.jwtSecret = newSecret;

    // Auto-save to .env file
    await this.updateEnvFile("JWT_SECRET", newSecret);

    databaseLogger.success("JWT secret auto-generated and saved to .env", {
      operation: "jwt_auto_generated",
      instanceId,
      envVarName: "JWT_SECRET",
      note: "Ready for use - no restart required"
    });
  }


  // ===== Database key generation and storage methods =====

  /**
   * Generate and auto-save database key to .env file
   */
  private async generateAndGuideDatabaseKey(): Promise<void> {
    const newKey = crypto.randomBytes(32); // 256-bit key for AES-256
    const newKeyHex = newKey.toString('hex');
    const instanceId = crypto.randomBytes(8).toString('hex');

    // Set in memory for current session
    this.databaseKey = newKey;

    // Auto-save to .env file
    await this.updateEnvFile("DATABASE_KEY", newKeyHex);

    databaseLogger.success("🔒 Database key auto-generated and saved to .env", {
      operation: "db_key_auto_generated",
      instanceId,
      envVarName: "DATABASE_KEY",
      note: "Ready for use - no restart required"
    });
  }

  /**
   * Generate and auto-save internal auth token to .env file
   */
  private async generateAndGuideInternalAuthToken(): Promise<void> {
    const newToken = crypto.randomBytes(32).toString('hex'); // 256-bit token for security
    const instanceId = crypto.randomBytes(8).toString('hex');

    // Set in memory for current session
    this.internalAuthToken = newToken;

    // Auto-save to .env file
    await this.updateEnvFile("INTERNAL_AUTH_TOKEN", newToken);

    databaseLogger.success("Internal auth token auto-generated and saved to .env", {
      operation: "internal_auth_auto_generated",
      instanceId,
      envVarName: "INTERNAL_AUTH_TOKEN",
      note: "Ready for use - no restart required"
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

  /**
   * Update .env file with new environment variable
   */
  private async updateEnvFile(key: string, value: string): Promise<void> {
    // Use data directory for .env file (where database is stored)
    // This keeps keys and data together in one volume
    const dataDir = process.env.DATA_DIR || "./db/data";
    const envPath = path.join(dataDir, ".env");

    try {
      // Ensure data directory exists
      await fs.mkdir(dataDir, { recursive: true });

      let envContent = "";

      // Read existing .env file if it exists
      try {
        envContent = await fs.readFile(envPath, "utf8");
      } catch {
        // File doesn't exist, will create new one
        envContent = "# Termix Auto-generated Configuration\n\n";
      }

      // Check if key already exists
      const keyRegex = new RegExp(`^${key}=.*$`, "m");

      if (keyRegex.test(envContent)) {
        // Update existing key
        envContent = envContent.replace(keyRegex, `${key}=${value}`);
      } else {
        // Add new key
        if (!envContent.includes("# Security Keys")) {
          envContent += "\n# Security Keys (Auto-generated)\n";
        }
        envContent += `${key}=${value}\n`;
      }

      // Write updated content
      await fs.writeFile(envPath, envContent);

      // Update process.env for current session
      process.env[key] = value;

      databaseLogger.info(`Environment variable ${key} updated in .env file`, {
        operation: "env_file_update",
        key,
        path: envPath
      });

    } catch (error) {
      databaseLogger.error(`Failed to update .env file with ${key}`, error, {
        operation: "env_file_update_failed",
        key
      });
      throw error;
    }
  }
}

export { SystemCrypto };