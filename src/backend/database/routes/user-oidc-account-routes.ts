import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import { eq } from "drizzle-orm";
import { AuthManager } from "../../utils/auth-manager.js";
import { authLogger } from "../../utils/logger.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { deleteUserAndRelatedData } from "./delete-user-data.js";

type UserOidcAccountRoutesDeps = {
  authenticateJWT: RequestHandler;
  authManager: AuthManager;
};

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

export function registerUserOidcAccountRoutes(
  router: Router,
  { authenticateJWT, authManager }: UserOidcAccountRoutesDeps,
): void {
  /**
   * @openapi
   * /users/link-oidc-to-password:
   *   post:
   *     summary: Link OIDC user to password account
   *     description: Merges an OIDC-only account into a password-based account (admin only).
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               oidcUserId:
   *                 type: string
   *               targetUsername:
   *                 type: string
   *     responses:
   *       200:
   *         description: Accounts linked successfully.
   *       400:
   *         description: Invalid request or incompatible accounts.
   *       403:
   *         description: Admin access required.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to link accounts.
   */
  router.post("/link-oidc-to-password", authenticateJWT, async (req, res) => {
    const adminUserId = (req as AuthenticatedRequest).userId;
    const { oidcUserId, targetUsername } = req.body;

    if (!isNonEmptyString(oidcUserId) || !isNonEmptyString(targetUsername)) {
      return res.status(400).json({
        error: "OIDC user ID and target username are required",
      });
    }

    try {
      const adminUser = await db
        .select()
        .from(users)
        .where(eq(users.id, adminUserId));
      if (!adminUser || adminUser.length === 0 || !adminUser[0].isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const oidcUserRecords = await db
        .select()
        .from(users)
        .where(eq(users.id, oidcUserId));
      if (!oidcUserRecords || oidcUserRecords.length === 0) {
        return res.status(404).json({ error: "OIDC user not found" });
      }

      const oidcUser = oidcUserRecords[0];

      if (!oidcUser.isOidc) {
        return res.status(400).json({
          error: "Source user is not an OIDC user",
        });
      }

      const targetUserRecords = await db
        .select()
        .from(users)
        .where(eq(users.username, targetUsername));
      if (!targetUserRecords || targetUserRecords.length === 0) {
        return res
          .status(404)
          .json({ error: "Target password user not found" });
      }

      const targetUser = targetUserRecords[0];

      if (targetUser.isOidc || !targetUser.passwordHash) {
        return res.status(400).json({
          error: "Target user must be a password-based account",
        });
      }

      if (targetUser.clientId && targetUser.oidcIdentifier) {
        return res.status(400).json({
          error: "Target user already has OIDC authentication configured",
        });
      }

      authLogger.info("Linking OIDC user to password account", {
        operation: "link_oidc_to_password",
        oidcUserId,
        oidcUsername: oidcUser.username,
        targetUserId: targetUser.id,
        targetUsername: targetUser.username,
        adminUserId,
      });

      await db
        .update(users)
        .set({
          isOidc: true,
          oidcIdentifier: oidcUser.oidcIdentifier,
          clientId: oidcUser.clientId,
          clientSecret: oidcUser.clientSecret,
          issuerUrl: oidcUser.issuerUrl,
          authorizationUrl: oidcUser.authorizationUrl,
          tokenUrl: oidcUser.tokenUrl,
          identifierPath: oidcUser.identifierPath,
          namePath: oidcUser.namePath,
          scopes: oidcUser.scopes || "openid email profile",
        })
        .where(eq(users.id, targetUser.id));

      try {
        await authManager.convertToOIDCEncryption(targetUser.id);
      } catch (encryptionError) {
        authLogger.error(
          "Failed to convert encryption to OIDC during linking",
          encryptionError,
          {
            operation: "link_convert_encryption_failed",
            userId: targetUser.id,
          },
        );
        await db
          .update(users)
          .set({
            isOidc: false,
            oidcIdentifier: null,
            clientId: "",
            clientSecret: "",
            issuerUrl: "",
            authorizationUrl: "",
            tokenUrl: "",
            identifierPath: "",
            namePath: "",
            scopes: "openid email profile",
          })
          .where(eq(users.id, targetUser.id));

        return res.status(500).json({
          error:
            "Failed to convert encryption for dual-auth. Please ensure the password account has encryption setup.",
          details:
            encryptionError instanceof Error
              ? encryptionError.message
              : "Unknown error",
        });
      }

      await authManager.revokeAllUserSessions(oidcUserId);
      authManager.logoutUser(oidcUserId);

      await deleteUserAndRelatedData(oidcUserId);

      try {
        const { saveMemoryDatabaseToFile } = await import("../db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        authLogger.error(
          "Failed to persist account linking to disk",
          saveError,
          {
            operation: "link_oidc_save_failed",
            oidcUserId,
            targetUserId: targetUser.id,
          },
        );
      }

      authLogger.success(
        `OIDC user ${oidcUser.username} linked to password account ${targetUser.username}`,
        {
          operation: "link_oidc_to_password_success",
          oidcUserId,
          oidcUsername: oidcUser.username,
          targetUserId: targetUser.id,
          targetUsername: targetUser.username,
          adminUserId,
        },
      );

      res.json({
        success: true,
        message: `OIDC user ${oidcUser.username} has been linked to ${targetUser.username}. The password account can now use both password and OIDC login.`,
      });
    } catch (err) {
      authLogger.error("Failed to link OIDC user to password account", err, {
        operation: "link_oidc_to_password_failed",
        oidcUserId,
        targetUsername,
        adminUserId,
      });
      res.status(500).json({
        error: "Failed to link accounts",
        details: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });

  /**
   * @openapi
   * /users/unlink-oidc-from-password:
   *   post:
   *     summary: Unlink OIDC from password account
   *     description: Removes OIDC authentication from a dual-auth account (admin only).
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               userId:
   *                 type: string
   *     responses:
   *       200:
   *         description: OIDC unlinked successfully.
   *       400:
   *         description: Invalid request or user doesn't have OIDC.
   *       403:
   *         description: Admin privileges required.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to unlink OIDC.
   */
  router.post(
    "/unlink-oidc-from-password",
    authenticateJWT,
    async (req, res) => {
      const adminUserId = (req as AuthenticatedRequest).userId;
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).json({
          error: "User ID is required",
        });
      }

      try {
        const adminUser = await db
          .select()
          .from(users)
          .where(eq(users.id, adminUserId));

        if (!adminUser || adminUser.length === 0 || !adminUser[0].isAdmin) {
          authLogger.warn("Non-admin attempted to unlink OIDC from password", {
            operation: "unlink_oidc_unauthorized",
            adminUserId,
            targetUserId: userId,
          });
          return res.status(403).json({
            error: "Admin privileges required",
          });
        }

        const targetUserRecords = await db
          .select()
          .from(users)
          .where(eq(users.id, userId));

        if (!targetUserRecords || targetUserRecords.length === 0) {
          return res.status(404).json({
            error: "User not found",
          });
        }

        const targetUser = targetUserRecords[0];

        if (!targetUser.isOidc) {
          return res.status(400).json({
            error: "User does not have OIDC authentication enabled",
          });
        }

        if (!targetUser.passwordHash || targetUser.passwordHash === "") {
          return res.status(400).json({
            error:
              "Cannot unlink OIDC from a user without password authentication. This would leave the user unable to login.",
          });
        }

        authLogger.info("Unlinking OIDC from password account", {
          operation: "unlink_oidc_from_password_start",
          targetUserId: targetUser.id,
          targetUsername: targetUser.username,
          adminUserId,
        });

        await db
          .update(users)
          .set({
            isOidc: false,
            oidcIdentifier: null,
            clientId: "",
            clientSecret: "",
            issuerUrl: "",
            authorizationUrl: "",
            tokenUrl: "",
            identifierPath: "",
            namePath: "",
            scopes: "openid email profile",
          })
          .where(eq(users.id, targetUser.id));

        try {
          const { saveMemoryDatabaseToFile } = await import("../db/index.js");
          await saveMemoryDatabaseToFile();
        } catch (saveError) {
          authLogger.error(
            "Failed to save database after unlinking OIDC",
            saveError,
            {
              operation: "unlink_oidc_save_failed",
              targetUserId: targetUser.id,
            },
          );
        }

        authLogger.success("OIDC unlinked from password account successfully", {
          operation: "unlink_oidc_from_password_success",
          targetUserId: targetUser.id,
          targetUsername: targetUser.username,
          adminUserId,
        });

        res.json({
          success: true,
          message: `OIDC authentication has been removed from ${targetUser.username}. User can now only login with password.`,
        });
      } catch (err) {
        authLogger.error("Failed to unlink OIDC from password account", err, {
          operation: "unlink_oidc_from_password_failed",
          targetUserId: userId,
          adminUserId,
        });
        res.status(500).json({
          error: "Failed to unlink OIDC",
          details: err instanceof Error ? err.message : "Unknown error",
        });
      }
    },
  );
}
