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
  private invalidatedTokens: Set<string> = new Set(); // Track invalidated JWT tokens

  private constructor() {
    this.systemCrypto = SystemCrypto.getInstance();
    this.userCrypto = UserCrypto.getInstance();
    
    // Set up callback to invalidate JWT tokens when data sessions expire
    this.userCrypto.setSessionExpiredCallback((userId: string) => {
      this.invalidateUserTokens(userId);
    });
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
      const { getSqlite, saveMemoryDatabaseToFile } = await import("../database/db/index.js");

      // Database should already be initialized by starter.ts, but ensure we can access it
      const sqlite = getSqlite();

      // Perform the migration
      const migrationResult = await DataCrypto.migrateUserSensitiveFields(
        userId,
        userDataKey,
        sqlite
      );

      if (migrationResult.migrated) {
        // Save the in-memory database to disk to persist the migration
        await saveMemoryDatabaseToFile();

        databaseLogger.success("Lazy encryption migration completed for user", {
          operation: "lazy_encryption_migration_success",
          userId,
          migratedTables: migrationResult.migratedTables,
          migratedFieldsCount: migrationResult.migratedFieldsCount,
        });
      } else {
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
      // Check if token is in invalidated list
      if (this.invalidatedTokens.has(token)) {
        databaseLogger.debug("JWT token is invalidated", {
          operation: "jwt_verify_invalidated",
          tokenPrefix: token.substring(0, 20) + "..."
        });
        return null;
      }

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
   * Invalidate JWT token (add to blacklist)
   */
  invalidateJWTToken(token: string): void {
    this.invalidatedTokens.add(token);
    databaseLogger.info("JWT token invalidated", {
      operation: "jwt_invalidate",
      tokenPrefix: token.substring(0, 20) + "..."
    });
  }

  /**
   * Invalidate all JWT tokens for a user (when data locks)
   */
  invalidateUserTokens(userId: string): void {
    // Note: This is a simplified approach. In a production system, you might want
    // to track tokens by userId and invalidate them more precisely.
    // For now, we'll rely on the data lock mechanism to handle this.
    databaseLogger.info("User tokens invalidated due to data lock", {
      operation: "user_tokens_invalidate",
      userId
    });
  }

  /**
   * Helper function to get secure cookie options based on request
   */
  getSecureCookieOptions(req: any, maxAge: number = 24 * 60 * 60 * 1000) {
    return {
      httpOnly: true,        // Prevent XSS attacks
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https', // Detect HTTPS properly
      sameSite: "strict" as const,   // Prevent CSRF attacks
      maxAge: maxAge,        // Session duration in milliseconds
      path: "/",            // Available site-wide
    };
  }

  /**
   * Authentication middleware
   */
  createAuthMiddleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Try to get JWT from secure HttpOnly cookie first
      let token = req.cookies?.jwt;
      
      // Fallback to Authorization header for backward compatibility
      if (!token) {
        const authHeader = req.headers["authorization"];
        if (authHeader?.startsWith("Bearer ")) {
          token = authHeader.split(" ")[1];
        }
      }

      if (!token) {
        return res.status(401).json({ error: "Missing authentication token" });
      }

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
        return res.status(401).json({
          error: "Session expired - please log in again",
          code: "SESSION_EXPIRED"
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