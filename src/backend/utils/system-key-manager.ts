import crypto from "crypto";
import { db } from "../database/db/index.js";
import { settings } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import { databaseLogger } from "./logger.js";

/**
 * SystemKeyManager - Manage system-level keys (JWT etc.)
 *
 * Responsibilities:
 * - JWT Secret generation, storage and retrieval
 * - System-level key lifecycle management
 * - Complete separation from user data keys
 */
class SystemKeyManager {
  private static instance: SystemKeyManager;
  private jwtSecret: string | null = null;

  private constructor() {}

  static getInstance(): SystemKeyManager {
    if (!this.instance) {
      this.instance = new SystemKeyManager();
    }
    return this.instance;
  }

  /**
   * Initialize JWT key - called at system startup
   */
  async initializeJWTSecret(): Promise<void> {
    try {
      databaseLogger.info("Initializing system JWT secret", {
        operation: "system_jwt_init",
      });

      const existingSecret = await this.getStoredJWTSecret();
      if (existingSecret) {
        this.jwtSecret = existingSecret;
        databaseLogger.success("System JWT secret loaded from storage", {
          operation: "system_jwt_loaded",
        });
      } else {
        const newSecret = await this.generateJWTSecret();
        this.jwtSecret = newSecret;
        databaseLogger.success("New system JWT secret generated", {
          operation: "system_jwt_generated",
          secretLength: newSecret.length,
        });
      }
    } catch (error) {
      databaseLogger.error("Failed to initialize JWT secret", error, {
        operation: "system_jwt_init_failed",
      });
      throw new Error("System JWT secret initialization failed");
    }
  }

  /**
   * Get JWT key - for JWT signing and verification
   */
  async getJWTSecret(): Promise<string> {
    if (!this.jwtSecret) {
      await this.initializeJWTSecret();
    }
    return this.jwtSecret!;
  }

  /**
   * Generate new JWT key
   */
  private async generateJWTSecret(): Promise<string> {
    const secret = crypto.randomBytes(64).toString("hex");
    const secretId = crypto.randomBytes(8).toString("hex");

    const secretData = {
      secret: Buffer.from(secret, "hex").toString("base64"), // Simple base64 encoding
      secretId,
      createdAt: new Date().toISOString(),
      algorithm: "HS256",
    };

    try {
      // Store to settings table
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

      databaseLogger.info("System JWT secret stored successfully", {
        operation: "system_jwt_stored",
        secretId,
      });

      return secret;
    } catch (error) {
      databaseLogger.error("Failed to store JWT secret", error, {
        operation: "system_jwt_store_failed",
      });
      throw error;
    }
  }

  /**
   * Read JWT key from database
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
      return Buffer.from(secretData.secret, "base64").toString("hex");
    } catch (error) {
      databaseLogger.warn("Failed to load stored JWT secret", {
        operation: "system_jwt_load_failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }

  /**
   * Regenerate JWT key - admin operation
   */
  async regenerateJWTSecret(): Promise<string> {
    databaseLogger.warn("Regenerating system JWT secret - ALL TOKENS WILL BE INVALIDATED", {
      operation: "system_jwt_regenerate",
    });

    const newSecret = await this.generateJWTSecret();
    this.jwtSecret = newSecret;

    databaseLogger.success("System JWT secret regenerated", {
      operation: "system_jwt_regenerated",
      warning: "All existing JWT tokens are now invalid",
    });

    return newSecret;
  }

  /**
   * Validate if JWT key is available
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
        operation: "system_jwt_validation_failed",
      });
      return false;
    }
  }

  /**
   * Get system key status
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

      if (hasStored) {
        const secretData = JSON.parse(result[0].value);
        createdAt = secretData.createdAt;
        secretId = secretData.secretId;
      }

      return {
        hasSecret,
        hasStored,
        isValid,
        createdAt,
        secretId,
        algorithm: "HS256",
      };
    } catch (error) {
      return {
        hasSecret,
        hasStored: false,
        isValid: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export { SystemKeyManager };