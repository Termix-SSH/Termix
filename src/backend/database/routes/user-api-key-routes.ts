import type { RequestHandler, Router } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { authLogger } from "../../utils/logger.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";
import {
  createCurrentApiKeyRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";

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
      const apiKeyRepository = createCurrentApiKeyRepository();
      const userRepository = createCurrentUserRepository();

      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name is required" });
      }
      if (typeof targetUserId !== "string" || !targetUserId.trim()) {
        return res.status(400).json({ error: "userId is required" });
      }

      const targetUser = await userRepository.findById(targetUserId);
      if (!targetUser) {
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

      await apiKeyRepository.create({
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

      const actorId = (req as AuthenticatedRequest).userId;
      const { ipAddress, userAgent } = getRequestMeta(req);
      const actorRecord = actorId
        ? await userRepository.findById(actorId)
        : null;
      await logAudit({
        userId: actorId,
        username: actorRecord?.username ?? actorId,
        action: "create_api_key",
        resourceType: "api_key",
        resourceId: keyId,
        resourceName: name.trim(),
        details: JSON.stringify({
          targetUserId,
          targetUsername: targetUser.username,
        }),
        ipAddress,
        userAgent,
        success: true,
      });

      return res.status(201).json({
        id: keyId,
        name: name.trim(),
        userId: targetUserId,
        username: targetUser.username,
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
      const keys = await createCurrentApiKeyRepository().listAllWithUsers();

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
      const apiKeyRepository = createCurrentApiKeyRepository();
      const userRepository = createCurrentUserRepository();

      const deleted = await apiKeyRepository.delete(keyId);
      if (!deleted) {
        return res.status(404).json({ error: "API key not found" });
      }

      const actorId = (req as AuthenticatedRequest).userId;
      const { ipAddress, userAgent } = getRequestMeta(req);
      const actorRecord = actorId
        ? await userRepository.findById(actorId)
        : null;
      await logAudit({
        userId: actorId,
        username: actorRecord?.username ?? actorId,
        action: "delete_api_key",
        resourceType: "api_key",
        resourceId: keyId,
        resourceName: deleted.name,
        ipAddress,
        userAgent,
        success: true,
      });

      return res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to delete API key", err, {
        keyId: String(req.params.keyId),
      });
      return res.status(500).json({ error: "Failed to delete API key" });
    }
  });
}
