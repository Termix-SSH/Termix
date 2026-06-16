import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import { eq } from "drizzle-orm";
import { authLogger } from "../../utils/logger.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";

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
}
