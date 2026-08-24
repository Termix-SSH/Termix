import crypto from "crypto";
import express, { type Request, type Response } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { authLogger } from "../../utils/logger.js";
import { getErrorMessage } from "../../utils/error-message.js";
import {
  logAudit,
  getAuditUsername,
  getRequestMeta,
} from "../../utils/audit-logger.js";
import { testConnectSource } from "../../utils/onepassword-connect.js";
import { readSecretSourcePrivateAllowlist } from "../../utils/secret-source-egress.js";
import { clearExternalSecretCache } from "../../hosts/external-secrets.js";
import { createCurrentSecretSourceRepository } from "../repositories/factory.js";
import {
  toPublicSecretSource,
  type SecretSourceRecord,
} from "../repositories/secret-source-repository.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();
const permissionManager = PermissionManager.getInstance();

const KINDS = ["onepassword-connect"] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validBaseUrl(raw: unknown): string | null {
  if (!isNonEmptyString(raw)) return null;
  try {
    const url = new URL(raw.trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

async function loadOwned(
  id: string,
  userId: string,
  res: Response,
): Promise<SecretSourceRecord | null> {
  const source = await createCurrentSecretSourceRepository().findById(id);
  if (!source) {
    res.status(404).json({ error: "Secret source not found" });
    return null;
  }
  if (source.userId !== userId) {
    res.status(403).json({ error: "Only the owner can change this source" });
    return null;
  }
  return source;
}

/**
 * @openapi
 * /secret-sources:
 *   get:
 *     summary: List secret sources visible to the caller (own + shared)
 *     tags:
 *       - Secret Sources
 */
router.get(
  "/",
  authenticateJWT,
  permissionManager.requirePermission("credentials.view"),
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    try {
      const rows =
        await createCurrentSecretSourceRepository().listVisibleToUser(userId);
      res.json({
        sources: rows.map((row) => ({
          ...toPublicSecretSource(row),
          owned: row.userId === userId,
        })),
      });
    } catch (error) {
      authLogger.error("Failed to list secret sources", error);
      res.status(500).json({ error: "Failed to list secret sources" });
    }
  },
);

/**
 * @openapi
 * /secret-sources:
 *   post:
 *     summary: Create a secret source (1Password Connect)
 *     description: Sharing a source with every user requires admin. The token is encrypted with the owner's data key.
 *     tags:
 *       - Secret Sources
 */
router.post(
  "/",
  authenticateJWT,
  permissionManager.requirePermission("credentials.create"),
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const {
      name,
      kind = "onepassword-connect",
      baseUrl,
      token,
      shared,
    } = req.body ?? {};
    const url = validBaseUrl(baseUrl);
    if (!isNonEmptyString(name) || !url || !isNonEmptyString(token)) {
      return res.status(400).json({
        error: "name, a valid http(s) baseUrl and token are required",
      });
    }
    if (!KINDS.includes(kind)) {
      return res.status(400).json({ error: "Unsupported secret source kind" });
    }
    if (shared === true && !(await permissionManager.isAdmin(userId))) {
      return res
        .status(403)
        .json({ error: "Only admins can share a secret source" });
    }
    try {
      const created = await createCurrentSecretSourceRepository().create({
        id: crypto.randomUUID(),
        userId,
        name: name.trim(),
        kind,
        baseUrl: url,
        token: token.trim(),
        shared: shared === true,
      });
      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "secret_source_create",
        resourceType: "secret_source",
        resourceId: created.id,
        resourceName: created.name,
        ipAddress,
        userAgent,
        success: true,
      });
      res.json({ source: { ...toPublicSecretSource(created), owned: true } });
    } catch (error) {
      authLogger.error("Failed to create secret source", error);
      res.status(500).json({ error: "Failed to create secret source" });
    }
  },
);

/**
 * @openapi
 * /secret-sources/{id}:
 *   put:
 *     summary: Update a secret source (owner only; omit token to keep it)
 *     tags:
 *       - Secret Sources
 */
router.put(
  "/:id",
  authenticateJWT,
  permissionManager.requirePermission("credentials.edit"),
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const { name, baseUrl, token, shared } = req.body ?? {};
    try {
      const source = await loadOwned(String(req.params.id), userId, res);
      if (!source) return;
      const url = baseUrl === undefined ? undefined : validBaseUrl(baseUrl);
      if (baseUrl !== undefined && !url) {
        return res.status(400).json({ error: "baseUrl must be http(s)" });
      }
      if (
        shared === true &&
        !source.shared &&
        !(await permissionManager.isAdmin(userId))
      ) {
        return res
          .status(403)
          .json({ error: "Only admins can share a secret source" });
      }
      await createCurrentSecretSourceRepository().update(source, {
        ...(isNonEmptyString(name) ? { name: name.trim() } : {}),
        ...(url ? { baseUrl: url } : {}),
        ...(isNonEmptyString(token) ? { token: token.trim() } : {}),
        ...(typeof shared === "boolean" ? { shared } : {}),
      });
      clearExternalSecretCache();
      res.json({ success: true });
    } catch (error) {
      authLogger.error("Failed to update secret source", error);
      res.status(500).json({ error: "Failed to update secret source" });
    }
  },
);

/**
 * @openapi
 * /secret-sources/{id}:
 *   delete:
 *     summary: Delete a secret source (owner only)
 *     tags:
 *       - Secret Sources
 */
router.delete(
  "/:id",
  authenticateJWT,
  permissionManager.requirePermission("credentials.delete"),
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    try {
      const source = await loadOwned(String(req.params.id), userId, res);
      if (!source) return;
      await createCurrentSecretSourceRepository().deleteById(source.id);
      clearExternalSecretCache();
      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "secret_source_delete",
        resourceType: "secret_source",
        resourceId: source.id,
        resourceName: source.name,
        ipAddress,
        userAgent,
        success: true,
      });
      res.json({ success: true });
    } catch (error) {
      authLogger.error("Failed to delete secret source", error);
      res.status(500).json({ error: "Failed to delete secret source" });
    }
  },
);

/**
 * @openapi
 * /secret-sources/{id}/test:
 *   post:
 *     summary: Check that the source is reachable and the token is accepted
 *     tags:
 *       - Secret Sources
 */
router.post(
  "/:id/test",
  authenticateJWT,
  permissionManager.requirePermission("credentials.view"),
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    try {
      const repository = createCurrentSecretSourceRepository();
      const source = await repository.findById(String(req.params.id));
      if (!source || (source.userId !== userId && !source.shared)) {
        return res.status(404).json({ error: "Secret source not found" });
      }
      const vaults = await testConnectSource({
        baseUrl: source.baseUrl,
        token: repository.decryptToken(source),
        allowedPrivateHosts: await readSecretSourcePrivateAllowlist(),
      });
      res.json({ ok: true, vaults });
    } catch (error) {
      res.status(200).json({ ok: false, error: getErrorMessage(error) });
    }
  },
);

export default router;
