import type { AuthenticatedRequest } from "../../../types/index.js";
import type { Request, RequestHandler, Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import QRCode from "qrcode";
import speakeasy from "speakeasy";
import { AuthManager } from "../../utils/auth-manager.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import { FieldCrypto } from "../../utils/field-crypto.js";
import { LazyFieldEncryption } from "../../utils/lazy-field-encryption.js";
import { authLogger } from "../../utils/logger.js";
import { isTrustedProxyAuthEnabled } from "../../utils/trusted-proxy-auth.js";

import { isPasswordLoginSettingOn } from "../../auth/core-auth.js";
import { verifySecondFactorAndRespond } from "../../auth/login-pipeline.js";
import { TOTP_FACTOR_ID } from "../../auth/legacy/totp-factor.js";
import {
  createCurrentUserAuthRepository,
  createCurrentSessionRepository,
  createCurrentTrustedDeviceRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";
import type { UserRecord } from "../repositories/user-repository.js";

type NativeAppRequestChecker = (req: Request) => boolean;

interface UserTotpRoutesDeps {
  authenticateJWT: RequestHandler;
  authManager: AuthManager;
  isNativeAppRequest: NativeAppRequestChecker;
}

const BACKUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Eight characters from a CSPRNG; Math.random is not fit for secrets. */
export function generateBackupCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += BACKUP_CODE_ALPHABET[crypto.randomInt(BACKUP_CODE_ALPHABET.length)];
  }
  return code;
}

