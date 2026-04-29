import jwt from "jsonwebtoken";
import crypto from "crypto";
import { UserCrypto } from "./user-crypto.js";
import { SystemCrypto } from "./system-crypto.js";
import { DataCrypto } from "./data-crypto.js";
import { databaseLogger, authLogger } from "./logger.js";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { db } from "../database/db/index.js";
import { sessions, trustedDevices, apiKeys } from "../database/db/schema.js";
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
  dataKeyWrap?: WrappedDataKey;
  iat?: number;
  exp?: number;
}

interface WrappedDataKey {
  version: "v1";
  iv: string;
  tag: string;
  data: string;
}

interface AuthenticatedRequest extends Request {
  userId?: string;
  sessionId?: string;
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
        : 24 * 60 * 60 * 1000;

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
        : 24 * 60 * 60 * 1000;

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

  private getDataKeyAAD(userId: string, sessionId?: string): Buffer {
    return Buffer.from(`${userId}:${sessionId || ""}`, "utf8");
  }

  private async wrapUserDataKey(
    userId: string,
    sessionId: string | undefined,
    dataKey: Buffer,
  ): Promise<WrappedDataKey> {
    const encryptionKey = await this.systemCrypto.getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
    cipher.setAAD(this.getDataKeyAAD(userId, sessionId));

    const encrypted = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      version: "v1",
      iv: iv.toString("base64url"),
      tag: tag.toString("base64url"),
      data: encrypted.toString("base64url"),
    };
  }

  private async unwrapUserDataKey(
    userId: string,
    sessionId: string | undefined,
    wrapped: WrappedDataKey,
  ): Promise<Buffer> {
    if (wrapped.version !== "v1") {
      throw new Error(
        `Unsupported wrapped data key version: ${wrapped.version}`,
      );
    }

    const encryptionKey = await this.systemCrypto.getEncryptionKey();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey,
      Buffer.from(wrapped.iv, "base64url"),
    );
    decipher.setAAD(this.getDataKeyAAD(userId, sessionId));
    decipher.setAuthTag(Buffer.from(wrapped.tag, "base64url"));

    return Buffer.concat([
      decipher.update(Buffer.from(wrapped.data, "base64url")),
      decipher.final(),
    ]);
  }

  private async addWrappedDataKey(payload: JWTPayload): Promise<void> {
    if (payload.pendingTOTP) {
      return;
    }

    const dataKey = this.userCrypto.getUserDataKey(payload.userId);
    if (!dataKey) {
      return;
    }

    payload.dataKeyWrap = await this.wrapUserDataKey(
      payload.userId,
      payload.sessionId,
      dataKey,
    );
  }

  private async restoreDataKeyFromPayload(
    payload: JWTPayload,
    sessionExpiresAt?: string,
  ): Promise<void> {
    if (
      !payload.dataKeyWrap ||
      this.userCrypto.getUserDataKey(payload.userId)
    ) {
      return;
    }

    const expiresAt = sessionExpiresAt
      ? new Date(sessionExpiresAt).getTime()
      : payload.exp
        ? payload.exp * 1000
        : Date.now();

    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return;
    }

    try {
      const dataKey = await this.unwrapUserDataKey(
        payload.userId,
        payload.sessionId,
        payload.dataKeyWrap,
      );
      this.userCrypto.restoreUserDataKey(payload.userId, dataKey, expiresAt);
      dataKey.fill(0);
    } catch (error) {
      databaseLogger.warn("Failed to restore data key from session token", {
        operation: "session_data_key_restore_failed",
        userId: payload.userId,
        sessionId: payload.sessionId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async generateJWTToken(
    userId: string,
    options: {
      expiresIn?: string;
      pendingTOTP?: boolean;
      rememberMe?: boolean;
      deviceType?: DeviceType;
      deviceInfo?: string;
    } = {},
  ): Promise<string> {
    const jwtSecret = await this.systemCrypto.getJWTSecret();

    const timeoutRow = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'session_timeout_hours'")
      .get() as { value: string } | undefined;
    const defaultExpiry = `${timeoutRow ? parseInt(timeoutRow.value, 10) || 24 : 24}h`;

    let expiresIn = options.expiresIn;
    if (!expiresIn && !options.pendingTOTP) {
      if (options.rememberMe) {
        expiresIn = "30d";
      } else {
        expiresIn = defaultExpiry;
      }
    } else if (!expiresIn) {
      expiresIn = defaultExpiry;
    }

    const payload: JWTPayload = { userId };
    if (options.pendingTOTP) {
      payload.pendingTOTP = true;
    }

    if (!options.pendingTOTP && options.deviceType && options.deviceInfo) {
      const sessionId = nanoid();
      payload.sessionId = sessionId;
      await this.addWrappedDataKey(payload);

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

    await this.addWrappedDataKey(payload);
    return jwt.sign(payload, jwtSecret, { expiresIn } as jwt.SignOptions);
  }

  private parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return 24 * 60 * 60 * 1000;

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
        return 24 * 60 * 60 * 1000;
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

          await this.restoreDataKeyFromPayload(
            payload,
            sessionRecords[0].expiresAt,
          );
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
      } else {
        await this.restoreDataKeyFromPayload(payload);
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

  async refreshSessionToken(
    userId: string,
    sessionId: string,
  ): Promise<{ token: string; maxAge: number } | null> {
    const sessionRecords = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (sessionRecords.length === 0 || sessionRecords[0].userId !== userId) {
      return null;
    }

    const expiresAt = new Date(sessionRecords[0].expiresAt).getTime();
    const maxAge = expiresAt - Date.now();
    if (!Number.isFinite(maxAge) || maxAge <= 0) {
      return null;
    }

    const payload: JWTPayload = { userId, sessionId };
    await this.addWrappedDataKey(payload);

    const token = jwt.sign(payload, await this.systemCrypto.getJWTSecret(), {
      expiresIn: Math.ceil(maxAge / 1000),
    } as jwt.SignOptions);

    await db
      .update(sessions)
      .set({
        jwtToken: token,
        lastActiveAt: new Date().toISOString(),
      })
      .where(eq(sessions.id, sessionId));

    try {
      const { saveMemoryDatabaseToFile } =
        await import("../database/db/index.js");
      await saveMemoryDatabaseToFile();
    } catch (saveError) {
      databaseLogger.error(
        "Failed to save database after session token refresh",
        saveError,
        {
          operation: "session_token_refresh_db_save_failed",
          sessionId,
        },
      );
    }

    return { token, maxAge };
  }

  invalidateJWTToken(_token: string): void {
    // expected - no-op, JWT tokens are stateless
  }

  invalidateUserTokens(_userId: string): void {
    // expected - no-op, handled by session management
  }

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

  async getAllSessions(): Promise<Record<string, unknown>[]> {
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

  async getUserSessions(userId: string): Promise<Record<string, unknown>[]> {
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
    maxAge: number = 24 * 60 * 60 * 1000,
  ) {
    return {
      httpOnly: true,
      secure: req.secure || req.headers["x-forwarded-proto"] === "https",
      sameSite: "lax" as const,
      maxAge: maxAge,
      path: "/",
    };
  }

  getClearCookieOptions(req: RequestWithHeaders) {
    return {
      httpOnly: true,
      secure: req.secure || req.headers["x-forwarded-proto"] === "https",
      sameSite: "lax" as const,
      path: "/",
    };
  }

  private async handleApiKeyAuth(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
    token: string,
    requireAdmin = false,
  ): Promise<void> {
    try {
      const tokenPrefix = token.substring(0, 12);

      const candidates = await db
        .select()
        .from(apiKeys)
        .where(
          and(eq(apiKeys.tokenPrefix, tokenPrefix), eq(apiKeys.isActive, true)),
        );

      if (candidates.length === 0) {
        res.status(401).json({ error: "Invalid API key" });
        return;
      }

      let matchedKey: (typeof candidates)[0] | null = null;
      for (const candidate of candidates) {
        if (await bcrypt.compare(token, candidate.tokenHash)) {
          matchedKey = candidate;
          break;
        }
      }

      if (!matchedKey) {
        res.status(401).json({ error: "Invalid API key" });
        return;
      }

      if (matchedKey.expiresAt && new Date(matchedKey.expiresAt) < new Date()) {
        res.status(401).json({ error: "API key has expired" });
        return;
      }

      if (requireAdmin) {
        const { users } = await import("../database/db/schema.js");
        const userRows = await db
          .select()
          .from(users)
          .where(eq(users.id, matchedKey.userId))
          .limit(1);
        if (!userRows[0]?.isAdmin) {
          res.status(403).json({ error: "Admin access required" });
          return;
        }
      }

      db.update(apiKeys)
        .set({ lastUsedAt: new Date().toISOString() })
        .where(eq(apiKeys.id, matchedKey.id))
        .then(() => {})
        .catch((err) => {
          databaseLogger.warn("Failed to update API key lastUsedAt", {
            operation: "api_key_update_last_used",
            keyId: matchedKey!.id,
            error: err instanceof Error ? err.message : "Unknown",
          });
        });

      req.userId = matchedKey.userId;
      next();
    } catch (error) {
      databaseLogger.error("API key authentication failed", error, {
        operation: "api_key_auth_failed",
      });
      res.status(500).json({ error: "API key authentication failed" });
    }
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

      if (token.startsWith("tmx_")) {
        return this.handleApiKeyAuth(authReq, res, next, token);
      }

      const payload = await this.verifyJWTToken(token);

      if (!payload) {
        return res
          .clearCookie("jwt", this.getClearCookieOptions(req))
          .status(401)
          .json({ error: "Invalid token" });
      }

      if (payload.pendingTOTP) {
        return res.status(401).json({
          error: "TOTP verification required",
          code: "TOTP_REQUIRED",
        });
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
            return res
              .clearCookie("jwt", this.getClearCookieOptions(req))
              .status(401)
              .json({
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

            return res
              .clearCookie("jwt", this.getClearCookieOptions(req))
              .status(401)
              .json({
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
      authReq.sessionId = payload.sessionId;
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

      if (token.startsWith("tmx_")) {
        return this.handleApiKeyAuth(
          req as AuthenticatedRequest,
          res,
          next,
          token,
          true,
        );
      }

      const payload = await this.verifyJWTToken(token);

      if (!payload) {
        return res
          .clearCookie("jwt", this.getClearCookieOptions(req))
          .status(401)
          .json({ error: "Invalid token" });
      }

      if (payload.pendingTOTP) {
        return res.status(401).json({
          error: "TOTP verification required",
          code: "TOTP_REQUIRED",
        });
      }

      try {
        const { db } = await import("../database/db/index.js");
        const { users } = await import("../database/db/schema.js");
        const { eq } = await import("drizzle-orm");

        const user = await db
          .select()
          .from(users)
          .where(eq(users.id, payload.userId));

        if (!user || user.length === 0 || !user[0].isAdmin) {
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
        authReq.sessionId = payload.sessionId;
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
          // expected - other sessions still active, keep user crypto state
        }
      } catch (error) {
        databaseLogger.error("Failed to delete session on logout", error, {
          operation: "session_delete_logout_failed",
          userId,
          sessionId,
        });
      }
    } else {
      try {
        await db.delete(sessions).where(eq(sessions.userId, userId));

        try {
          const { saveMemoryDatabaseToFile } =
            await import("../database/db/index.js");
          await saveMemoryDatabaseToFile();
        } catch {
          // best effort
        }
      } catch (error) {
        databaseLogger.error("Failed to revoke all sessions on logout", error, {
          operation: "session_revoke_all_failed",
          userId,
        });
      }
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

  async isTrustedDevice(
    userId: string,
    deviceFingerprint: string,
  ): Promise<boolean> {
    try {
      const device = await db
        .select()
        .from(trustedDevices)
        .where(
          and(
            eq(trustedDevices.userId, userId),
            eq(trustedDevices.deviceFingerprint, deviceFingerprint),
          ),
        )
        .limit(1);

      if (!device || device.length === 0) {
        return false;
      }

      const now = new Date();
      const expiresAt = new Date(device[0].expiresAt);

      if (now > expiresAt) {
        await this.removeTrustedDevice(userId, deviceFingerprint);
        return false;
      }

      await db
        .update(trustedDevices)
        .set({ lastUsedAt: now.toISOString() })
        .where(
          and(
            eq(trustedDevices.userId, userId),
            eq(trustedDevices.deviceFingerprint, deviceFingerprint),
          ),
        );

      return true;
    } catch (error) {
      authLogger.error("Failed to check trusted device", { userId, error });
      return false;
    }
  }

  async addTrustedDevice(
    userId: string,
    deviceFingerprint: string,
    deviceType: string,
    deviceInfo: string,
  ): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const existingDevice = await db
      .select()
      .from(trustedDevices)
      .where(
        and(
          eq(trustedDevices.userId, userId),
          eq(trustedDevices.deviceFingerprint, deviceFingerprint),
        ),
      )
      .limit(1);

    if (existingDevice && existingDevice.length > 0) {
      await db
        .update(trustedDevices)
        .set({
          expiresAt: expiresAt.toISOString(),
          lastUsedAt: now.toISOString(),
        })
        .where(
          and(
            eq(trustedDevices.userId, userId),
            eq(trustedDevices.deviceFingerprint, deviceFingerprint),
          ),
        );
    } else {
      await db.insert(trustedDevices).values({
        id: nanoid(),
        userId,
        deviceFingerprint,
        deviceType,
        deviceInfo,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        lastUsedAt: now.toISOString(),
      });
    }
  }

  async removeTrustedDevice(
    userId: string,
    deviceFingerprint: string,
  ): Promise<void> {
    await db
      .delete(trustedDevices)
      .where(
        and(
          eq(trustedDevices.userId, userId),
          eq(trustedDevices.deviceFingerprint, deviceFingerprint),
        ),
      );
  }
}

export { AuthManager, type AuthenticationResult, type JWTPayload };
