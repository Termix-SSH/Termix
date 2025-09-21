import jwt from "jsonwebtoken";
import { SystemKeyManager } from "./system-key-manager.js";
import { UserKeyManager } from "./user-key-manager.js";
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

interface RequestContext {
  userId: string;
  dataKey: Buffer | null;
  isUnlocked: boolean;
}

interface JWTPayload {
  userId: string;
  pendingTOTP?: boolean;
  iat?: number;
  exp?: number;
}

/**
 * SecuritySession - Unified security session management
 *
 * Responsibilities:
 * - Coordinate system key and user key management
 * - Provide unified authentication and authorization interface
 * - Manage JWT generation and verification
 * - Handle security middleware
 */
class SecuritySession {
  private static instance: SecuritySession;
  private systemKeyManager: SystemKeyManager;
  private userKeyManager: UserKeyManager;
  private initialized: boolean = false;

  private constructor() {
    this.systemKeyManager = SystemKeyManager.getInstance();
    this.userKeyManager = UserKeyManager.getInstance();
  }

  static getInstance(): SecuritySession {
    if (!this.instance) {
      this.instance = new SecuritySession();
    }
    return this.instance;
  }

  /**
   * Initialize security system
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      databaseLogger.info("Initializing security session system", {
        operation: "security_init",
      });

      // Initialize system keys (JWT etc.)
      await this.systemKeyManager.initializeJWTSecret();

      this.initialized = true;

      databaseLogger.success("Security session system initialized successfully", {
        operation: "security_init_complete",
      });
    } catch (error) {
      databaseLogger.error("Failed to initialize security system", error, {
        operation: "security_init_failed",
      });
      throw error;
    }
  }

  /**
   * User registration - set up user encryption
   */
  async registerUser(userId: string, password: string): Promise<void> {
    await this.userKeyManager.setupUserEncryption(userId, password);
  }

  /**
   * User authentication (login)
   */
  async authenticateUser(username: string, password: string): Promise<AuthenticationResult> {
    try {
      databaseLogger.info("User authentication attempt", {
        operation: "user_auth",
        username,
      });

      // Need to get user info from database (will be implemented when refactoring users.ts)
      // Return basic structure for now
      return {
        success: false,
        error: "Authentication implementation pending refactor",
      };
    } catch (error) {
      databaseLogger.error("Authentication failed", error, {
        operation: "user_auth_failed",
        username,
      });

      return {
        success: false,
        error: "Authentication failed",
      };
    }
  }

  /**
   * Generate JWT token
   */
  async generateJWTToken(
    userId: string,
    options: {
      expiresIn?: string;
      pendingTOTP?: boolean;
    } = {}
  ): Promise<string> {
    const jwtSecret = await this.systemKeyManager.getJWTSecret();

    const payload: JWTPayload = {
      userId,
    };

    if (options.pendingTOTP) {
      payload.pendingTOTP = true;
    }

    const token = jwt.sign(
      payload,
      jwtSecret,
      {
        expiresIn: options.expiresIn || "24h",
      } as jwt.SignOptions
    );

    databaseLogger.info("JWT token generated", {
      operation: "jwt_generated",
      userId,
      pendingTOTP: !!options.pendingTOTP,
      expiresIn: options.expiresIn || "24h",
    });

    return token;
  }

