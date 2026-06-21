import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import { eq, and } from "drizzle-orm";
import { authLogger } from "../../utils/logger.js";
import { db } from "../db/index.js";
import { users, roles, userRoles } from "../db/schema.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { AuthManager } from "../../utils/auth-manager.js";

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
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
      const allUsers = await db
        .select({
          id: users.id,
          username: users.username,
          isAdmin: users.isAdmin,
          isOidc: users.isOidc,
          passwordHash: users.passwordHash,
        })
        .from(users);

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
      const adminUser = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));
      if (!adminUser || adminUser.length === 0 || !adminUser[0].isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const targetUser = await db
        .select()
        .from(users)
        .where(
          resolvedUserId
            ? eq(users.id, resolvedUserId)
            : eq(users.username, resolvedUsername!),
        )
        .limit(1);
      if (!targetUser || targetUser.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      if (targetUser[0].isAdmin) {
        return res.status(400).json({ error: "User is already an admin" });
      }

      await db
        .update(users)
        .set({ isAdmin: true })
        .where(
          resolvedUserId
            ? eq(users.id, resolvedUserId)
            : eq(users.username, resolvedUsername!),
        );

      try {
        const targetId = targetUser[0].id;
        const adminRole = await db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.name, "admin"))
          .limit(1);
        const userRole = await db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.name, "user"))
          .limit(1);
        if (adminRole.length > 0) {
          await db
            .delete(userRoles)
            .where(
              and(
                eq(userRoles.userId, targetId),
                eq(userRoles.roleId, adminRole[0].id),
              ),
            );
          await db.insert(userRoles).values({
            userId: targetId,
            roleId: adminRole[0].id,
            grantedBy: userId,
          });
        }
        if (userRole.length > 0) {
          await db
            .delete(userRoles)
            .where(
              and(
                eq(userRoles.userId, targetId),
                eq(userRoles.roleId, userRole[0].id),
              ),
            );
        }
      } catch (roleError) {
        authLogger.error("Failed to sync admin role on make-admin", roleError, {
          operation: "make_admin_role_sync",
          userId: targetUser[0].id,
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
            userId: targetUser[0].id,
            username: targetUser[0].username,
          },
        );
      }

      authLogger.info("Admin privileges granted", {
        operation: "admin_grant",
        adminId: userId,
        targetUserId: targetUser[0].id,
        targetUsername: targetUser[0].username,
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      const adminUserRecord = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      await logAudit({
        userId,
        username: adminUserRecord[0]?.username ?? userId,
        action: "make_admin",
        resourceType: "user",
        resourceId: targetUser[0].id,
        resourceName: targetUser[0].username,
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ message: `User ${targetUser[0].username} is now an admin` });
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
      const adminUser = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));
      if (!adminUser || adminUser.length === 0 || !adminUser[0].isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      if (
        (resolvedUserId && adminUser[0].id === resolvedUserId) ||
        (resolvedUsername && adminUser[0].username === resolvedUsername)
      ) {
        return res
          .status(400)
          .json({ error: "Cannot remove your own admin status" });
      }

      const targetUser = await db
        .select()
        .from(users)
        .where(
          resolvedUserId
            ? eq(users.id, resolvedUserId)
            : eq(users.username, resolvedUsername!),
        )
        .limit(1);
      if (!targetUser || targetUser.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      if (!targetUser[0].isAdmin) {
        return res.status(400).json({ error: "User is not an admin" });
      }

      await db
        .update(users)
        .set({ isAdmin: false })
        .where(
          resolvedUserId
            ? eq(users.id, resolvedUserId)
            : eq(users.username, resolvedUsername!),
        );

      try {
        const targetId = targetUser[0].id;
        const adminRole = await db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.name, "admin"))
          .limit(1);
        const userRole = await db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.name, "user"))
          .limit(1);
        if (adminRole.length > 0) {
          await db
            .delete(userRoles)
            .where(
              and(
                eq(userRoles.userId, targetId),
                eq(userRoles.roleId, adminRole[0].id),
              ),
            );
        }
        if (userRole.length > 0) {
          await db
            .delete(userRoles)
            .where(
              and(
                eq(userRoles.userId, targetId),
                eq(userRoles.roleId, userRole[0].id),
              ),
            );
          await db.insert(userRoles).values({
            userId: targetId,
            roleId: userRole[0].id,
            grantedBy: userId,
          });
        }
      } catch (roleError) {
        authLogger.error(
          "Failed to sync user role on remove-admin",
          roleError,
          {
            operation: "remove_admin_role_sync",
            userId: targetUser[0].id,
          },
        );
      }

      try {
        const { saveMemoryDatabaseToFile } = await import("../db/index.js");
        await saveMemoryDatabaseToFile();
      } catch (saveError) {
        authLogger.error("Failed to persist admin removal to disk", saveError, {
          operation: "remove_admin_save_failed",
          userId: targetUser[0].id,
          username: targetUser[0].username,
        });
      }

      authLogger.info("Admin privileges revoked", {
        operation: "admin_revoke",
        adminId: userId,
        targetUserId: targetUser[0].id,
        targetUsername: targetUser[0].username,
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      const adminUserRecord = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      await logAudit({
        userId,
        username: adminUserRecord[0]?.username ?? userId,
        action: "remove_admin",
        resourceType: "user",
        resourceId: targetUser[0].id,
        resourceName: targetUser[0].username,
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({
        message: `Admin status removed from ${targetUser[0].username}`,
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

    try {
      const adminUser = await db
        .select()
        .from(users)
        .where(eq(users.id, adminId));
      if (!adminUser || adminUser.length === 0 || !adminUser[0].isAdmin) {
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
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.username, username));
      if (existing && existing.length > 0) {
        return res.status(409).json({ error: "Username already exists" });
      }

      const password_hash = await bcrypt.hash(password, 10);
      const id = nanoid();

      db.$client.transaction(() => {
        db.$client
          .prepare(
            "INSERT INTO users (id, username, password_hash, is_admin, is_oidc, client_id, client_secret, issuer_url, authorization_url, token_url, identifier_path, name_path, scopes, totp_secret, totp_enabled, totp_backup_codes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            id,
            username,
            password_hash,
            0,
            0,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "openid email profile",
            null,
            0,
            null,
          );
      })();

      try {
        const userRole = await db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.name, "user"))
          .limit(1);
        if (userRole.length > 0) {
          await db.insert(userRoles).values({
            userId: id,
            roleId: userRole[0].id,
            grantedBy: adminId,
          });
        }
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
        await db.delete(users).where(eq(users.id, id));
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
      const adminRecord = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, adminId))
        .limit(1);
      await logAudit({
        userId: adminId,
        username: adminRecord[0]?.username ?? adminId,
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
