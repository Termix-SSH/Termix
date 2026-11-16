import type { RequestHandler, Router } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import {
  API_KEY_SCOPES,
  DEFAULT_KEY_DAYS,
  DEFAULT_KEY_SCOPES,
  FULL_ACCESS_SCOPE,
} from "../../operations/key-scopes.js";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { authLogger } from "../../utils/logger.js";
import {
  getAuditUsername,
  logAudit,
  getRequestMeta,
} from "../../utils/audit-logger.js";
import {
  createCurrentApiKeyRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";

export function registerUserApiKeyRoutes(
  router: Router,
  requireAdmin: RequestHandler,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /users/api-keys/mine:
   *   get:
   *     summary: List your own API keys
   *     description: Returns the keys made for the signed in user, with when each was last used. Token hashes are never returned.
   *     tags:
   *       - API Keys
   *     responses:
   *       200:
   *         description: Your API keys.
   *       500:
   *         description: Failed to fetch API keys.
   */
  router.get("/api-keys/mine", authenticateJWT, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const keys = await createCurrentApiKeyRepository().listByUser(userId);
      return res.json({ apiKeys: keys });
    } catch (err) {
      authLogger.error("Failed to list own API keys", err);
      return res.status(500).json({ error: "Failed to fetch API keys" });
    }
  });

  /**
   * @openapi
   * /users/api-keys/mine/revoke-all:
   *   post:
   *     summary: Revoke all your own API keys
   *     tags:
   *       - API Keys
   *     responses:
   *       200:
   *         description: Keys revoked. Returns how many.
   *       500:
   *         description: Failed to revoke API keys.
   */
  router.post(
    "/api-keys/mine/revoke-all",
    authenticateJWT,
    async (req, res) => {
      try {
        const userId = (req as AuthenticatedRequest).userId;
        const count = await createCurrentApiKeyRepository().deleteAll(userId);
        const { ipAddress, userAgent } = getRequestMeta(req);
        await logAudit({
          userId,
          username: await getAuditUsername(userId),
          action: "revoke_all_api_keys",
          resourceType: "api_key",
          resourceId: userId,
          details: JSON.stringify({ count }),
          ipAddress,
          userAgent,
          success: true,
        });
        return res.json({ count });
      } catch (err) {
        authLogger.error("Failed to revoke own API keys", err);
        return res.status(500).json({ error: "Failed to revoke API keys" });
      }
    },
  );

  /**
   * @openapi
   * /users/api-keys/mine/{keyId}:
   *   delete:
   *     summary: Revoke one of your own API keys
   *     tags:
   *       - API Keys
   *     parameters:
   *       - in: path
   *         name: keyId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: API key revoked.
   *       404:
   *         description: You have no key with this id.
   *       500:
   *         description: Failed to revoke the API key.
   */
  router.delete("/api-keys/mine/:keyId", authenticateJWT, async (req, res) => {
    try {
      const userId = (req as AuthenticatedRequest).userId;
      const keyId = String(req.params.keyId);
      const apiKeyRepository = createCurrentApiKeyRepository();
      const key = await apiKeyRepository.findById(keyId);
      // Someone else's key answers the same as a missing one.
      if (!key || key.userId !== userId) {
        return res.status(404).json({ error: "API key not found" });
      }
      await apiKeyRepository.delete(keyId);
      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "delete_api_key",
        resourceType: "api_key",
        resourceId: keyId,
        resourceName: key.name,
        details: JSON.stringify({ own: true }),
        ipAddress,
        userAgent,
        success: true,
      });
      return res.json({ success: true });
    } catch (err) {
      authLogger.error("Failed to revoke own API key", err);
      return res.status(500).json({ error: "Failed to revoke the API key" });
    }
  });

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
   *                 nullable: true
   *                 description: When the key stops working. Left out means 90 days from now, null means never.
   *               scopes:
   *                 type: array
   *                 items:
   *                   type: string
   *                   enum: [read, operations:read, operations:run, full]
   *                 description: What the key may do. read only allows GET and HEAD requests, the operations scopes allow actions, full has no limits. Left out or null means read.
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
      const { name, userId: targetUserId, expiresAt, scopes } = req.body;
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
      if (expiresAt === undefined) {
        expiresAtValue = new Date(
          Date.now() + DEFAULT_KEY_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();
      } else if (expiresAt !== null && expiresAt !== "never") {
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

      let scopesValue: string[] | null = [...DEFAULT_KEY_SCOPES];
      if (scopes !== undefined && scopes !== null) {
        const known = [...API_KEY_SCOPES, FULL_ACCESS_SCOPE] as string[];
        if (
          !Array.isArray(scopes) ||
          scopes.some((scope) => !known.includes(String(scope)))
        ) {
          return res.status(400).json({ error: "Unknown API key scope" });
        }
        const picked = [...new Set(scopes as string[])];
        if (picked.includes(FULL_ACCESS_SCOPE)) {
          if (picked.length > 1) {
            return res
              .status(400)
              .json({ error: "full can't be combined with other scopes" });
          }
          scopesValue = null;
        } else if (picked.length > 0) {
          scopesValue = picked;
        }
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
        scopes: scopesValue ? JSON.stringify(scopesValue) : null,
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
          scopes: scopesValue,
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
        scopes: scopesValue,
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
