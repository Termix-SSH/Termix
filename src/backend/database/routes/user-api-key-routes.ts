import type { RequestHandler, Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { authLogger } from "../../utils/logger.js";
import { db } from "../db/index.js";
import { apiKeys, users } from "../db/schema.js";

export function registerUserApiKeyRoutes(
  router: Router,
  requireAdmin: RequestHandler,
): void {
  /**
   * @openapi
   * /users/api-keys:
   *   post:
   *     summary: Create an API key (admin only)
   *     description: Creates a new API key scoped to a specific user. The full token is returned only once.
   *     tags:
   *       - API Keys
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - name
   *               - userId
   *             properties:
   *               name:
   *                 type: string
   *                 description: Human-readable name for the key.
   *               userId:
   *                 type: string
   *                 description: ID of the user this key is scoped to.
   *               expiresAt:
   *                 type: string
   *                 format: date-time
   *                 description: Optional expiration date. Null means the key never expires.
   *     responses:
   *       201:
   *         description: API key created. Contains the full token (shown only once).
   *       400:
   *         description: Invalid input.
   *       403:
   *         description: Admin access required.
   *       404:
   *         description: Target user not found.
   *       500:
   *         description: Failed to create API key.
   */
  router.post("/api-keys", requireAdmin, async (req, res) => {
    try {
      const { name, userId: targetUserId, expiresAt } = req.body;

      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name is required" });
      }
      if (typeof targetUserId !== "string" || !targetUserId.trim()) {
        return res.status(400).json({ error: "userId is required" });
      }

      const targetUser = await db
        .select()
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);
      if (targetUser.length === 0) {
        return res.status(404).json({ error: "Target user not found" });
      }

      let expiresAtValue: string | null = null;
      if (expiresAt) {
        const parsed = new Date(expiresAt);
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ error: "Invalid expiresAt date" });
        }
        if (parsed <= new Date()) {
          return res
            .status(400)
            .json({ error: "expiresAt must be in the future" });
        }
        expiresAtValue = parsed.toISOString();
      }

      const rawToken = "tmx_" + crypto.randomBytes(32).toString("hex");
      const tokenPrefix = rawToken.substring(0, 12);
      const tokenHash = await bcrypt.hash(rawToken, 10);
      const keyId = nanoid();
      const now = new Date().toISOString();

      await db.insert(apiKeys).values({
        id: keyId,
        userId: targetUserId,
        name: name.trim(),
        tokenHash,
        tokenPrefix,
        createdAt: now,
        expiresAt: expiresAtValue,
        lastUsedAt: null,
        isActive: true,
      });

      const { saveMemoryDatabaseToFile } = await import("../db/index.js");
      await saveMemoryDatabaseToFile();

      return res.status(201).json({
        id: keyId,
        name: name.trim(),
        userId: targetUserId,
        username: targetUser[0].username,
        tokenPrefix,
        createdAt: now,
        expiresAt: expiresAtValue,
        token: rawToken,
      });
    } catch (err) {
      authLogger.error("Failed to create API key", err);
      return res.status(500).json({ error: "Failed to create API key" });
    }
  });

  /**
   * @openapi
   * /users/api-keys:
   *   get:
   *     summary: List all API keys (admin only)
   *     description: Returns all API keys with associated usernames. Token hashes are never returned.
   *     tags:
   *       - API Keys
   *     responses:
   *       200:
   *         description: List of API keys.
   *       403:
   *         description: Admin access required.
   *       500:
   *         description: Failed to fetch API keys.
   */
  router.get("/api-keys", requireAdmin, async (_req, res) => {
    try {
      const keys = await db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          userId: apiKeys.userId,
          username: users.username,
          tokenPrefix: apiKeys.tokenPrefix,
          createdAt: apiKeys.createdAt,
          expiresAt: apiKeys.expiresAt,
          lastUsedAt: apiKeys.lastUsedAt,
          isActive: apiKeys.isActive,
        })
        .from(apiKeys)
        .leftJoin(users, eq(apiKeys.userId, users.id))
        .orderBy(apiKeys.createdAt);

      return res.json({ apiKeys: keys });
    } catch (err) {
      authLogger.error("Failed to list API keys", err);
      return res.status(500).json({ error: "Failed to fetch API keys" });
    }
  });

  /**
   * @openapi
   * /users/api-keys/{keyId}:
   *   delete:
   *     summary: Delete an API key (admin only)
   *     description: Permanently deletes an API key. It can no longer be used to authenticate.
   *     tags:
   *       - API Keys
   *     parameters:
   *       - in: path
   *         name: keyId
   *         required: true
   *         schema:
   *           type: string
   *         description: The ID of the API key to delete.
   *     responses:
   *       200:
   *         description: API key deleted.
   *       403:
   *         description: Admin access required.
   *       404:
   *         description: API key not found.
   *       500:
   *         description: Failed to delete API key.
   */
  router.delete("/api-keys/:keyId", requireAdmin, async (req, res) => {
    try {
      const keyId = String(req.params.keyId);

      const existing = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, keyId))
        .limit(1);

      if (existing.length === 0) {
        return res.status(404).json({ error: "API key not found" });
      }

      await db.delete(apiKeys).where(eq(apiKeys.id, keyId));

      const { saveMemoryDatabaseToFile } = await import("../db/index.js");
      await saveMemoryDatabaseToFile();

      return res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to delete API key", err, {
        keyId: String(req.params.keyId),
      });
      return res.status(500).json({ error: "Failed to delete API key" });
    }
  });
}
