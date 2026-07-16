import jwt from "jsonwebtoken";
import crypto from "crypto";
import { UserKeyManager } from "./user-keys.js";
import {
  adoptRecoveredDEK,
  migratePasswordUserAtLogin,
} from "./crypto-migration/dek-migration.js";
import { SystemCrypto } from "./system-crypto.js";
import { DataCrypto } from "./data-crypto.js";
import { databaseLogger, authLogger } from "./logger.js";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { and, eq, inArray } from "drizzle-orm";
import type { DeviceType } from "./user-agent-parser.js";
import { getDb } from "../database/db/index.js";
import { sessions } from "../database/db/schema.js";
import {
  createCurrentSettingsRepository,
  createCurrentSessionRepository,
  createCurrentUserRepository,
  createCurrentApiKeyRepository,
  createCurrentTrustedDeviceRepository,
  getCurrentSettingValue,
} from "../database/repositories/factory.js";

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
  apiKeyId?: string;
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
  private userKeys: UserKeyManager;

  private constructor() {
    this.systemCrypto = SystemCrypto.getInstance();
    this.userKeys = UserKeyManager.getInstance();

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

  async registerUser(userId: string, _password?: string): Promise<void> {
    if (!this.userKeys.hasUserDEK(userId)) {
      await this.userKeys.createUserDEK(userId);
    }
  }

  async registerOIDCUser(
    userId: string,
    _sessionDurationMs?: number,
  ): Promise<void> {
    if (!this.userKeys.hasUserDEK(userId)) {
      await this.userKeys.createUserDEK(userId);
    }
  }

  private async ensureUserDEK(userId: string): Promise<boolean> {
    if (this.userKeys.tryGetUserDEK(userId)) {
      await this.performLazyEncryptionMigration(userId);
      return true;
    }
    return false;
  }

  async authenticateOIDCUser(
    userId: string,
    _deviceType?: DeviceType,
  ): Promise<boolean> {
    if (!this.userKeys.hasUserDEK(userId)) {
      await this.userKeys.createUserDEK(userId);
    }
    return this.ensureUserDEK(userId);
  }

  async authenticateUser(
    userId: string,
    password: string,
    _deviceType?: DeviceType,
  ): Promise<boolean> {
    // Password-wrapped legacy DEKs can only be recovered while the password
    // is in hand, so login is where those users migrate to the v3 wrap.
    const migrated = await migratePasswordUserAtLogin(userId, password);

    if (!migrated && !this.userKeys.hasUserDEK(userId)) {
      const raw = getCurrentSettingValue(`user_encrypted_dek_${userId}`);
      if (raw) {
        // A legacy wrap exists but the password could not unwrap it.
        return false;
      }
      await this.userKeys.createUserDEK(userId);
    }

    return this.ensureUserDEK(userId);
  }

  async authenticateWebAuthnUser(
    userId: string,
    _deviceType?: DeviceType,
  ): Promise<boolean> {
    return this.ensureUserDEK(userId);
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

      await DataCrypto.migrateCurrentUserSensitiveFields(userId, userDataKey);
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

  // Upgrade shim, remove in the release after 2.5: tokens issued before the
  // v3 key wrap carried the user's DEK wrapped with the system ENCRYPTION_KEY.
  // Adopting it here silently migrates password users with live sessions.
  private async migrateDataKeyFromPayload(payload: JWTPayload): Promise<void> {
    if (!payload.dataKeyWrap || this.userKeys.hasUserDEK(payload.userId)) {
      return;
    }

    try {
      const dataKey = await this.unwrapUserDataKey(
        payload.userId,
        payload.sessionId,
        payload.dataKeyWrap,
      );
      await adoptRecoveredDEK(payload.userId, dataKey);
    } catch (error) {
      databaseLogger.warn("Failed to migrate data key from session token", {
        operation: "session_data_key_migrate_failed",
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
      oidcSub?: string | null;
      oidcSid?: string | null;
      ssoProviderId?: number | null;
    } = {},
  ): Promise<string> {
    const jwtSecret = await this.systemCrypto.getJWTSecret();

    const timeoutValue = await createCurrentSettingsRepository().get(
      "session_timeout_hours",
    );
    const defaultExpiry = `${timeoutValue ? parseInt(timeoutValue, 10) || 24 : 24}h`;

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

      const token = jwt.sign(payload, jwtSecret, {
        expiresIn,
      } as jwt.SignOptions);

      const expirationMs = this.parseExpiresIn(expiresIn);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + expirationMs).toISOString();
      const createdAt = now.toISOString();

      try {
        await createCurrentSessionRepository().create({
          id: sessionId,
          userId,
          jwtToken: token,
          deviceType: options.deviceType,
          deviceInfo: options.deviceInfo,
          oidcSub: options.oidcSub ?? null,
          oidcSid: options.oidcSid ?? null,
          ssoProviderId: options.ssoProviderId ?? null,
          createdAt,
          expiresAt,
          lastActiveAt: createdAt,
        });
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
          const sessionRecord = await createCurrentSessionRepository().findById(
            payload.sessionId,
          );

          if (!sessionRecord) {
            databaseLogger.warn("Session not found during JWT verification", {
              operation: "jwt_verify_session_not_found",
              sessionId: payload.sessionId,
              userId: payload.userId,
            });
            return null;
          }

          await this.migrateDataKeyFromPayload(payload);
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
        await this.migrateDataKeyFromPayload(payload);
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
    const sessionRecord =
      await createCurrentSessionRepository().findById(sessionId);

    if (!sessionRecord || sessionRecord.userId !== userId) {
      return null;
    }

    const expiresAt = new Date(sessionRecord.expiresAt).getTime();
    const maxAge = expiresAt - Date.now();
    if (!Number.isFinite(maxAge) || maxAge <= 0) {
      return null;
    }

    const payload: JWTPayload = { userId, sessionId };

    const token = jwt.sign(payload, await this.systemCrypto.getJWTSecret(), {
      expiresIn: Math.ceil(maxAge / 1000),
    } as jwt.SignOptions);

    await createCurrentSessionRepository().updateToken(sessionId, token);

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

      await createCurrentSessionRepository().revoke(sessionId);

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
      const sessionRepository = createCurrentSessionRepository();
      const userSessions = await sessionRepository.listByUserId(userId);

      const deletedCount = userSessions.filter(
        (s) => !exceptSessionId || s.id !== exceptSessionId,
      ).length;

      authLogger.info("All user sessions invalidated", {
        operation: "user_logout_all",
        userId,
        sessionCount: deletedCount,
      });

      await sessionRepository.revokeAllForUser(userId, exceptSessionId);

      return deletedCount;
    } catch (error) {
      databaseLogger.error("Failed to delete user sessions", error, {
        operation: "user_sessions_delete_failed",
        userId,
      });
      return 0;
    }
  }

  async revokeSessionsByOidc(params: {
    ssoProviderId?: number | null;
    sub?: string | null;
    sid?: string | null;
  }): Promise<number> {
    const { ssoProviderId, sub, sid } = params;
    if (!sub && !sid) return 0;

    try {
      const conditions = [
        sid ? eq(sessions.oidcSid, sid) : eq(sessions.oidcSub, sub!),
      ];
      if (ssoProviderId != null)
        conditions.push(eq(sessions.ssoProviderId, ssoProviderId));

      const db = getDb();
      const matched = await db
        .select()
        .from(sessions)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions));

      if (matched.length === 0) return 0;

      const matchedIds = matched.map((s) => s.id);
      const affectedUsers = new Set(matched.map((s) => s.userId));

      await db.delete(sessions).where(inArray(sessions.id, matchedIds));

      authLogger.info("Sessions revoked via OIDC back-channel logout", {
        operation: "oidc_backchannel_logout",
        ssoProviderId,
        sessionCount: matchedIds.length,
      });

      const { saveMemoryDatabaseToFile } =
        await import("../database/db/index.js");
      await saveMemoryDatabaseToFile();

      return matchedIds.length;
    } catch (error) {
      databaseLogger.error("Failed to revoke sessions via OIDC", error, {
        operation: "oidc_backchannel_logout_failed",
      });
      throw error;
    }
  }

  async cleanupExpiredSessions(): Promise<number> {
    try {
      const sessionRepository = createCurrentSessionRepository();
      const now = new Date();
      const expiredSessions = await sessionRepository.listExpired(now);

      const expiredCount = expiredSessions.length;

      if (expiredCount === 0) {
        return 0;
      }

      await sessionRepository.deleteExpired(now);

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
      return createCurrentSessionRepository().listAll();
    } catch (error) {
      databaseLogger.error("Failed to get all sessions", error, {
        operation: "sessions_get_all_failed",
      });
      return [];
    }
  }

  async getUserSessions(userId: string): Promise<Record<string, unknown>[]> {
    try {
      return createCurrentSessionRepository().listByUserId(userId);
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
      const apiKeyRepository = createCurrentApiKeyRepository();

      const candidates =
        await apiKeyRepository.listActiveByTokenPrefix(tokenPrefix);

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
        const user = await createCurrentUserRepository().findById(
          matchedKey.userId,
        );
        if (!user?.isAdmin) {
          res.status(403).json({ error: "Admin access required" });
          return;
        }
      }

      apiKeyRepository
        .updateLastUsedAt(matchedKey.id, new Date().toISOString())
        .then(() => {})
        .catch((err) => {
          databaseLogger.warn("Failed to update API key lastUsedAt", {
            operation: "api_key_update_last_used",
            keyId: matchedKey!.id,
            error: err instanceof Error ? err.message : "Unknown",
          });
        });

      req.userId = matchedKey.userId;
      req.apiKeyId = matchedKey.id;
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
          const sessionRepository = createCurrentSessionRepository();
          const session = await sessionRepository.findById(payload.sessionId);

          if (!session) {
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

            sessionRepository.revoke(payload.sessionId).catch((error) => {
              databaseLogger.error("Failed to delete expired session", error, {
                operation: "expired_session_delete_failed",
                sessionId: payload.sessionId,
              });
            });

            return res
              .clearCookie("jwt", this.getClearCookieOptions(req))
              .status(401)
              .json({
                error: "Session has expired",
                code: "SESSION_EXPIRED",
              });
          }

          sessionRepository
            .touch(payload.sessionId)
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

      authReq.dataKey = this.userKeys.tryGetUserDEK(userId) ?? undefined;
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
        const user = await createCurrentUserRepository().findById(
          payload.userId,
        );

        if (!user?.isAdmin) {
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
    const sessionRepository = createCurrentSessionRepository();

    try {
      if (sessionId) {
        await sessionRepository.revoke(sessionId);
      } else {
        await sessionRepository.revokeAllForUser(userId);
      }
    } catch (error) {
      databaseLogger.error("Failed to revoke sessions on logout", error, {
        operation: "session_delete_logout_failed",
        userId,
        sessionId,
      });
    }
  }

  getUserDataKey(userId: string): Buffer | null {
    return this.userKeys.tryGetUserDEK(userId);
  }

  isUserUnlocked(userId: string): boolean {
    return this.userKeys.tryGetUserDEK(userId) !== null;
  }

  async changeUserPassword(
    userId: string,
    oldPassword: string,
    _newPassword?: string,
  ): Promise<boolean> {
    // The DEK is no longer derived from the password; the old password is
    // only needed when the user still has a legacy password-wrapped key.
    await migratePasswordUserAtLogin(userId, oldPassword);
    return this.userKeys.tryGetUserDEK(userId) !== null;
  }

  async resetUserPasswordWithPreservedDEK(
    userId: string,
    _newPassword?: string,
  ): Promise<boolean> {
    return this.userKeys.tryGetUserDEK(userId) !== null;
  }

  async isTrustedDevice(
    userId: string,
    deviceFingerprint: string,
  ): Promise<boolean> {
    try {
      const trustedDeviceRepository = createCurrentTrustedDeviceRepository();
      const device = await trustedDeviceRepository.findByUserAndFingerprint(
        userId,
        deviceFingerprint,
      );

      if (!device) {
        return false;
      }

      const now = new Date();
      const expiresAt = new Date(device.expiresAt);

      if (now > expiresAt) {
        await this.removeTrustedDevice(userId, deviceFingerprint);
        return false;
      }

      await trustedDeviceRepository.touch(
        userId,
        deviceFingerprint,
        now.toISOString(),
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

    await createCurrentTrustedDeviceRepository().upsert({
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

  async removeTrustedDevice(
    userId: string,
    deviceFingerprint: string,
  ): Promise<void> {
    await createCurrentTrustedDeviceRepository().deleteByUserAndFingerprint(
      userId,
      deviceFingerprint,
    );
  }
}

export { AuthManager, type AuthenticationResult, type JWTPayload };
