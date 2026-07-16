import type { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { AuthManager } from "../../utils/auth-manager.js";
import { authLogger } from "../../utils/logger.js";
import { loginRateLimiter } from "../../utils/login-rate-limiter.js";
import {
  createCurrentCredentialRepository,
  createCurrentDismissedAlertRepository,
  createCurrentFileManagerBookmarkRepository,
  createCurrentHostRepository,
  createCurrentRecentActivityRepository,
  createCurrentSettingsRepository,
  createCurrentSnippetRepository,
  createCurrentSshCredentialUsageRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";

interface UserPasswordResetRoutesDeps {
  authManager: AuthManager;
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

export type PasswordResetOutcome =
  | { status: "reset"; dataWiped: false }
  | { status: "reset"; dataWiped: true }
  | { status: "wipe_confirmation_required" };

// Resets a user's password. The DEK is wrapped by the system key, so for any
// user migrated to the v3 wrap this is just a hash update and their data
// survives. Users who never logged in after the encryption upgrade still have
// a password-wrapped DEK that a reset cannot recover; their encrypted data
// must be wiped, which callers have to confirm explicitly.
export async function resetUserPassword(
  authManager: AuthManager,
  options: {
    userId: string;
    username: string;
    newPassword: string;
    confirmDataWipe: boolean;
  },
): Promise<PasswordResetOutcome> {
  const { userId, username, newPassword, confirmDataWipe } = options;
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const userRepository = createCurrentUserRepository();

  if (authManager.isUserUnlocked(userId)) {
    await userRepository.update(userId, { passwordHash });
    await authManager.logoutUser(userId);

    authLogger.success(
      `Password reset (data preserved) for user: ${username}`,
      {
        operation: "password_reset_preserved",
        userId,
        username,
      },
    );
    return { status: "reset", dataWiped: false };
  }

  if (!confirmDataWipe) {
    return { status: "wipe_confirmation_required" };
  }

  await userRepository.update(userId, { passwordHash });

  await createCurrentSshCredentialUsageRepository().deleteByUserId(userId);
  await createCurrentFileManagerBookmarkRepository().deleteByUserId(userId);
  await createCurrentRecentActivityRepository().deleteByUserId(userId);
  await createCurrentDismissedAlertRepository().deleteByUserId(userId);
  await createCurrentSnippetRepository().deleteByUserId(userId);
  await createCurrentHostRepository().deleteByUserId(userId);
  await createCurrentCredentialRepository().deleteByUserId(userId);

  const { UserKeyManager } = await import("../../utils/user-keys.js");
  await UserKeyManager.getInstance().rotateUserDEK(userId);
  const { deleteLegacyWraps } =
    await import("../../utils/crypto-migration/dek-migration.js");
  await deleteLegacyWraps(userId);
  await authManager.logoutUser(userId);

  await userRepository.update(userId, {
    totpEnabled: false,
    totpSecret: null,
    totpBackupCodes: null,
  });

  authLogger.warn(
    `Password reset completed for user: ${username}. All encrypted data has been deleted because the old key was unrecoverable.`,
    {
      operation: "password_reset_data_deleted",
      userId,
      username,
    },
  );
  return { status: "reset", dataWiped: true };
}

export function registerUserPasswordResetRoutes(
  router: Router,
  { authManager }: UserPasswordResetRoutesDeps,
): void {
  /**
   * @openapi
   * /users/initiate-reset:
   *   post:
   *     summary: Initiate password reset
   *     description: Initiates the password reset process for a user.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               username:
   *                 type: string
   *     responses:
   *       200:
   *         description: Password reset code has been generated.
   *       400:
   *         description: Username is required.
   *       403:
   *         description: Password reset not available for external authentication users.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to initiate password reset.
   */
  router.post("/initiate-reset", async (req, res) => {
    try {
      const envVal = process.env.ALLOW_PASSWORD_RESET;
      const allowed =
        envVal !== undefined
          ? envVal.trim().toLowerCase() === "true"
          : await createCurrentSettingsRepository().getBoolean(
              "allow_password_reset",
              true,
            );
      if (!allowed) {
        return res
          .status(403)
          .json({ error: "Password reset is currently disabled" });
      }
    } catch (e) {
      authLogger.warn("Failed to check password reset status", {
        operation: "password_reset_check",
        error: e,
      });
    }

    const { username } = req.body;

    if (!isNonEmptyString(username)) {
      return res.status(400).json({ error: "Username is required" });
    }

    try {
      const user = await createCurrentUserRepository().findByUsername(username);

      if (!user) {
        authLogger.warn(
          `Password reset attempted for non-existent user: ${username}`,
        );
        return res.json({
          message:
            "If the user exists, a password reset code has been generated. Check docker logs for the code.",
        });
      }

      if (user.isOidc) {
        return res.json({
          message:
            "If the user exists, a password reset code has been generated. Check docker logs for the code.",
        });
      }

      const resetCode = crypto.randomInt(100000, 1000000).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await createCurrentSettingsRepository().set(
        `reset_code_${username}`,
        JSON.stringify({
          code: resetCode,
          expiresAt: expiresAt.toISOString(),
        }),
      );

      authLogger.info(
        `Password reset code generated for user ${username}: ${resetCode} (expires at ${expiresAt.toLocaleString()})`,
      );

      res.json({
        message:
          "Password reset code has been generated and logged. Check docker logs for the code.",
      });
    } catch (err) {
      authLogger.error("Failed to initiate password reset", err);
      res.status(500).json({ error: "Failed to initiate password reset" });
    }
  });

  /**
   * @openapi
   * /users/verify-reset-code:
   *   post:
   *     summary: Verify reset code
   *     description: Verifies the password reset code.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               username:
   *                 type: string
   *               resetCode:
   *                 type: string
   *     responses:
   *       200:
   *         description: Reset code verified.
   *       400:
   *         description: Invalid or expired reset code.
   *       500:
   *         description: Failed to verify reset code.
   */
  router.post("/verify-reset-code", async (req, res) => {
    const { username, resetCode } = req.body;

    if (!isNonEmptyString(username) || !isNonEmptyString(resetCode)) {
      return res
        .status(400)
        .json({ error: "Username and reset code are required" });
    }

    try {
      const lockStatus = loginRateLimiter.isResetCodeLocked(username);
      if (lockStatus.locked) {
        authLogger.warn(
          "Reset code verification blocked due to rate limiting",
          {
            operation: "reset_code_verify_blocked",
            username,
            remainingTime: lockStatus.remainingTime,
          },
        );
        return res.status(429).json({
          error: `Rate limited: Too many verification attempts. Please wait ${lockStatus.remainingTime} seconds before trying again.`,
          remainingTime: lockStatus.remainingTime,
          code: "RESET_CODE_RATE_LIMITED",
        });
      }

      loginRateLimiter.recordResetCodeAttempt(username);

      const resetDataValue = await createCurrentSettingsRepository().get(
        `reset_code_${username}`,
      );
      if (!resetDataValue) {
        authLogger.warn("Reset code verification failed - no code found", {
          operation: "reset_code_verify_failed",
          username,
          remainingAttempts:
            loginRateLimiter.getRemainingResetCodeAttempts(username),
        });
        return res.status(400).json({
          error: "No reset code found for this user",
          remainingAttempts:
            loginRateLimiter.getRemainingResetCodeAttempts(username),
        });
      }

      const resetData = JSON.parse(resetDataValue);
      const now = new Date();
      const expiresAt = new Date(resetData.expiresAt);

      if (now > expiresAt) {
        await createCurrentSettingsRepository().delete(
          `reset_code_${username}`,
        );
        authLogger.warn("Reset code verification failed - code expired", {
          operation: "reset_code_verify_failed",
          username,
          remainingAttempts:
            loginRateLimiter.getRemainingResetCodeAttempts(username),
        });
        return res.status(400).json({
          error: "Reset code has expired",
          remainingAttempts:
            loginRateLimiter.getRemainingResetCodeAttempts(username),
        });
      }

      if (resetData.code !== resetCode) {
        authLogger.warn("Reset code verification failed - invalid code", {
          operation: "reset_code_verify_failed",
          username,
          remainingAttempts:
            loginRateLimiter.getRemainingResetCodeAttempts(username),
        });
        return res.status(400).json({
          error: "Invalid reset code",
          remainingAttempts:
            loginRateLimiter.getRemainingResetCodeAttempts(username),
        });
      }

      loginRateLimiter.resetResetCodeAttempts(username);

      const tempToken = nanoid();
      const tempTokenExpiry = new Date(Date.now() + 10 * 60 * 1000);

      await createCurrentSettingsRepository().set(
        `temp_reset_token_${username}`,
        JSON.stringify({
          token: tempToken,
          expiresAt: tempTokenExpiry.toISOString(),
        }),
      );

      res.json({ message: "Reset code verified", tempToken });
    } catch (err) {
      authLogger.error("Failed to verify reset code", err);
      res.status(500).json({ error: "Failed to verify reset code" });
    }
  });

  /**
   * @openapi
   * /users/complete-reset:
   *   post:
   *     summary: Complete password reset
   *     description: Completes the password reset process with a new password.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               username:
   *                 type: string
   *               tempToken:
   *                 type: string
   *               newPassword:
   *                 type: string
   *     responses:
   *       200:
   *         description: Password has been successfully reset.
   *       400:
   *         description: Invalid or expired temporary token.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to complete password reset.
   */
  router.post("/complete-reset", async (req, res) => {
    const { username, tempToken, newPassword } = req.body;

    if (
      !isNonEmptyString(username) ||
      !isNonEmptyString(tempToken) ||
      !isNonEmptyString(newPassword)
    ) {
      return res.status(400).json({
        error: "Username, temporary token, and new password are required",
      });
    }

    try {
      const tempTokenValue = await createCurrentSettingsRepository().get(
        `temp_reset_token_${username}`,
      );
      if (!tempTokenValue) {
        return res.status(400).json({ error: "No temporary token found" });
      }

      const tempTokenData = JSON.parse(tempTokenValue);
      const now = new Date();
      const expiresAt = new Date(tempTokenData.expiresAt);

      if (now > expiresAt) {
        await createCurrentSettingsRepository().delete(
          `temp_reset_token_${username}`,
        );
        return res.status(400).json({ error: "Temporary token has expired" });
      }

      if (tempTokenData.token !== tempToken) {
        return res.status(400).json({ error: "Invalid temporary token" });
      }

      const user = await createCurrentUserRepository().findByUsername(username);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const userId = user.id;

      const outcome = await resetUserPassword(authManager, {
        userId,
        username,
        newPassword,
        confirmDataWipe: req.body?.confirmDataWipe === true,
      });

      if (outcome.status === "wipe_confirmation_required") {
        return res.status(409).json({
          error:
            "This account has not logged in since the encryption upgrade, so its stored data cannot be recovered without the old password. Resetting will permanently delete its hosts, credentials and snippets.",
          code: "DATA_WIPE_REQUIRED",
        });
      }

      authLogger.success(`Password successfully reset for user: ${username}`);

      const settingsRepository = createCurrentSettingsRepository();
      await settingsRepository.delete(`reset_code_${username}`);
      await settingsRepository.delete(`temp_reset_token_${username}`);

      res.json({
        message: "Password has been successfully reset",
        dataWiped: outcome.dataWiped,
      });
    } catch (err) {
      authLogger.error("Failed to complete password reset", err);
      res.status(500).json({ error: "Failed to complete password reset" });
    }
  });
}
