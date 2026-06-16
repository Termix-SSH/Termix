import type { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { AuthManager } from "../../utils/auth-manager.js";
import { authLogger } from "../../utils/logger.js";
import { loginRateLimiter } from "../../utils/login-rate-limiter.js";
import { db } from "../db/index.js";
import {
  users,
  hosts,
  sshCredentials,
  fileManagerRecent,
  fileManagerPinned,
  fileManagerShortcuts,
  dismissedAlerts,
  sshCredentialUsage,
  recentActivity,
  snippets,
} from "../db/schema.js";

interface UserPasswordResetRoutesDeps {
  authManager: AuthManager;
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
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
      const row = db.$client
        .prepare(
          "SELECT value FROM settings WHERE key = 'allow_password_reset'",
        )
        .get();
      if (row && (row as { value: string }).value !== "true") {
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
      const user = await db
        .select()
        .from(users)
        .where(eq(users.username, username));

      if (!user || user.length === 0) {
        authLogger.warn(
          `Password reset attempted for non-existent user: ${username}`,
        );
        return res.json({
          message:
            "If the user exists, a password reset code has been generated. Check docker logs for the code.",
        });
      }

      if (user[0].isOidc) {
        return res.json({
          message:
            "If the user exists, a password reset code has been generated. Check docker logs for the code.",
        });
      }

      const resetCode = crypto.randomInt(100000, 1000000).toString();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      db.$client
        .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .run(
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

      const resetDataRow = db.$client
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(`reset_code_${username}`);
      if (!resetDataRow) {
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

      const resetData = JSON.parse(
        (resetDataRow as Record<string, unknown>).value as string,
      );
      const now = new Date();
      const expiresAt = new Date(resetData.expiresAt);

      if (now > expiresAt) {
        db.$client
          .prepare("DELETE FROM settings WHERE key = ?")
          .run(`reset_code_${username}`);
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

      db.$client
        .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .run(
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
      const tempTokenRow = db.$client
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(`temp_reset_token_${username}`);
      if (!tempTokenRow) {
        return res.status(400).json({ error: "No temporary token found" });
      }

      const tempTokenData = JSON.parse(
        (tempTokenRow as Record<string, unknown>).value as string,
      );
      const now = new Date();
      const expiresAt = new Date(tempTokenData.expiresAt);

      if (now > expiresAt) {
        db.$client
          .prepare("DELETE FROM settings WHERE key = ?")
          .run(`temp_reset_token_${username}`);
        return res.status(400).json({ error: "Temporary token has expired" });
      }

      if (tempTokenData.token !== tempToken) {
        return res.status(400).json({ error: "Invalid temporary token" });
      }

      const user = await db
        .select()
        .from(users)
        .where(eq(users.username, username));
      if (!user || user.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }
      const userId = user[0].id;

      const saltRounds = parseInt(process.env.SALT || "10", 10);
      const password_hash = await bcrypt.hash(newPassword, saltRounds);

      let userIdFromJwt: string | null = null;
      const cookie = req.cookies?.jwt;
      let header: string | undefined;
      if (req.headers?.authorization?.startsWith("Bearer ")) {
        header = req.headers?.authorization?.split(" ")[1];
      }
      const token = cookie || header;

      if (token) {
        const payload = await authManager.verifyJWTToken(token);
        if (payload) {
          userIdFromJwt = payload.userId;
        }
      }

      if (userIdFromJwt === userId) {
        try {
          const success = await authManager.resetUserPasswordWithPreservedDEK(
            userId,
            newPassword,
          );

          if (!success) {
            throw new Error(
              "Failed to re-encrypt user data with new password.",
            );
          }

          await db
            .update(users)
            .set({ passwordHash: password_hash })
            .where(eq(users.id, userId));
          authManager.logoutUser(userId);
          authLogger.success(
            `Password reset (data preserved) for user: ${username}`,
            {
              operation: "password_reset_preserved",
              userId,
              username,
            },
          );
        } catch (encryptionError) {
          authLogger.error(
            "Failed to setup user data encryption after password reset",
            encryptionError,
            {
              operation: "password_reset_encryption_failed_preserved",
              userId,
              username,
            },
          );
          return res.status(500).json({
            error: "Password reset failed. Please contact administrator.",
          });
        }
      } else {
        await db
          .update(users)
          .set({ passwordHash: password_hash })
          .where(eq(users.username, username));

        try {
          await db
            .delete(sshCredentialUsage)
            .where(eq(sshCredentialUsage.userId, userId));
          await db
            .delete(fileManagerRecent)
            .where(eq(fileManagerRecent.userId, userId));
          await db
            .delete(fileManagerPinned)
            .where(eq(fileManagerPinned.userId, userId));
          await db
            .delete(fileManagerShortcuts)
            .where(eq(fileManagerShortcuts.userId, userId));
          await db
            .delete(recentActivity)
            .where(eq(recentActivity.userId, userId));
          await db
            .delete(dismissedAlerts)
            .where(eq(dismissedAlerts.userId, userId));
          await db.delete(snippets).where(eq(snippets.userId, userId));
          await db.delete(hosts).where(eq(hosts.userId, userId));
          await db
            .delete(sshCredentials)
            .where(eq(sshCredentials.userId, userId));

          await authManager.registerUser(userId, newPassword);
          authManager.logoutUser(userId);

          await db
            .update(users)
            .set({
              totpEnabled: false,
              totpSecret: null,
              totpBackupCodes: null,
            })
            .where(eq(users.id, userId));

          authLogger.warn(
            `Password reset completed for user: ${username}. All encrypted data has been deleted due to lost encryption key.`,
            {
              operation: "password_reset_data_deleted",
              userId,
              username,
            },
          );
        } catch (encryptionError) {
          authLogger.error(
            "Failed to setup user data encryption after password reset",
            encryptionError,
            {
              operation: "password_reset_encryption_failed",
              userId,
              username,
            },
          );
          return res.status(500).json({
            error: "Password reset failed. Please contact administrator.",
          });
        }
      }

      authLogger.success(`Password successfully reset for user: ${username}`);

      db.$client
        .prepare("DELETE FROM settings WHERE key = ?")
        .run(`reset_code_${username}`);
      db.$client
        .prepare("DELETE FROM settings WHERE key = ?")
        .run(`temp_reset_token_${username}`);

      res.json({ message: "Password has been successfully reset" });
    } catch (err) {
      authLogger.error("Failed to complete password reset", err);
      res.status(500).json({ error: "Failed to complete password reset" });
    }
  });
}
