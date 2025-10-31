import jwt from "jsonwebtoken";
import { UserCrypto } from "./user-crypto.js";
import { SystemCrypto } from "./system-crypto.js";
import { DataCrypto } from "./data-crypto.js";
import { databaseLogger } from "./logger.js";
import type { Request, Response, NextFunction } from "express";
import { db } from "../database/db/index.js";
import { sessions } from "../database/db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DeviceType } from "./user-agent-parser.js";

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
  sessionId?: string;
  pendingTOTP?: boolean;
  iat?: number;
  exp?: number;
}

interface AuthenticatedRequest extends Request {
  userId?: string;
  pendingTOTP?: boolean;
  dataKey?: Buffer;
}

interface RequestWithHeaders extends Request {
  headers: Request["headers"] & {
    "x-forwarded-proto"?: string;
  };
}

class AuthManager {
  private static instance: AuthManager;
  private systemCrypto: SystemCrypto;
  private userCrypto: UserCrypto;
  private invalidatedTokens: Set<string> = new Set();

  private constructor() {
    this.systemCrypto = SystemCrypto.getInstance();
    this.userCrypto = UserCrypto.getInstance();

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

  async initialize(): Promise<void> {
    await this.systemCrypto.initializeJWTSecret();
  }

  async registerUser(userId: string, password: string): Promise<void> {
    await this.userCrypto.setupUserEncryption(userId, password);
  }

  async registerOIDCUser(userId: string): Promise<void> {
    await this.userCrypto.setupOIDCUserEncryption(userId);
  }

  async authenticateOIDCUser(userId: string): Promise<boolean> {
    const authenticated = await this.userCrypto.authenticateOIDCUser(userId);

    if (authenticated) {
      await this.performLazyEncryptionMigration(userId);
    }

    return authenticated;
  }

  async authenticateUser(userId: string, password: string): Promise<boolean> {
    const authenticated = await this.userCrypto.authenticateUser(
      userId,
      password,
    );

    if (authenticated) {
      await this.performLazyEncryptionMigration(userId);
    }

    return authenticated;
  }

  private async performLazyEncryptionMigration(userId: string): Promise<void> {
    try {
      const userDataKey = this.getUserDataKey(userId);
      if (!userDataKey) {
        databaseLogger.warn(
          "Cannot perform lazy encryption migration - user data key not available",
          {
            operation: "lazy_encryption_migration_no_key",
            userId,
          },
        );
        return;
      }

      const { getSqlite, saveMemoryDatabaseToFile } = await import(
        "../database/db/index.js"
      );

      const sqlite = getSqlite();

      const migrationResult = await DataCrypto.migrateUserSensitiveFields(
        userId,
        userDataKey,
        sqlite,
      );

      if (migrationResult.migrated) {
        await saveMemoryDatabaseToFile();
      }
    } catch (error) {
      databaseLogger.error("Lazy encryption migration failed", error, {
        operation: "lazy_encryption_migration_error",
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async generateJWTToken(
    userId: string,
    options: {
      expiresIn?: string;
      pendingTOTP?: boolean;
      deviceType?: DeviceType;
      deviceInfo?: string;
    } = {},
  ): Promise<string> {
    const jwtSecret = await this.systemCrypto.getJWTSecret();

    // Determine expiration based on device type
    let expiresIn = options.expiresIn;
    if (!expiresIn && !options.pendingTOTP) {
      if (options.deviceType === "desktop" || options.deviceType === "mobile") {
        expiresIn = "30d"; // 30 days for desktop and mobile
      } else {
        expiresIn = "7d"; // 7 days for web
      }
    } else if (!expiresIn) {
      expiresIn = "7d"; // Default
    }

    const payload: JWTPayload = { userId };
    if (options.pendingTOTP) {
      payload.pendingTOTP = true;
    }

    // Create session in database if not a temporary TOTP token
    if (!options.pendingTOTP && options.deviceType && options.deviceInfo) {
      const sessionId = nanoid();
      payload.sessionId = sessionId;

      // Generate the token first to get it for storage
      const token = jwt.sign(payload, jwtSecret, {
        expiresIn,
      } as jwt.SignOptions);

      // Calculate expiration timestamp
      const expirationMs = this.parseExpiresIn(expiresIn);
      const expiresAt = new Date(Date.now() + expirationMs).toISOString();

      // Store session in database
      try {
        await db.insert(sessions).values({
          id: sessionId,
          userId,
          jwtToken: token,
          deviceType: options.deviceType,
          deviceInfo: options.deviceInfo,
          expiresAt,
        });

        databaseLogger.info("Session created", {
          operation: "session_create",
          userId,
          sessionId,
          deviceType: options.deviceType,
          expiresAt,
        });
      } catch (error) {
        databaseLogger.error("Failed to create session", error, {
          operation: "session_create_failed",
          userId,
          sessionId,
        });
        // Continue anyway - session tracking is non-critical
      }

      return token;
    }

    return jwt.sign(payload, jwtSecret, { expiresIn } as jwt.SignOptions);
  }

  /**
   * Parse expiresIn string to milliseconds
   */
  private parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // Default 7 days

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case "s":
        return value * 1000;
      case "m":
        return value * 60 * 1000;
      case "h":
        return value * 60 * 60 * 1000;
      case "d":
        return value * 24 * 60 * 60 * 1000;
      default:
        return 7 * 24 * 60 * 60 * 1000;
    }
  }

  async verifyJWTToken(token: string): Promise<JWTPayload | null> {
    try {
      if (this.invalidatedTokens.has(token)) {
        return null;
      }

      const jwtSecret = await this.systemCrypto.getJWTSecret();
      const payload = jwt.verify(token, jwtSecret) as JWTPayload;
      return payload;
    } catch (error) {
      databaseLogger.warn("JWT verification failed", {
        operation: "jwt_verify_failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }

  invalidateJWTToken(token: string): void {
    this.invalidatedTokens.add(token);
  }

  invalidateUserTokens(userId: string): void {
    databaseLogger.info("User tokens invalidated due to data lock", {
      operation: "user_tokens_invalidate",
      userId,
    });
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    try {
      // Get the session to blacklist the token
      const sessionRecords = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

      if (sessionRecords.length > 0) {
        const session = sessionRecords[0];
        this.invalidatedTokens.add(session.jwtToken);
      }

      // Delete the session instead of marking as revoked
      await db.delete(sessions).where(eq(sessions.id, sessionId));

      databaseLogger.info("Session deleted", {
        operation: "session_delete",
        sessionId,
      });

      return true;
    } catch (error) {
      databaseLogger.error("Failed to delete session", error, {
        operation: "session_delete_failed",
        sessionId,
      });
      return false;
    }
  }

  async revokeAllUserSessions(
    userId: string,
    exceptSessionId?: string,
  ): Promise<number> {
    try {
      // Get all user sessions to blacklist tokens
      let query = db.select().from(sessions).where(eq(sessions.userId, userId));

      const userSessions = await query;

      // Add all tokens to blacklist (except the excepted one)
      for (const session of userSessions) {
        if (!exceptSessionId || session.id !== exceptSessionId) {
          this.invalidatedTokens.add(session.jwtToken);
        }
      }

      // Delete sessions instead of marking as revoked
      if (exceptSessionId) {
        await db
          .delete(sessions)
          .where(
            and(
              eq(sessions.userId, userId),
              sql`${sessions.id} != ${exceptSessionId}`,
            ),
          );
      } else {
        await db.delete(sessions).where(eq(sessions.userId, userId));
      }

      const deletedCount = userSessions.filter(
        (s) => !exceptSessionId || s.id !== exceptSessionId,
      ).length;

      databaseLogger.info("User sessions deleted", {
        operation: "user_sessions_delete",
        userId,
        exceptSessionId,
        deletedCount,
      });

      return deletedCount;
    } catch (error) {
      databaseLogger.error("Failed to delete user sessions", error, {
        operation: "user_sessions_delete_failed",
        userId,
      });
      return 0;
    }
  }

  async cleanupExpiredSessions(): Promise<number> {
    try {
      // Get expired sessions to blacklist their tokens
      const expiredSessions = await db
        .select()
        .from(sessions)
        .where(sql`${sessions.expiresAt} < datetime('now')`);

      // Add expired tokens to blacklist
      for (const session of expiredSessions) {
        this.invalidatedTokens.add(session.jwtToken);
      }

      // Delete expired sessions
      await db
        .delete(sessions)
        .where(sql`${sessions.expiresAt} < datetime('now')`);

      if (expiredSessions.length > 0) {
        databaseLogger.info("Expired sessions cleaned up", {
          operation: "sessions_cleanup",
          count: expiredSessions.length,
        });
      }

      return expiredSessions.length;
    } catch (error) {
      databaseLogger.error("Failed to cleanup expired sessions", error, {
        operation: "sessions_cleanup_failed",
      });
      return 0;
    }
  }

  async getAllSessions(): Promise<any[]> {
    try {
      const allSessions = await db.select().from(sessions);
      return allSessions;
    } catch (error) {
      databaseLogger.error("Failed to get all sessions", error, {
        operation: "sessions_get_all_failed",
      });
      return [];
    }
  }

  async getUserSessions(userId: string): Promise<any[]> {
    try {
      const userSessions = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId));
      return userSessions;
    } catch (error) {
      databaseLogger.error("Failed to get user sessions", error, {
        operation: "sessions_get_user_failed",
        userId,
      });
      return [];
    }
  }

  getSecureCookieOptions(
    req: RequestWithHeaders,
    maxAge: number = 7 * 24 * 60 * 60 * 1000,
  ) {
    return {
      httpOnly: false,
      secure: req.secure || req.headers["x-forwarded-proto"] === "https",
      sameSite: "strict" as const,
      maxAge: maxAge,
      path: "/",
    };
  }

  createAuthMiddleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const authReq = req as AuthenticatedRequest;
      let token = authReq.cookies?.jwt;

      if (!token) {
        const authHeader = authReq.headers["authorization"];
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

      // Check session status if sessionId is present
      if (payload.sessionId) {
        try {
          const sessionRecords = await db
            .select()
            .from(sessions)
            .where(eq(sessions.id, payload.sessionId))
            .limit(1);

          if (sessionRecords.length === 0) {
            return res.status(401).json({
              error: "Session not found",
              code: "SESSION_NOT_FOUND",
            });
          }

          const session = sessionRecords[0];

          // Session exists, no need to check isRevoked since we delete sessions instead

          // Check if session has expired
          if (new Date(session.expiresAt) < new Date()) {
            return res.status(401).json({
              error: "Session has expired",
              code: "SESSION_EXPIRED",
            });
          }

          // Update lastActiveAt timestamp (async, non-blocking)
          db.update(sessions)
            .set({ lastActiveAt: new Date().toISOString() })
            .where(eq(sessions.id, payload.sessionId))
            .then(() => {})
            .catch((error) => {
              databaseLogger.warn("Failed to update session lastActiveAt", {
                operation: "session_update_last_active",
                sessionId: payload.sessionId,
                error: error instanceof Error ? error.message : "Unknown error",
              });
            });
        } catch (error) {
          databaseLogger.error("Session check failed", error, {
            operation: "session_check_failed",
            sessionId: payload.sessionId,
          });
          // Continue anyway - session tracking failures shouldn't block auth
        }
      }

      authReq.userId = payload.userId;
      authReq.pendingTOTP = payload.pendingTOTP;
      next();
    };
  }

  createDataAccessMiddleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.userId;
      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const dataKey = this.userCrypto.getUserDataKey(userId);
      if (!dataKey) {
        return res.status(401).json({
          error: "Session expired - please log in again",
          code: "SESSION_EXPIRED",
        });
      }

      authReq.dataKey = dataKey;
      next();
    };
  }

  createAdminMiddleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      let token = req.cookies?.jwt;

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

      try {
        const { db } = await import("../database/db/index.js");
        const { users } = await import("../database/db/schema.js");
        const { eq } = await import("drizzle-orm");

        const user = await db
          .select()
          .from(users)
          .where(eq(users.id, payload.userId));

        if (!user || user.length === 0 || !user[0].is_admin) {
          databaseLogger.warn(
            "Non-admin user attempted to access admin endpoint",
            {
              operation: "admin_access_denied",
              userId: payload.userId,
              endpoint: req.path,
            },
          );
          return res.status(403).json({ error: "Admin access required" });
        }

        const authReq = req as AuthenticatedRequest;
        authReq.userId = payload.userId;
        authReq.pendingTOTP = payload.pendingTOTP;
        next();
      } catch (error) {
        databaseLogger.error("Failed to verify admin privileges", error, {
          operation: "admin_check_failed",
          userId: payload.userId,
        });
        return res
          .status(500)
          .json({ error: "Failed to verify admin privileges" });
      }
    };
  }

  logoutUser(userId: string): void {
    this.userCrypto.logoutUser(userId);
  }

  getUserDataKey(userId: string): Buffer | null {
    return this.userCrypto.getUserDataKey(userId);
  }

  isUserUnlocked(userId: string): boolean {
    return this.userCrypto.isUserUnlocked(userId);
  }

  async changeUserPassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    return await this.userCrypto.changeUserPassword(
      userId,
      oldPassword,
      newPassword,
    );
  }

  async resetUserPasswordWithPreservedDEK(
    userId: string,
    newPassword: string,
  ): Promise<boolean> {
    return await this.userCrypto.resetUserPasswordWithPreservedDEK(
      userId,
      newPassword,
    );
  }
}

export { AuthManager, type AuthenticationResult, type JWTPayload };
