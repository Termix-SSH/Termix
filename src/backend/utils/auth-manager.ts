import jwt from "jsonwebtoken";
import { UserCrypto } from "./user-crypto.js";
import { SystemCrypto } from "./system-crypto.js";
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
   * User login - use UserCrypto
   */
  async authenticateUser(userId: string, password: string): Promise<boolean> {
    return await this.userCrypto.authenticateUser(userId, password);
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
      return jwt.verify(token, jwtSecret) as JWTPayload;
    } catch (error) {
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