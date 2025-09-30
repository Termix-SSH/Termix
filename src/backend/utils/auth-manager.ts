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
      } else {
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
    options: { expiresIn?: string; pendingTOTP?: boolean } = {},
  ): Promise<string> {
    const jwtSecret = await this.systemCrypto.getJWTSecret();

    const payload: JWTPayload = { userId };
    if (options.pendingTOTP) {
      payload.pendingTOTP = true;
    }

    return jwt.sign(payload, jwtSecret, {
      expiresIn: options.expiresIn || "24h",
    } as jwt.SignOptions);
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

  getSecureCookieOptions(req: any, maxAge: number = 24 * 60 * 60 * 1000) {
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

      (req as any).userId = payload.userId;
      (req as any).pendingTOTP = payload.pendingTOTP;
      next();
    };
  }

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
          code: "SESSION_EXPIRED",
        });
      }

      (req as any).dataKey = dataKey;
      next();
    };
  }

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

        (req as any).userId = payload.userId;
        (req as any).pendingTOTP = payload.pendingTOTP;
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
}

export { AuthManager, type AuthenticationResult, type JWTPayload };