export async function verifyTotpReauth(
  userRecord: UserRecord,
  credential: string,
  userDataKey?: Buffer | null,
): Promise<boolean> {
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
      await createCurrentUserRepository().update(userRecord.id, {
        totpBackupCodes: storedValue,
      });
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
      const userRecord = await createCurrentUserRepository().findById(userId);
      if (!userRecord) {
        return res.status(404).json({ error: "User not found" });
      }

      if (userRecord.totpEnabled) {
        const credential = req.body?.credential;
        if (!credential) {
          return res.status(400).json({
            error: "A TOTP code or password is required",
          });
        }

        const userDataKey = authManager.getUserDataKey(userId);
        let verified = await verifyTotpReauth(
          userRecord,
          credential,
          userDataKey,
        );
        if (!verified && !userRecord.isOidc && userRecord.passwordHash) {
          verified = await bcrypt.compare(credential, userRecord.passwordHash);
        }
        if (!verified) {
          return res.status(401).json({
            error: "Incorrect password or invalid TOTP code",
          });
        }

        const existingSecret = userDataKey
          ? LazyFieldEncryption.safeGetFieldValue(
              userRecord.totpSecret,
              userDataKey,
              userId,
              "totpSecret",
            )
          : userRecord.totpSecret;
        if (!existingSecret) {
          return res.status(409).json({ error: "TOTP secret is unavailable" });
        }

        const otpauthUrl = speakeasy.otpauthURL({
          secret: existingSecret,
          label: `Termix (${userRecord.username})`,
          encoding: "base32",
        });
        authLogger.info("Additional TOTP authenticator enrollment started", {
          operation: "totp_add_authenticator",
          userId,
        });
        return res.json({
          secret: existingSecret,
          qr_code: await QRCode.toDataURL(otpauthUrl),
          additional: true,
        });
      }

      const secret = speakeasy.generateSecret({
        name: `Termix (${userRecord.username})`,
        length: 32,
      });

      await createCurrentUserRepository().update(userId, {
        totpSecret: secret.base32,
      });

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
    if (isTrustedProxyAuthEnabled()) {
      return res.status(409).json({
        error: "TOTP is disabled while trusted proxy authentication is enabled",
      });
    }
    const userId = (req as AuthenticatedRequest).userId;
    const sessionId = (req as AuthenticatedRequest).sessionId;
    const { totp_code } = req.body;

    if (!totp_code) {
      return res.status(400).json({ error: "TOTP code is required" });
    }

    try {
      const passwordLoginAllowed = isPasswordLoginSettingOn();
      if (!passwordLoginAllowed) {
        return res.status(409).json({
          error:
            "Cannot enable 2FA while password login is disabled. Enable password login first.",
        });
      }

      const userRecord = await createCurrentUserRepository().findById(userId);
      if (!userRecord) {
        return res.status(404).json({ error: "User not found" });
      }

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

      const backupCodes = Array.from({ length: 8 }, () => generateBackupCode());

      const backupCodesJson = JSON.stringify(backupCodes);
      const storedBackupCodes = userDataKey
        ? FieldCrypto.encryptField(
            backupCodesJson,
            userDataKey,
            userId,
            "totpBackupCodes",
          )
        : backupCodesJson;

      await createCurrentUserRepository().update(userId, {
        totpEnabled: true,
        totpBackupCodes: storedBackupCodes,
      });
      await createCurrentUserAuthRepository().recordSecondFactor(
        userId,
        "core",
        TOTP_FACTOR_ID,
      );

      await createCurrentSessionRepository().revokeAllForUser(
        userId,
        sessionId,
      );
      await createCurrentTrustedDeviceRepository().deleteByUserId(userId);

      try {
        await DatabaseSaveTrigger.forceSave("totp_enable_explicit_save");
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
    try {
      const userRecord = await createCurrentUserRepository().findById(userId);
      if (!userRecord) {
        return res.status(404).json({ error: "User not found" });
      }

      // One re-authentication value, whichever kind it is. The dialog offers a
      // single field -- "Enter TOTP code or password" -- so it arrives in
      // whichever of the two body fields the caller happened to use.
      const credential = totp_code || password;
      if (!credential) {
        return res.status(400).json({
          error: userRecord.isOidc
            ? "A TOTP code is required"
            : "A TOTP code or password is required",
        });
      }

      if (!userRecord.totpEnabled) {
        return res.status(400).json({ error: "TOTP is not enabled" });
      }

      const userDataKey = authManager.getUserDataKey(userId);
      // TOTP code or backup code first; verifyTotpReauth deliberately refuses
      // the account password, so that stays a separate comparison here.
      let verified = await verifyTotpReauth(
        userRecord,
        credential,
        userDataKey,
      );

      if (!verified && !userRecord.isOidc && userRecord.passwordHash) {
        verified = await bcrypt.compare(credential, userRecord.passwordHash);
      }

      if (!verified) {
        return res
          .status(401)
          .json({ error: "Incorrect password or invalid TOTP code" });
      }

      await createCurrentUserRepository().update(userId, {
        totpEnabled: false,
        totpSecret: null,
        totpBackupCodes: null,
      });
      await createCurrentUserAuthRepository().removeSecondFactor(
        userId,
        "core",
        TOTP_FACTOR_ID,
      );
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
    try {
      const userRecord = await createCurrentUserRepository().findById(userId);
      if (!userRecord) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!totp_code || (!userRecord.isOidc && !password)) {
        return res.status(400).json({
          error: userRecord.isOidc
            ? "A TOTP code is required"
            : "Both password and TOTP code are required",
        });
      }

      if (
        !userRecord.isOidc &&
        (!userRecord.passwordHash ||
          !(await bcrypt.compare(password, userRecord.passwordHash)))
      ) {
        return res.status(401).json({ error: "Incorrect password" });
      }

      if (!userRecord.totpEnabled) {
        return res.status(400).json({ error: "TOTP is not enabled" });
      }

      const userDataKey = authManager.getUserDataKey(userId);
      const verified = await verifyTotpReauth(
        userRecord,
        totp_code,
        userDataKey,
      );
      if (!verified) {
        return res
          .status(401)
          .json({ error: "Incorrect password or invalid TOTP code" });
      }

      const backupCodes = Array.from({ length: 8 }, () => generateBackupCode());

      const backupCodesJson = JSON.stringify(backupCodes);
      const storedBackupCodes = userDataKey
        ? FieldCrypto.encryptField(
            backupCodesJson,
            userDataKey,
            userId,
            "totpBackupCodes",
          )
        : backupCodesJson;

      await createCurrentUserRepository().update(userId, {
        totpBackupCodes: storedBackupCodes,
      });

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
    if (!req.body?.temp_token || !req.body?.totp_code) {
      return res
        .status(400)
        .json({ error: "Token and TOTP code are required" });
    }
    try {
      await verifySecondFactorAndRespond(req, res, TOTP_FACTOR_ID);
    } catch (err) {
      authLogger.error("TOTP verification failed", err);
      return res.status(500).json({ error: "TOTP verification failed" });
    }
  });
}
