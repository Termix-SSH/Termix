import { getErrorMessage } from "../../utils/error-message.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import type { Request, RequestHandler, Response, Router } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import { authLogger } from "../../utils/logger.js";
import {
  createCurrentUserRepository,
  createCurrentUserAuthRepository,
} from "../repositories/factory.js";
import { deleteUserAndRelatedData } from "./delete-user-data.js";
import { isExternalAccount } from "../../auth/external-account.js";

type UserExternalAccountRoutesDeps = {
  authenticateJWT: RequestHandler;
  authManager: AuthManager;
};

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

/**
 * Merging an account that only signs in externally (SSO, LDAP or any login
 * plugin) into a password account, and taking the external sign-in away
 * again. The identities themselves live in user_external_identities.
 */
export function registerUserExternalAccountRoutes(
  router: Router,
  { authenticateJWT, authManager }: UserExternalAccountRoutesDeps,
): void {
  /**
   * @openapi
   * /users/link-external-to-password:
   *   post:
   *     summary: Merge an external account into a password account
   *     description: Moves an external-only account's sign-in identities onto a password account and deletes the external-only account (admin only). The 2.8 path /users/link-oidc-to-password and its oidcUserId field are accepted too.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               externalUserId:
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
  const link = async (req: Request, res: Response) => {
    const adminUserId = (req as AuthenticatedRequest).userId;
    const externalUserId = req.body?.externalUserId ?? req.body?.oidcUserId;
    const targetUsername = req.body?.targetUsername;

    if (
      !isNonEmptyString(externalUserId) ||
      !isNonEmptyString(targetUsername)
    ) {
      return res.status(400).json({
        error: "External user ID and target username are required",
      });
    }

    try {
      const userRepository = createCurrentUserRepository();
      const identities = createCurrentUserAuthRepository();
      const adminUser = await userRepository.findById(adminUserId);
      if (!adminUser?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const externalUser = await userRepository.findById(externalUserId);
      if (!externalUser) {
        return res.status(404).json({ error: "External user not found" });
      }
      if (!isExternalAccount(externalUser)) {
        return res
          .status(400)
          .json({ error: "Source user does not sign in externally" });
      }

      const targetUser = await userRepository.findByUsername(targetUsername);
      if (!targetUser) {
        return res
          .status(404)
          .json({ error: "Target password user not found" });
      }
      if (isExternalAccount(targetUser) || !targetUser.passwordHash) {
        return res.status(400).json({
          error: "Target user must be a password-based account",
        });
      }
      if ((await identities.listIdentitiesForUser(targetUser.id)).length > 0) {
        return res.status(400).json({
          error: "Target user already has an external sign-in",
        });
      }

      authLogger.info("Linking an external account to a password account", {
        operation: "link_external_to_password",
        externalUserId,
        targetUserId: targetUser.id,
        adminUserId,
      });

      await userRepository.update(targetUser.id, {
        isOidc: true,
        oidcIdentifier: externalUser.oidcIdentifier,
      });
      await identities.moveIdentities(externalUserId, targetUser.id);

      await authManager.revokeAllUserSessions(externalUserId);
      authManager.logoutUser(externalUserId);
      await deleteUserAndRelatedData(externalUserId);

      try {
        await DatabaseSaveTrigger.forceSave("link_external_explicit_save");
      } catch (saveError) {
        authLogger.error(
          "Failed to persist account linking to disk",
          saveError,
          {
            operation: "link_external_save_failed",
            externalUserId,
            targetUserId: targetUser.id,
          },
        );
      }

      authLogger.success(
        `External account ${externalUser.username} linked to password account ${targetUser.username}`,
        {
          operation: "link_external_to_password_success",
          externalUserId,
          targetUserId: targetUser.id,
          adminUserId,
        },
      );

      res.json({
        success: true,
        message: `${externalUser.username} has been linked to ${targetUser.username}. The password account can now sign in both ways.`,
      });
    } catch (err) {
      authLogger.error("Failed to link an external account", err, {
        operation: "link_external_to_password_failed",
        externalUserId,
        targetUsername,
        adminUserId,
      });
      res.status(500).json({
        error: "Failed to link accounts",
        details: getErrorMessage(err),
      });
    }
  };

  /**
   * @openapi
   * /users/unlink-external-from-password:
   *   post:
   *     summary: Remove external sign-in from a password account
   *     description: Removes every external sign-in identity from an account that also has a password (admin only). The 2.8 path /users/unlink-oidc-from-password is accepted too.
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
   *         description: External sign-in removed.
   *       400:
   *         description: Invalid request, or the user has no external sign-in or no password.
   *       403:
   *         description: Admin privileges required.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to unlink.
   */
  const unlink = async (req: Request, res: Response) => {
    const adminUserId = (req as AuthenticatedRequest).userId;
    const { userId } = req.body ?? {};

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    try {
      const userRepository = createCurrentUserRepository();
      const adminUser = await userRepository.findById(adminUserId);
      if (!adminUser?.isAdmin) {
        authLogger.warn("Non-admin attempted to remove an external sign-in", {
          operation: "unlink_external_unauthorized",
          adminUserId,
          targetUserId: userId,
        });
        return res.status(403).json({ error: "Admin privileges required" });
      }

      const targetUser = await userRepository.findById(userId);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      if (!isExternalAccount(targetUser)) {
        return res
          .status(400)
          .json({ error: "User does not have an external sign-in" });
      }
      if (!targetUser.passwordHash) {
        return res.status(400).json({
          error:
            "Cannot remove the external sign-in from a user without a password. This would leave the user unable to sign in.",
        });
      }

      await userRepository.update(targetUser.id, {
        isOidc: false,
        oidcIdentifier: null,
      });
      await createCurrentUserAuthRepository().unlinkIdentitiesForUser(
        targetUser.id,
      );

      try {
        await DatabaseSaveTrigger.forceSave("unlink_external_explicit_save");
      } catch (saveError) {
        authLogger.error(
          "Failed to save database after removing an external sign-in",
          saveError,
          {
            operation: "unlink_external_save_failed",
            targetUserId: targetUser.id,
          },
        );
      }

      authLogger.success("External sign-in removed from password account", {
        operation: "unlink_external_from_password_success",
        targetUserId: targetUser.id,
        adminUserId,
      });

      res.json({
        success: true,
        message: `External sign-in has been removed from ${targetUser.username}. The user can now only sign in with a password.`,
      });
    } catch (err) {
      authLogger.error("Failed to remove an external sign-in", err, {
        operation: "unlink_external_from_password_failed",
        targetUserId: userId,
        adminUserId,
      });
      res.status(500).json({
        error: "Failed to unlink",
        details: getErrorMessage(err),
      });
    }
  };

  router.post("/link-external-to-password", authenticateJWT, link);
  router.post("/unlink-external-from-password", authenticateJWT, unlink);
  // 2.8 paths, kept until 3.0.0.
  router.post("/link-oidc-to-password", authenticateJWT, link);
  router.post("/unlink-oidc-from-password", authenticateJWT, unlink);
}
