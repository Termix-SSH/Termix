import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import { authLogger } from "../../utils/logger.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { AuthManager } from "../../utils/auth-manager.js";
import { createCurrentRoleRepository } from "../repositories/current-role-repository.js";
import { createCurrentUserRepository } from "../repositories/current-user-repository.js";
import type {
  UserRecord,
  UserRepository,
} from "../repositories/user-repository.js";

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

async function getUserByPreferredIdentifier(
  userRepository: UserRepository,
  userId: string | null,
  username: string | null,
): Promise<UserRecord | null> {
  return userId
    ? userRepository.findById(userId)
    : userRepository.findByUsername(username!);
}

export function registerUserAdminRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /users/list:
   *   get:
   *     summary: List all users
   *     description: Retrieves a list of all users in the system.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: A list of users.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Failed to list users.
   */
  router.get("/list", authenticateJWT, async (req, res) => {
    try {
      const allUsers = await createCurrentUserRepository().listAll();

      res.json({
        users: allUsers.map((u) => ({
          userId: u.id,
          username: u.username,
          is_admin: u.isAdmin,
          is_oidc: u.isOidc,
          password_hash: u.passwordHash ? "set" : null,
        })),
      });
    } catch (err) {
      authLogger.error("Failed to list users", err);
      res.status(500).json({ error: "Failed to list users" });
    }
  });

  /**
   * @openapi
   * /users/make-admin:
   *   post:
   *     summary: Make user admin
   *     description: Grants admin privileges to a user.
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
   *                 description: Preferred unique user identifier.
   *               username:
   *                 type: string
   *                 description: Legacy fallback identifier.
   *     responses:
   *       200:
   *         description: User is now an admin.
   *       400:
   *         description: User ID or username is required, or the user is already an admin.
   *       403:
   *         description: Not authorized.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to make user admin.
   */
  router.post("/make-admin", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { userId: targetUserId, username } = req.body;
    const resolvedUserId = isNonEmptyString(targetUserId)
      ? targetUserId.trim()
      : null;
    const resolvedUsername = isNonEmptyString(username)
      ? username.trim()
      : null;

    if (!resolvedUserId && !resolvedUsername) {
      return res.status(400).json({ error: "User ID or username is required" });
    }

    try {
      const userRepository = createCurrentUserRepository();
      const adminUser = await userRepository.findById(userId);
      if (!adminUser?.isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const targetUser = await getUserByPreferredIdentifier(
        userRepository,
        resolvedUserId,
        resolvedUsername,
      );
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (targetUser.isAdmin) {
        return res.status(400).json({ error: "User is already an admin" });
      }

      await userRepository.update(targetUser.id, { isAdmin: true });

      try {
        await createCurrentRoleRepository().switchUserRoleName({
          userId: targetUser.id,
          addRoleName: "admin",
          removeRoleName: "user",
          grantedBy: userId,
        });
      } catch (roleError) {
        authLogger.error("Failed to sync admin role on make-admin", roleError, {
          operation: "make_admin_role_sync",
          userId: targetUser.id,
        });
      }

      try {
        const { saveMemoryDatabaseToFile } = await import("../db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        authLogger.error(
          "Failed to persist admin promotion to disk",
          saveError,
          {
            operation: "make_admin_save_failed",
            userId: targetUser.id,
            username: targetUser.username,
          },
        );
      }

      authLogger.info("Admin privileges granted", {
        operation: "admin_grant",
        adminId: userId,
        targetUserId: targetUser.id,
        targetUsername: targetUser.username,
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: adminUser.username ?? userId,
        action: "make_admin",
        resourceType: "user",
        resourceId: targetUser.id,
        resourceName: targetUser.username,
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ message: `User ${targetUser.username} is now an admin` });
    } catch (err) {
      authLogger.error("Failed to make user admin", err);
      res.status(500).json({ error: "Failed to make user admin" });
    }
  });

  /**
   * @openapi
   * /users/remove-admin:
   *   post:
   *     summary: Remove admin status
   *     description: Revokes admin privileges from a user.
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
   *                 description: Preferred unique user identifier.
   *               username:
   *                 type: string
   *                 description: Legacy fallback identifier.
   *     responses:
   *       200:
   *         description: Admin status removed from user.
   *       400:
   *         description: User ID or username is required, or cannot remove your own admin status.
   *       403:
   *         description: Not authorized.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to remove admin status.
   */
  router.post("/remove-admin", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { userId: targetUserId, username } = req.body;
    const resolvedUserId = isNonEmptyString(targetUserId)
      ? targetUserId.trim()
      : null;
    const resolvedUsername = isNonEmptyString(username)
      ? username.trim()
      : null;

    if (!resolvedUserId && !resolvedUsername) {
      return res.status(400).json({ error: "User ID or username is required" });
    }

    try {
      const userRepository = createCurrentUserRepository();
      const adminUser = await userRepository.findById(userId);
      if (!adminUser?.isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      if (
        (resolvedUserId && adminUser.id === resolvedUserId) ||
        (resolvedUsername && adminUser.username === resolvedUsername)
      ) {
        return res
          .status(400)
          .json({ error: "Cannot remove your own admin status" });
      }

      const targetUser = await getUserByPreferredIdentifier(
        userRepository,
        resolvedUserId,
        resolvedUsername,
      );
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!targetUser.isAdmin) {
        return res.status(400).json({ error: "User is not an admin" });
      }

      await userRepository.update(targetUser.id, { isAdmin: false });

      try {
        await createCurrentRoleRepository().switchUserRoleName({
          userId: targetUser.id,
          addRoleName: "user",
          removeRoleName: "admin",
          grantedBy: userId,
        });
      } catch (roleError) {
        authLogger.error(
          "Failed to sync user role on remove-admin",
          roleError,
          {
            operation: "remove_admin_role_sync",
            userId: targetUser.id,
          },
        );
      }

      try {
        const { saveMemoryDatabaseToFile } = await import("../db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        authLogger.error("Failed to persist admin removal to disk", saveError, {
          operation: "remove_admin_save_failed",
          userId: targetUser.id,
          username: targetUser.username,
        });
      }

      authLogger.info("Admin privileges revoked", {
        operation: "admin_revoke",
        adminId: userId,
        targetUserId: targetUser.id,
        targetUsername: targetUser.username,
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: adminUser.username ?? userId,
        action: "remove_admin",
        resourceType: "user",
        resourceId: targetUser.id,
        resourceName: targetUser.username,
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({
        message: `Admin status removed from ${targetUser.username}`,
      });
    } catch (err) {
      authLogger.error("Failed to remove admin status", err);
      res.status(500).json({ error: "Failed to remove admin status" });
    }
  });

  /**
   * @openapi
   * /users/admin-create:
   *   post:
   *     summary: Admin create user
   *     description: Allows an admin to create a new user regardless of whether public registration is enabled.
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
   *               password:
   *                 type: string
   *     responses:
   *       200:
   *         description: User created successfully.
   *       400:
   *         description: Username and password are required.
   *       403:
   *         description: Not authorized.
   *       409:
   *         description: Username already exists.
   *       500:
   *         description: Failed to create user.
   */
  router.post("/admin-create", authenticateJWT, async (req, res) => {
    const adminId = (req as AuthenticatedRequest).userId;
    const userRepository = createCurrentUserRepository();
    let adminUser: UserRecord | null = null;

    try {
      adminUser = await userRepository.findById(adminId);
      if (!adminUser?.isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }
    } catch (err) {
      authLogger.error("Failed to verify admin status", err);
      return res.status(500).json({ error: "Failed to verify admin status" });
    }

    const { username, password } = req.body;

    if (!isNonEmptyString(username) || !isNonEmptyString(password)) {
      return res
        .status(400)
        .json({ error: "Username and password are required" });
    }

    try {
      const existing = await userRepository.findByUsername(username);
      if (existing) {
        return res.status(409).json({ error: "Username already exists" });
      }

      const password_hash = await bcrypt.hash(password, 10);
      const id = nanoid();

      await userRepository.create({
        id,
        username,
        passwordHash: password_hash,
        isAdmin: false,
        isOidc: false,
        clientId: "",
        clientSecret: "",
        issuerUrl: "",
        authorizationUrl: "",
        tokenUrl: "",
        identifierPath: "",
        namePath: "",
        scopes: "openid email profile",
        totpSecret: null,
        totpEnabled: false,
        totpBackupCodes: null,
      });

      try {
        await createCurrentRoleRepository().assignRoleNameToUser({
          userId: id,
          roleName: "user",
          grantedBy: adminId,
        });
      } catch (roleError) {
        authLogger.error(
          "Failed to assign default role during admin create",
          roleError,
          {
            operation: "admin_create_user_role",
            userId: id,
          },
        );
      }

      const authManager = AuthManager.getInstance();
      try {
        await authManager.registerUser(id, password);
      } catch (encryptionError) {
        await userRepository.delete(id);
        authLogger.error(
          "Failed to setup user encryption during admin create, rolled back",
          encryptionError,
          { operation: "admin_create_user_encryption_failed", userId: id },
        );
        return res.status(500).json({
          error: "Failed to setup user security - user creation cancelled",
        });
      }

      try {
        const { saveMemoryDatabaseToFile } = await import("../db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        authLogger.error(
          "Failed to persist admin-created user to disk",
          saveError,
          {
            operation: "admin_create_user_save_failed",
            userId: id,
          },
        );
      }

      authLogger.success("User created by admin", {
        operation: "admin_create_user_success",
        adminId,
        userId: id,
        username,
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId: adminId,
        username: adminUser.username ?? adminId,
        action: "create_user",
        resourceType: "user",
        resourceId: id,
        resourceName: username,
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({
        message: "User created",
        toast: { type: "success", message: `User created: ${username}` },
      });
    } catch (err) {
      authLogger.error("Failed to admin-create user", err);
      res.status(500).json({ error: "Failed to create user" });
    }
  });
}
