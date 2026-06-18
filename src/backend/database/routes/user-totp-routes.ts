import type { AuthenticatedRequest } from "../../../types/index.js";
import type { Request, RequestHandler, Router } from "express";
import { and, eq, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import speakeasy from "speakeasy";
import { AuthManager } from "../../utils/auth-manager.js";
import { FieldCrypto } from "../../utils/field-crypto.js";
import { LazyFieldEncryption } from "../../utils/lazy-field-encryption.js";
import { authLogger } from "../../utils/logger.js";
import { loginRateLimiter } from "../../utils/login-rate-limiter.js";
import {
  generateDeviceFingerprint,
  parseUserAgent,
} from "../../utils/user-agent-parser.js";
import { db } from "../db/index.js";
import { sessions, trustedDevices, users } from "../db/schema.js";

type NativeAppRequestChecker = (req: Request) => boolean;

interface UserTotpRoutesDeps {
  authenticateJWT: RequestHandler;
  authManager: AuthManager;
  isNativeAppRequest: NativeAppRequestChecker;
}

type TotpUserRecord = typeof users.$inferSelect;

export async function verifyTotpReauth(
  userRecord: TotpUserRecord,
  credential: string,
  userDataKey?: Buffer | null,
): Promise<boolean> {
  if (!userRecord.isOidc && userRecord.passwordHash) {
    const passwordMatch = await bcrypt.compare(
      credential,
      userRecord.passwordHash,
    );
    if (passwordMatch) {
      return true;
    }
  }

  if (userRecord.totpSecret) {
    const totpSecret = userDataKey
      ? LazyFieldEncryption.safeGetFieldValue(
          userRecord.totpSecret,
          userDataKey,
          userRecord.id,
          "totpSecret",
        )
      : userRecord.totpSecret;

    if (totpSecret) {
      const totpMatch = speakeasy.totp.verify({
        secret: totpSecret,
        encoding: "base32",
        token: credential,
        window: 2,
      });
      if (totpMatch) {
        return true;
      }
    }
  }

  const rawBackupCodes =
    userDataKey && userRecord.totpBackupCodes
      ? LazyFieldEncryption.safeGetFieldValue(
          userRecord.totpBackupCodes,
          userDataKey,
          userRecord.id,
          "totpBackupCodes",
        )
      : userRecord.totpBackupCodes;

  let backupCodes: unknown = [];
  try {
    backupCodes = rawBackupCodes ? JSON.parse(rawBackupCodes) : [];
  } catch {
    backupCodes = [];
  }
  if (Array.isArray(backupCodes)) {
    const backupIndex = backupCodes.indexOf(credential);
    if (backupIndex !== -1) {
      backupCodes.splice(backupIndex, 1);
      const updatedJson = JSON.stringify(backupCodes);
      const storedValue = userDataKey
        ? FieldCrypto.encryptField(
            updatedJson,
            userDataKey,
            userRecord.id,
            "totpBackupCodes",
          )
        : updatedJson;
      await db
        .update(users)
        .set({ totpBackupCodes: storedValue })
        .where(eq(users.id, userRecord.id));
      return true;
    }
  }

  return false;
}

export function registerUserTotpRoutes(
  router: Router,
  { authenticateJWT, authManager, isNativeAppRequest }: UserTotpRoutesDeps,
): void {
  /**
   * @openapi
   * /users/totp/setup:
   *   post:
   *     summary: Setup TOTP
   *     description: Initiates TOTP setup by generating a secret and QR code.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: TOTP setup initiated with secret and QR code.
   *       400:
   *         description: TOTP is already enabled.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to setup TOTP.
   */
  router.post("/totp/setup", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;

    try {
      const user = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const userRecord = user[0];

      if (userRecord.totpEnabled) {
        return res.status(400).json({ error: "TOTP is already enabled" });
      }

      const secret = speakeasy.generateSecret({
        name: `Termix (${userRecord.username})`,
        length: 32,
      });

      await db
        .update(users)
        .set({ totpSecret: secret.base32 })
        .where(eq(users.id, userId));

      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url || "");

      res.json({
        secret: secret.base32,
        qr_code: qrCodeUrl,
      });
    } catch (err) {
      authLogger.error("Failed to setup TOTP", err);
      res.status(500).json({ error: "Failed to setup TOTP" });
    }
  });

  /**
   * @openapi
   * /users/totp/enable:
   *   post:
   *     summary: Enable TOTP
   *     description: Enables TOTP after verifying the initial code.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               totp_code:
   *                 type: string
   *     responses:
   *       200:
   *         description: TOTP enabled successfully with backup codes.
   *       400:
   *         description: TOTP code is required or TOTP already enabled.
   *       401:
   *         description: Invalid TOTP code.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to enable TOTP.
   */
  router.post("/totp/enable", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const sessionId = (req as AuthenticatedRequest).sessionId;
    const { totp_code } = req.body;

    if (!totp_code) {
      return res.status(400).json({ error: "TOTP code is required" });
    }

    try {
      const passwordLoginRow = db.$client
        .prepare(
          "SELECT value FROM settings WHERE key = 'allow_password_login'",
        )
        .get() as { value: string } | undefined;
      const passwordLoginAllowed = passwordLoginRow
        ? passwordLoginRow.value === "true"
        : true;
      if (!passwordLoginAllowed) {
        return res.status(409).json({
          error:
            "Cannot enable 2FA while password login is disabled. Enable password login first.",
        });
      }

      const user = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const userRecord = user[0];

      if (userRecord.totpEnabled) {
        return res.status(400).json({ error: "TOTP is already enabled" });
      }

      if (!userRecord.totpSecret) {
        return res.status(400).json({ error: "TOTP setup not initiated" });
      }

      const userDataKey = authManager.getUserDataKey(userId);
      const totpSecret = userDataKey
        ? LazyFieldEncryption.safeGetFieldValue(
            userRecord.totpSecret,
            userDataKey,
            userId,
            "totpSecret",
          )
        : userRecord.totpSecret;

      const verified = speakeasy.totp.verify({
        secret: totpSecret,
        encoding: "base32",
        token: totp_code,
        window: 2,
      });

      if (!verified) {
        return res.status(401).json({ error: "Invalid TOTP code" });
      }

      const backupCodes = Array.from({ length: 8 }, () =>
        Math.random().toString(36).substring(2, 10).toUpperCase(),
      );

      const backupCodesJson = JSON.stringify(backupCodes);
      const storedBackupCodes = userDataKey
        ? FieldCrypto.encryptField(
            backupCodesJson,
            userDataKey,
            userId,
            "totpBackupCodes",
          )
        : backupCodesJson;

      await db
        .update(users)
        .set({
          totpEnabled: true,
          totpBackupCodes: storedBackupCodes,
        })
        .where(eq(users.id, userId));

      await db
        .delete(sessions)
        .where(
          sessionId
            ? and(eq(sessions.userId, userId), ne(sessions.id, sessionId))
            : eq(sessions.userId, userId),
        );
      await db.delete(trustedDevices).where(eq(trustedDevices.userId, userId));

      try {
        const { saveMemoryDatabaseToFile } = await import("../db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        authLogger.error(
          "Failed to persist TOTP enablement to disk",
          saveError,
          {
            operation: "totp_enable_db_save_failed",
            userId,
          },
        );
      }

      res.json({
        message: "TOTP enabled successfully",
        backup_codes: backupCodes,
      });
    } catch (err) {
      authLogger.error("Failed to enable TOTP", err);
      res.status(500).json({ error: "Failed to enable TOTP" });
    }
  });

  /**
   * @openapi
   * /users/totp/disable:
   *   post:
   *     summary: Disable TOTP
   *     description: Disables TOTP for a user.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               password:
   *                 type: string
   *               totp_code:
   *                 type: string
   *     responses:
   *       200:
   *         description: TOTP disabled successfully.
   *       400:
   *         description: Password or TOTP code is required.
   *       401:
   *         description: Incorrect password or invalid TOTP code.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to disable TOTP.
   */
  router.post("/totp/disable", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { password, totp_code } = req.body;
    const credential = password || totp_code;

    if (!credential) {
      return res
        .status(400)
        .json({ error: "A TOTP code or password is required" });
    }

    try {
      const user = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const userRecord = user[0];

      if (!userRecord.totpEnabled) {
        return res.status(400).json({ error: "TOTP is not enabled" });
      }

      const userDataKey = authManager.getUserDataKey(userId);
      const verified = await verifyTotpReauth(
        userRecord,
        credential,
        userDataKey,
      );
      if (!verified) {
        return res
          .status(401)
          .json({ error: "Incorrect password or invalid TOTP code" });
      }

      await db
        .update(users)
        .set({
          totpEnabled: false,
          totpSecret: null,
          totpBackupCodes: null,
        })
        .where(eq(users.id, userId));
      authLogger.info("Two-factor authentication disabled", {
        operation: "totp_disable",
        userId,
      });

      res.json({ message: "TOTP disabled successfully" });
    } catch (err) {
      authLogger.error("Failed to disable TOTP", err);
      res.status(500).json({ error: "Failed to disable TOTP" });
    }
  });

  /**
   * @openapi
   * /users/totp/backup-codes:
   *   post:
   *     summary: Generate new backup codes
   *     description: Generates new TOTP backup codes.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               password:
   *                 type: string
   *               totp_code:
   *                 type: string
   *     responses:
   *       200:
   *         description: New backup codes generated.
   *       400:
   *         description: Password or TOTP code is required.
   *       401:
   *         description: Incorrect password or invalid TOTP code.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to generate backup codes.
   */
  router.post("/totp/backup-codes", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { password, totp_code } = req.body;
    const credential = password || totp_code;

    if (!credential) {
      return res
        .status(400)
        .json({ error: "A TOTP code or password is required" });
    }

    try {
      const user = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const userRecord = user[0];

      if (!userRecord.totpEnabled) {
        return res.status(400).json({ error: "TOTP is not enabled" });
      }

      const userDataKey = authManager.getUserDataKey(userId);
      const verified = await verifyTotpReauth(
        userRecord,
        credential,
        userDataKey,
      );
      if (!verified) {
        return res
          .status(401)
          .json({ error: "Incorrect password or invalid TOTP code" });
      }

      const backupCodes = Array.from({ length: 8 }, () =>
        Math.random().toString(36).substring(2, 10).toUpperCase(),
      );

      const backupCodesJson = JSON.stringify(backupCodes);
      const storedBackupCodes = userDataKey
        ? FieldCrypto.encryptField(
            backupCodesJson,
            userDataKey,
            userId,
            "totpBackupCodes",
          )
        : backupCodesJson;

      await db
        .update(users)
        .set({ totpBackupCodes: storedBackupCodes })
        .where(eq(users.id, userId));

      res.json({ backup_codes: backupCodes });
    } catch (err) {
      authLogger.error("Failed to generate backup codes", err);
      res.status(500).json({ error: "Failed to generate backup codes" });
    }
  });

  /**
   * @openapi
   * /users/totp/verify-login:
   *   post:
   *     summary: Verify TOTP during login
   *     description: Verifies the TOTP code during login.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               temp_token:
   *                 type: string
   *               totp_code:
   *                 type: string
   *     responses:
   *       200:
   *         description: TOTP verification successful.
   *       400:
   *         description: Token and TOTP code are required.
   *       401:
   *         description: Invalid temporary token or TOTP code.
   *       404:
   *         description: User not found.
   *       500:
   *         description: TOTP verification failed.
   */
  router.post("/totp/verify-login", async (req, res) => {
    const { temp_token, totp_code, rememberMe } = req.body;

    if (!temp_token || !totp_code) {
      return res
        .status(400)
        .json({ error: "Token and TOTP code are required" });
    }

    try {
      const decoded = await authManager.verifyJWTToken(temp_token);
      if (!decoded || !decoded.pendingTOTP) {
        return res.status(401).json({ error: "Invalid temporary token" });
      }

      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, decoded.userId));
      if (!user || user.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const userRecord = user[0];

      const lockStatus = loginRateLimiter.isTOTPLocked(userRecord.id);
      if (lockStatus.locked) {
        authLogger.warn("TOTP verification blocked due to rate limiting", {
          operation: "totp_verify_blocked",
          userId: userRecord.id,
          remainingTime: lockStatus.remainingTime,
        });
        return res.status(429).json({
          error: `Rate limited: Too many TOTP verification attempts. Please wait ${lockStatus.remainingTime} seconds before trying again.`,
          remainingTime: lockStatus.remainingTime,
          code: "TOTP_RATE_LIMITED",
        });
      }

      loginRateLimiter.recordFailedTOTPAttempt(userRecord.id);

      if (!userRecord.totpEnabled || !userRecord.totpSecret) {
        return res
          .status(400)
          .json({ error: "TOTP not enabled for this user" });
      }

      const userDataKey = authManager.getUserDataKey(userRecord.id);
      if (!userDataKey) {
        return res.status(401).json({
          error: "Session expired - please log in again",
          code: "SESSION_EXPIRED",
        });
      }

      const totpSecret = LazyFieldEncryption.safeGetFieldValue(
        userRecord.totpSecret,
        userDataKey,
        userRecord.id,
        "totp_secret",
      );

      if (!totpSecret) {
        await db
          .update(users)
          .set({
            totpEnabled: false,
            totpSecret: null,
            totpBackupCodes: null,
          })
          .where(eq(users.id, userRecord.id));

        return res.status(400).json({
          error:
            "TOTP has been disabled due to password reset. Please set up TOTP again.",
        });
      }

      const verified = speakeasy.totp.verify({
        secret: totpSecret,
        encoding: "base32",
        token: totp_code,
        window: 2,
      });

      if (!verified) {
        let backupCodes = [];
        try {
          backupCodes = userRecord.totpBackupCodes
            ? JSON.parse(userRecord.totpBackupCodes)
            : [];
        } catch {
          backupCodes = [];
        }

        if (!Array.isArray(backupCodes)) {
          backupCodes = [];
        }

        const backupIndex = backupCodes.indexOf(totp_code);

        if (backupIndex === -1) {
          authLogger.warn("TOTP verification failed - invalid code", {
            operation: "totp_verify_failed",
            userId: userRecord.id,
            remainingAttempts: loginRateLimiter.getRemainingTOTPAttempts(
              userRecord.id,
            ),
          });
          return res.status(401).json({
            error: "Invalid TOTP code",
            remainingAttempts: loginRateLimiter.getRemainingTOTPAttempts(
              userRecord.id,
            ),
          });
        }

        backupCodes.splice(backupIndex, 1);
        await db
          .update(users)
          .set({ totpBackupCodes: JSON.stringify(backupCodes) })
          .where(eq(users.id, userRecord.id));
      }

      loginRateLimiter.resetTOTPAttempts(userRecord.id);

      const deviceInfo = parseUserAgent(req);

      if (rememberMe) {
        const deviceFingerprint = generateDeviceFingerprint(deviceInfo);
        await authManager.addTrustedDevice(
          userRecord.id,
          deviceFingerprint,
          deviceInfo.type,
          deviceInfo.deviceInfo,
        );
        authLogger.info("Device automatically trusted via Remember Me", {
          operation: "totp_auto_trust",
          userId: userRecord.id,
          deviceType: deviceInfo.type,
        });
      }

      const token = await authManager.generateJWTToken(userRecord.id, {
        rememberMe: !!rememberMe,
        deviceType: deviceInfo.type,
        deviceInfo: deviceInfo.deviceInfo,
      });

      authLogger.success("TOTP verification successful", {
        operation: "totp_verify_success",
        userId: userRecord.id,
        deviceType: deviceInfo.type,
        deviceInfo: deviceInfo.deviceInfo,
      });

      const response: Record<string, unknown> = {
        success: true,
        is_admin: !!userRecord.isAdmin,
        username: userRecord.username,
        userId: userRecord.id,
        is_oidc: !!userRecord.isOidc,
        totp_enabled: !!userRecord.totpEnabled,
        ...(isNativeAppRequest(req) ? { token } : {}),
      };

      const timeoutRow = db.$client
        .prepare(
          "SELECT value FROM settings WHERE key = 'session_timeout_hours'",
        )
        .get() as { value: string } | undefined;
      const timeoutHours = timeoutRow
        ? parseInt(timeoutRow.value, 10) || 24
        : 24;
      const maxAge = rememberMe
        ? 30 * 24 * 60 * 60 * 1000
        : timeoutHours * 60 * 60 * 1000;

      return res
        .cookie("jwt", token, authManager.getSecureCookieOptions(req, maxAge))
        .json(response);
    } catch (err) {
      authLogger.error("TOTP verification failed", err);
      return res.status(500).json({ error: "TOTP verification failed" });
    }
  });
}