  /**
   * Verify JWT token
   */
  async verifyJWTToken(token: string): Promise<JWTPayload | null> {
    try {
      const jwtSecret = await this.systemKeyManager.getJWTSecret();
      const payload = jwt.verify(token, jwtSecret) as JWTPayload;

      databaseLogger.debug("JWT token verified", {
        operation: "jwt_verified",
        userId: payload.userId,
        pendingTOTP: !!payload.pendingTOTP,
      });

      return payload;
    } catch (error) {
      databaseLogger.warn("JWT token verification failed", {
        operation: "jwt_verify_failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }

  /**
   * Create authentication middleware
   */
  createAuthMiddleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const authHeader = req.headers["authorization"];
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        databaseLogger.warn("Missing or invalid Authorization header", {
          operation: "auth_middleware",
          method: req.method,
          url: req.url,
        });
        return res.status(401).json({
          error: "Missing or invalid Authorization header"
        });
      }

      const token = authHeader.split(" ")[1];

      try {
        const payload = await this.verifyJWTToken(token);
        if (!payload) {
          return res.status(401).json({ error: "Invalid or expired token" });
        }

        // Add user information to request object
        (req as any).userId = payload.userId;
        (req as any).pendingTOTP = payload.pendingTOTP;

        next();
      } catch (error) {
        databaseLogger.warn("Authentication middleware failed", {
          operation: "auth_middleware_failed",
          method: req.method,
          url: req.url,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        return res.status(401).json({ error: "Authentication failed" });
      }
    };
  }

  /**
   * Create data access middleware (requires unlocked data keys)
   */
  createDataAccessMiddleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      const userId = (req as any).userId;
      if (!userId) {
        return res.status(401).json({
          error: "Authentication required"
        });
      }

      const dataKey = this.userKeyManager.getUserDataKey(userId);
      if (!dataKey) {
        databaseLogger.warn("Data access denied - user not unlocked", {
          operation: "data_access_denied",
          userId,
          method: req.method,
          url: req.url,
        });
        return res.status(423).json({
          error: "Data access locked - please re-authenticate with password",
          code: "DATA_LOCKED"
        });
      }

      // Add data key to request context
      (req as any).dataKey = dataKey;
      (req as any).isUnlocked = true;

      next();
    };
  }

  /**
   * User unlock data (after entering password)
   */
  async unlockUserData(userId: string, password: string): Promise<boolean> {
    return await this.userKeyManager.authenticateAndUnlockUser(userId, password);
  }

  /**
   * User logout
   */
  logoutUser(userId: string): void {
    this.userKeyManager.logoutUser(userId);

    databaseLogger.info("User logged out", {
      operation: "user_logout",
      userId,
    });
  }

  /**
   * Check if user has unlocked data
   */
  isUserDataUnlocked(userId: string): boolean {
    return this.userKeyManager.isUserUnlocked(userId);
  }

  /**
   * Get user data key (for data encryption operations)
   */
  getUserDataKey(userId: string): Buffer | null {
    return this.userKeyManager.getUserDataKey(userId);
  }

  /**
   * Change user password
   */
  async changeUserPassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<boolean> {
    return await this.userKeyManager.changeUserPassword(userId, oldPassword, newPassword);
  }

  /**
   * Get request context (for data operations)
   */
  getRequestContext(req: Request): RequestContext {
    const userId = (req as any).userId;
    const dataKey = (req as any).dataKey || null;
    const isUnlocked = !!dataKey;

    return {
      userId,
      dataKey,
      isUnlocked,
    };
  }

  /**
   * Regenerate JWT key (admin operation)
   */
  async regenerateJWTSecret(): Promise<string> {
    return await this.systemKeyManager.regenerateJWTSecret();
  }

  /**
   * Get security status
   */
  async getSecurityStatus() {
    const systemStatus = await this.systemKeyManager.getSystemKeyStatus();
    const activeSessions = this.userKeyManager.getAllActiveSessions();

    return {
      initialized: this.initialized,
      system: systemStatus,
      activeSessions,
      activeSessionCount: Object.keys(activeSessions).length,
    };
  }

  /**
   * Clear all user sessions (emergency)
   */
  clearAllUserSessions(): void {
    // Get all active sessions and clear them
    const activeSessions = this.userKeyManager.getAllActiveSessions();
    for (const userId of Object.keys(activeSessions)) {
      this.userKeyManager.logoutUser(userId);
    }

    databaseLogger.warn("All user sessions cleared", {
      operation: "emergency_session_clear",
      clearedCount: Object.keys(activeSessions).length,
    });
  }

  /**
   * Validate entire security system
   */
  async validateSecuritySystem(): Promise<boolean> {
    try {
      // Validate JWT system
      const jwtValid = await this.systemKeyManager.validateJWTSecret();
      if (!jwtValid) {
        databaseLogger.error("JWT system validation failed", undefined, {
          operation: "security_validation",
        });
        return false;
      }

      // Can add more validations...

      databaseLogger.success("Security system validation passed", {
        operation: "security_validation_success",
      });

      return true;
    } catch (error) {
      databaseLogger.error("Security system validation failed", error, {
        operation: "security_validation_failed",
      });
      return false;
    }
  }
}

export { SecuritySession, type AuthenticationResult, type RequestContext, type JWTPayload };