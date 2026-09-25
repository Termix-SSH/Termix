import { getErrorMessage } from "../../utils/error-message.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import { authLogger } from "../../utils/logger.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";
import { createCurrentUserRepository } from "../repositories/factory.js";
import type { UserRecord } from "../repositories/user-repository.js";
import { TlsValidationError } from "../../tls/certificate.js";
import {
  getTlsStatus,
  reloadTls,
  writeTlsCertificate,
} from "../../tls/tls-service.js";

async function getAdminActor(
  userId: string | undefined,
): Promise<UserRecord | null> {
  if (!userId) return null;
  const user = await createCurrentUserRepository().findById(userId);
  return user?.isAdmin ? user : null;
}

export function registerTlsRoutes(
  router: Router,
  authenticateJWT: RequestHandler,
): void {
  /**
   * @openapi
   * /users/tls-certificate:
   *   get:
   *     summary: Get the served TLS certificate (admin only)
   *     description: Returns whether HTTPS is on, the certificate core serves, and the plugin that renews it, if any.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Certificate status.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Failed to read the certificate.
   */
  router.get("/tls-certificate", authenticateJWT, async (req, res) => {
    try {
      const actor = await getAdminActor((req as AuthenticatedRequest).userId);
      if (!actor) {
        return res.status(403).json({ error: "Not authorized" });
      }
      res.json(await getTlsStatus());
    } catch (err) {
      authLogger.error("Failed to read TLS certificate status", err);
      res.status(500).json({ error: "Failed to read TLS certificate status" });
    }
  });

  /**
   * @openapi
   * /users/tls-certificate:
   *   post:
   *     summary: Upload a TLS certificate and key (admin only)
   *     description: Validates a PEM certificate chain and private key, installs them as the served certificate and reloads HTTPS without a restart.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               certificate:
   *                 type: string
   *               privateKey:
   *                 type: string
   *     responses:
   *       200:
   *         description: Certificate installed. Carries the new status and a reload message.
   *       400:
   *         description: Missing, unreadable, expired or mismatched certificate and key.
   *       403:
   *         description: Not authorized.
   *       500:
   *         description: Certificate installation failed.
   */
  router.post("/tls-certificate", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const actor = await getAdminActor(userId);
    if (!actor) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const { ipAddress, userAgent } = getRequestMeta(req);
    const audit = (success: boolean, details: object, errorMessage?: string) =>
      logAudit({
        userId,
        username: actor.username ?? userId,
        action: "tls_certificate_upload",
        resourceType: "setting",
        details: JSON.stringify(details),
        ipAddress,
        userAgent,
        success,
        errorMessage,
      });

    try {
      const { certificate, privateKey } = req.body ?? {};
      const info = await writeTlsCertificate(certificate, privateKey);
      const reload = await reloadTls();
      await audit(true, { subject: info.subject, notAfter: info.notAfter });
      res.json({
        success: true,
        reloadMessage: reload.message,
        ...(await getTlsStatus()),
      });
    } catch (err) {
      const message = getErrorMessage(err);
      await audit(false, {}, message);
      if (err instanceof TlsValidationError) {
        return res.status(400).json({ error: message });
      }
      authLogger.error("TLS certificate upload failed", err);
      res
        .status(500)
        .json({ error: `Certificate installation failed: ${message}` });
    }
  });
}
