import jwt from "jsonwebtoken";
import { UserCrypto } from "./user-crypto.js";
import { SystemCrypto } from "./system-crypto.js";
import { DataCrypto } from "./data-crypto.js";
import { databaseLogger } from "./logger.js";
import type { Request, Response, NextFunction } from "express";

interface AuthenticationResult {
  success: boolean;
  token?: string;
  userId?: string;
  isAdmin?: boolean;
  username?: string;
  requiresTOTP?: boolean;
  tempToken?: string;
  error?: string;
}

interface JWTPayload {
  userId: string;
  pendingTOTP?: boolean;
  iat?: number;
  exp?: number;
}

/**
 * AuthManager - Simplified authentication manager
 *
 * Responsibilities:
 * - JWT generation and validation
 * - Authentication middleware
 * - User login/logout
 *
 * No more two-layer sessions - use UserKeyManager directly
 */
class AuthManager {
  private static instance: AuthManager;
  private systemCrypto: SystemCrypto;
  private userCrypto: UserCrypto;

  private constructor() {
    this.systemCrypto = SystemCrypto.getInstance();
    this.userCrypto = UserCrypto.getInstance();
  }

  static getInstance(): AuthManager {
    if (!this.instance) {
      this.instance = new AuthManager();
    }
    return this.instance;
  }

  /**
   * Initialize authentication system
   */
  async initialize(): Promise<void> {
    await this.systemCrypto.initializeJWTSecret();
    databaseLogger.info("AuthManager initialized", {
      operation: "auth_init"
    });
  }

  /**
   * User registration
   */
  async registerUser(userId: string, password: string): Promise<void> {
    await this.userCrypto.setupUserEncryption(userId, password);
  }

  /**
   * User login with lazy encryption migration
   */
  async authenticateUser(userId: string, password: string): Promise<boolean> {
    const authenticated = await this.userCrypto.authenticateUser(userId, password);

    if (authenticated) {
      // Trigger lazy encryption migration for user's sensitive fields
      await this.performLazyEncryptionMigration(userId);
    }

    return authenticated;
  }

  /**
   * Perform lazy encryption migration for user's sensitive data
   * This runs asynchronously after successful login
   */
  private async performLazyEncryptionMigration(userId: string): Promise<void> {
    try {
      const userDataKey = this.getUserDataKey(userId);
      if (!userDataKey) {
        databaseLogger.warn("Cannot perform lazy encryption migration - user data key not available", {
          operation: "lazy_encryption_migration_no_key",
          userId,
        });
        return;
      }

      // Import database connection - need to access raw SQLite for migration
      const { getDb } = await import("../database/db/index.js");
      const db = getDb();

      // Get the underlying SQLite instance
      const sqlite = (db as any)._.session.db;

      // Perform the migration
      const migrationResult = await DataCrypto.migrateUserSensitiveFields(
        userId,
        userDataKey,
        sqlite
      );

      if (migrationResult.migrated) {
        databaseLogger.success("Lazy encryption migration completed for user", {
          operation: "lazy_encryption_migration_success",
          userId,
          migratedTables: migrationResult.migratedTables,
          migratedFieldsCount: migrationResult.migratedFieldsCount,
        });
      } else {
        databaseLogger.debug("No lazy encryption migration needed for user", {
          operation: "lazy_encryption_migration_not_needed",
          userId,
        });
      }

    } catch (error) {
      // Log error but don't fail the login process
      databaseLogger.error("Lazy encryption migration failed", error, {
        operation: "lazy_encryption_migration_error",
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Generate JWT Token
   */
  async generateJWTToken(
    userId: string,
    options: { expiresIn?: string; pendingTOTP?: boolean } = {}
  ): Promise<string> {
    const jwtSecret = await this.systemCrypto.getJWTSecret();

    const payload: JWTPayload = { userId };
    if (options.pendingTOTP) {
      payload.pendingTOTP = true;
    }

    return jwt.sign(payload, jwtSecret, {
      expiresIn: options.expiresIn || "24h"
    } as jwt.SignOptions);
  }

  /**
   * Verify JWT Token
   */
  async verifyJWTToken(token: string): Promise<JWTPayload | null> {
    try {
      const jwtSecret = await this.systemCrypto.getJWTSecret();
      const payload = jwt.verify(token, jwtSecret) as JWTPayload;
      return payload;
    } catch (error) {
      databaseLogger.warn("JWT verification failed", {
        operation: "jwt_verify_failed",
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Authentication middleware
   */
  createAuthMiddleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const authHeader = req.headers["authorization"];
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing Authorization header" });
      }

      const token = authHeader.split(" ")[1];
      const payload = await this.verifyJWTToken(token);

      if (!payload) {
        return res.status(401).json({ error: "Invalid token" });
      }

      (req as any).userId = payload.userId;
      (req as any).pendingTOTP = payload.pendingTOTP;
      next();
    };
  }

  /**
   * Data access middleware - requires user to have unlocked data
   */
  createDataAccessMiddleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const userId = (req as any).userId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const dataKey = this.userCrypto.getUserDataKey(userId);
      if (!dataKey) {
        return res.status(423).json({
          error: "Data locked - re-authenticate with password",
          code: "DATA_LOCKED"
        });
      }

      (req as any).dataKey = dataKey;
      next();
    };
  }

  /**
   * Admin middleware - requires user to be authenticated and have admin privileges
   */
  createAdminMiddleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const authHeader = req.headers["authorization"];
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Missing Authorization header" });
      }

      const token = authHeader.split(" ")[1];
      const payload = await this.verifyJWTToken(token);

      if (!payload) {
        return res.status(401).json({ error: "Invalid token" });
      }

      // Check if user is admin
      try {
        const { db } = await import("../database/db/index.js");
        const { users } = await import("../database/db/schema.js");
        const { eq } = await import("drizzle-orm");

        const user = await db.select().from(users).where(eq(users.id, payload.userId));

        if (!user || user.length === 0 || !user[0].is_admin) {
          databaseLogger.warn("Non-admin user attempted to access admin endpoint", {
            operation: "admin_access_denied",
            userId: payload.userId,
            endpoint: req.path,
          });
          return res.status(403).json({ error: "Admin access required" });
        }

        (req as any).userId = payload.userId;
        (req as any).pendingTOTP = payload.pendingTOTP;
        next();
      } catch (error) {
        databaseLogger.error("Failed to verify admin privileges", error, {
          operation: "admin_check_failed",
          userId: payload.userId,
        });
        return res.status(500).json({ error: "Failed to verify admin privileges" });
      }
    };
  }

  /**
   * User logout
   */
  logoutUser(userId: string): void {
    this.userCrypto.logoutUser(userId);
  }

  /**
   * Get user data key
   */
  getUserDataKey(userId: string): Buffer | null {
    return this.userCrypto.getUserDataKey(userId);
  }

  /**
   * Check if user is unlocked
   */
  isUserUnlocked(userId: string): boolean {
    return this.userCrypto.isUserUnlocked(userId);
  }

  /**
   * Change user password
   */
  async changeUserPassword(userId: string, oldPassword: string, newPassword: string): Promise<boolean> {
    return await this.userCrypto.changeUserPassword(userId, oldPassword, newPassword);
  }
}

export { AuthManager, type AuthenticationResult, type JWTPayload };