import jwt from "jsonwebtoken";
import { UserCrypto } from "./user-crypto.js";
import { SystemCrypto } from "./system-crypto.js";
import { DataCrypto } from "./data-crypto.js";
import { databaseLogger, authLogger } from "./logger.js";
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

  private constructor() {
    this.systemCrypto = SystemCrypto.getInstance();
    this.userCrypto = UserCrypto.getInstance();

    this.userCrypto.setSessionExpiredCallback((userId: string) => {
      this.invalidateUserTokens(userId);
    });

    setInterval(
      () => {
        this.cleanupExpiredSessions().catch((error) => {
          databaseLogger.error(
            "Failed to run periodic session cleanup",
            error,
            {
              operation: "session_cleanup_periodic",
            },
          );
        });
      },
      5 * 60 * 1000,
    );
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

  async registerOIDCUser(
    userId: string,
    sessionDurationMs: number,
  ): Promise<void> {
    await this.userCrypto.setupOIDCUserEncryption(userId, sessionDurationMs);
  }

  async authenticateOIDCUser(
    userId: string,
    deviceType?: DeviceType,
  ): Promise<boolean> {
    const sessionDurationMs =
      deviceType === "desktop" || deviceType === "mobile"
        ? 30 * 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;

    const authenticated = await this.userCrypto.authenticateOIDCUser(
      userId,
      sessionDurationMs,
    );

    if (authenticated) {
      await this.performLazyEncryptionMigration(userId);
    }

    return authenticated;
  }

  async authenticateUser(
    userId: string,
    password: string,
    deviceType?: DeviceType,
  ): Promise<boolean> {
    const sessionDurationMs =
      deviceType === "desktop" || deviceType === "mobile"
        ? 30 * 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;

    const authenticated = await this.userCrypto.authenticateUser(
      userId,
      password,
      sessionDurationMs,
    );

    if (authenticated) {
      await this.performLazyEncryptionMigration(userId);
    }

    return authenticated;
  }

  async convertToOIDCEncryption(userId: string): Promise<void> {
    await this.userCrypto.convertToOIDCEncryption(userId);
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

      const { getSqlite, saveMemoryDatabaseToFile } =
        await import("../database/db/index.js");

      const sqlite = getSqlite();

      const migrationResult = await DataCrypto.migrateUserSensitiveFields(
        userId,
        userDataKey,
        sqlite,
      );

      if (migrationResult.migrated) {
        await saveMemoryDatabaseToFile();
      }

      try {
        const { CredentialSystemEncryptionMigration } =
          await import("./credential-system-encryption-migration.js");
        const credMigration = new CredentialSystemEncryptionMigration();
        const credResult = await credMigration.migrateUserCredentials(userId);

        if (credResult.migrated > 0) {
          await saveMemoryDatabaseToFile();
        }
      } catch (error) {
        databaseLogger.warn("Credential migration failed during login", {
          operation: "login_credential_migration_failed",
          userId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
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

    let expiresIn = options.expiresIn;
    if (!expiresIn && !options.pendingTOTP) {
      if (options.deviceType === "desktop" || options.deviceType === "mobile") {
        expiresIn = "30d";
      } else {
        expiresIn = "7d";
      }
    } else if (!expiresIn) {
      expiresIn = "7d";
    }

    const payload: JWTPayload = { userId };
    if (options.pendingTOTP) {
      payload.pendingTOTP = true;
    }

    if (!options.pendingTOTP && options.deviceType && options.deviceInfo) {
      const sessionId = nanoid();
      payload.sessionId = sessionId;

      const token = jwt.sign(payload, jwtSecret, {
        expiresIn,
      } as jwt.SignOptions);

      const expirationMs = this.parseExpiresIn(expiresIn);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + expirationMs).toISOString();
      const createdAt = now.toISOString();

      try {
        await db.insert(sessions).values({
          id: sessionId,
          userId,
          jwtToken: token,
          deviceType: options.deviceType,
          deviceInfo: options.deviceInfo,
          createdAt,
          expiresAt,
          lastActiveAt: createdAt,
        });

        try {
          const { saveMemoryDatabaseToFile } =
            await import("../database/db/index.js");
          await saveMemoryDatabaseToFile();
        } catch (saveError) {
          databaseLogger.error(
            "Failed to save database after session creation",
            saveError,
            {
              operation: "session_create_db_save_failed",
              sessionId,
            },
          );
        }
      } catch (error) {
        databaseLogger.error("Failed to create session", error, {
          operation: "session_create_failed",
          userId,
          sessionId,
        });
      }

      return token;
    }

    return jwt.sign(payload, jwtSecret, { expiresIn } as jwt.SignOptions);
  }

  private parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000;

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
      const jwtSecret = await this.systemCrypto.getJWTSecret();

      const payload = jwt.verify(token, jwtSecret) as JWTPayload;

      if (payload.sessionId) {
        try {
          const sessionRecords = await db
            .select()
            .from(sessions)
            .where(eq(sessions.id, payload.sessionId))
            .limit(1);

          if (sessionRecords.length === 0) {
            databaseLogger.warn("Session not found during JWT verification", {
              operation: "jwt_verify_session_not_found",
              sessionId: payload.sessionId,
              userId: payload.userId,
            });
            return null;
          }
        } catch (dbError) {
          databaseLogger.error(
            "Failed to check session in database during JWT verification",
            dbError,
            {
              operation: "jwt_verify_session_check_failed",
              sessionId: payload.sessionId,
            },
          );
          return null;
        }
      }
      return payload;
    } catch (error) {
      databaseLogger.warn("JWT verification failed", {
        operation: "jwt_verify_failed",
        error: error instanceof Error ? error.message : "Unknown error",
        errorName: error instanceof Error ? error.name : "Unknown",
      });
      return null;
    }
  }

  invalidateJWTToken(token: string): void {}

  invalidateUserTokens(userId: string): void {}

  async revokeSession(sessionId: string): Promise<boolean> {
    try {
      authLogger.info("User session invalidated", {
        operation: "user_logout",
        sessionId,
      });

      await db.delete(sessions).where(eq(sessions.id, sessionId));

      try {
        const { saveMemoryDatabaseToFile } =
          await import("../database/db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        databaseLogger.error(
          "Failed to save database after session revocation",
          saveError,
          {
            operation: "session_revoke_db_save_failed",
            sessionId,
          },
        );
      }

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
      const userSessions = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId));

      const deletedCount = userSessions.filter(
        (s) => !exceptSessionId || s.id !== exceptSessionId,
      ).length;

      authLogger.info("All user sessions invalidated", {
        operation: "user_logout_all",
        userId,
        sessionCount: deletedCount,
      });

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

      try {
        const { saveMemoryDatabaseToFile } =
          await import("../database/db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        databaseLogger.error(
          "Failed to save database after revoking all user sessions",
          saveError,
          {
            operation: "user_sessions_revoke_db_save_failed",
            userId,
          },
        );
      }

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
      const expiredSessions = await db
        .select()
        .from(sessions)
        .where(sql`${sessions.expiresAt} < datetime('now')`);

      const expiredCount = expiredSessions.length;

      if (expiredCount === 0) {
        return 0;
      }

      await db
        .delete(sessions)
        .where(sql`${sessions.expiresAt} < datetime('now')`);

      try {
        const { saveMemoryDatabaseToFile } =
          await import("../database/db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        databaseLogger.error(
          "Failed to save database after cleaning up expired sessions",
          saveError,
          {
            operation: "sessions_cleanup_db_save_failed",
          },
        );
      }

      const affectedUsers = new Set(expiredSessions.map((s) => s.userId));
      for (const userId of affectedUsers) {
        const remainingSessions = await db
          .select()
          .from(sessions)
          .where(eq(sessions.userId, userId));

        if (remainingSessions.length === 0) {
          this.userCrypto.logoutUser(userId);
        }
      }

      return expiredCount;
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

  getClearCookieOptions(req: RequestWithHeaders) {
    return {
      httpOnly: false,
      secure: req.secure || req.headers["x-forwarded-proto"] === "https",
      sameSite: "strict" as const,
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

      if (payload.sessionId) {
        try {
          const sessionRecords = await db
            .select()
            .from(sessions)
            .where(eq(sessions.id, payload.sessionId))
            .limit(1);

          if (sessionRecords.length === 0) {
            databaseLogger.warn("Session not found in middleware", {
              operation: "middleware_session_not_found",
              sessionId: payload.sessionId,
              userId: payload.userId,
            });
            return res.status(401).json({
              error: "Session not found",
              code: "SESSION_NOT_FOUND",
            });
          }

          const session = sessionRecords[0];

          const sessionExpiryTime = new Date(session.expiresAt).getTime();
          const currentTime = Date.now();
          const isExpired = sessionExpiryTime < currentTime;

          if (isExpired) {
            databaseLogger.warn("Session has expired", {
              operation: "session_expired",
              sessionId: payload.sessionId,
              expiresAt: session.expiresAt,
              expiryTime: sessionExpiryTime,
              currentTime: currentTime,
              difference: currentTime - sessionExpiryTime,
            });

            db.delete(sessions)
              .where(eq(sessions.id, payload.sessionId))
              .then(async () => {
                try {
                  const { saveMemoryDatabaseToFile } =
                    await import("../database/db/index.js");
                  await saveMemoryDatabaseToFile();

                  const remainingSessions = await db
                    .select()
                    .from(sessions)
                    .where(eq(sessions.userId, payload.userId));

                  if (remainingSessions.length === 0) {
                    this.userCrypto.logoutUser(payload.userId);
                  }
                } catch (cleanupError) {
                  databaseLogger.error(
                    "Failed to cleanup after expired session",
                    cleanupError,
                    {
                      operation: "expired_session_cleanup_failed",
                      sessionId: payload.sessionId,
                    },
                  );
                }
              })
              .catch((error) => {
                databaseLogger.error(
                  "Failed to delete expired session",
                  error,
                  {
                    operation: "expired_session_delete_failed",
                    sessionId: payload.sessionId,
                  },
                );
              });

            return res.status(401).json({
              error: "Session has expired",
              code: "SESSION_EXPIRED",
            });
          }

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
          databaseLogger.error("Session check failed in middleware", error, {
            operation: "middleware_session_check_failed",
            sessionId: payload.sessionId,
          });
          return res.status(500).json({ error: "Session check failed" });
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
      authReq.dataKey = dataKey || undefined;
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

  async logoutUser(userId: string, sessionId?: string): Promise<void> {
    if (sessionId) {
      try {
        await db.delete(sessions).where(eq(sessions.id, sessionId));

        try {
          const { saveMemoryDatabaseToFile } =
            await import("../database/db/index.js");
          await saveMemoryDatabaseToFile();
        } catch (saveError) {
          databaseLogger.error(
            "Failed to save database after logout",
            saveError,
            {
              operation: "logout_db_save_failed",
              userId,
              sessionId,
            },
          );
        }

        const remainingSessions = await db
          .select()
          .from(sessions)
          .where(eq(sessions.userId, userId));

        if (remainingSessions.length === 0) {
          this.userCrypto.logoutUser(userId);
        } else {
        }
      } catch (error) {
        databaseLogger.error("Failed to delete session on logout", error, {
          operation: "session_delete_logout_failed",
          userId,
          sessionId,
        });
      }
    } else {
      this.userCrypto.logoutUser(userId);
    }
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
