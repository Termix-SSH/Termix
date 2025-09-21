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
 * AuthManager - 简化的认证管理器
 *
 * 职责：
 * - JWT生成和验证
 * - 认证中间件
 * - 用户登录登出
 *
 * 不再有两层session - 直接使用UserKeyManager
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
   * 初始化认证系统
   */
  async initialize(): Promise<void> {
    await this.systemCrypto.initializeJWTSecret();
    databaseLogger.info("AuthManager initialized", {
      operation: "auth_init"
    });
  }

  /**
   * 用户注册
   */
  async registerUser(userId: string, password: string): Promise<void> {
    await this.userCrypto.setupUserEncryption(userId, password);
  }

  /**
   * 用户登录 - 使用UserCrypto
   */
  async authenticateUser(userId: string, password: string): Promise<boolean> {
    return await this.userCrypto.authenticateUser(userId, password);
  }

  /**
   * 生成JWT Token
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
   * 验证JWT Token
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
   * 认证中间件
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
   * 数据访问中间件 - 要求用户已解锁数据
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
   * 用户登出
   */
  logoutUser(userId: string): void {
    this.userCrypto.logoutUser(userId);
  }

  /**
   * 获取用户数据密钥
   */
  getUserDataKey(userId: string): Buffer | null {
    return this.userCrypto.getUserDataKey(userId);
  }

  /**
   * 检查用户是否已解锁
   */
  isUserUnlocked(userId: string): boolean {
    return this.userCrypto.isUserUnlocked(userId);
  }

  /**
   * 修改用户密码
   */
  async changeUserPassword(userId: string, oldPassword: string, newPassword: string): Promise<boolean> {
    return await this.userCrypto.changeUserPassword(userId, oldPassword, newPassword);
  }
}

export { AuthManager, type AuthenticationResult, type JWTPayload };