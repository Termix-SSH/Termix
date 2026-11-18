import type { Express, Request, RequestHandler, Response } from "express";
import {
  ExternalSecretError,
  SystemCrypto,
} from "../../utils/system-crypto.js";
import { rotateEncryptionKey } from "../../utils/key-rotation.js";
import { logAudit } from "../../utils/audit-logger.js";
import { apiLogger } from "../../utils/logger.js";
import { getClientIp } from "../../utils/request-origin.js";
import {
  createCurrentSessionRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";
import type { AuthenticatedRequest } from "../../../types/index.js";

async function audit(
  req: Request,
  action: string,
  success: boolean,
  details?: Record<string, unknown>,
): Promise<void> {
  const userId = (req as AuthenticatedRequest).userId;
  const user = userId
    ? await createCurrentUserRepository().findById(userId)
    : null;
  await logAudit({
    userId,
    username: user?.username ?? userId,
    action,
    resourceType: "system",
    details: details ? JSON.stringify(details) : null,
    ipAddress: getClientIp(req),
    userAgent: req.get("User-Agent") ?? null,
    success,
  });
}

function refuseExternal(res: Response, error: ExternalSecretError): void {
  res.status(409).json({
    error: error.message,
    code: "EXTERNAL_SECRET",
  });
}

/** Ends every session. Goes through the repository so sockets close too. */
async function revokeAllSessions(): Promise<number> {
  const repository = createCurrentSessionRepository();
  let count = 0;
  for (const session of await repository.listAll()) {
    if (await repository.revoke(session.id)) count++;
  }
  return count;
}

export function registerEncryptionRoutes(
  app: Express,
  requireAdmin: RequestHandler,
): void {
  const rotateJwt = async (req: Request, res: Response) => {
    try {
      await SystemCrypto.getInstance().rotateJWTSecret();
      const ended = await revokeAllSessions();
      apiLogger.warn("JWT secret rotated, every session ended", {
        operation: "jwt_secret_rotated",
        sessions: ended,
      });
      await audit(req, "rotate_jwt_secret", true, { sessions: ended });
      res.json({
        success: true,
        message: "JWT secret rotated. Everyone has to sign in again.",
        sessionsEnded: ended,
      });
    } catch (error) {
      if (error instanceof ExternalSecretError) {
        refuseExternal(res, error);
        return;
      }
      apiLogger.error("Failed to rotate JWT secret", error, {
        operation: "jwt_secret_rotate_failed",
      });
      await audit(req, "rotate_jwt_secret", false);
      res.status(500).json({ error: "Failed to rotate JWT secret" });
    }
  };

  /**
   * @openapi
   * /encryption/regenerate-jwt:
   *   post:
   *     summary: Rotate the JWT secret
   *     description: Replaces the JWT secret kept in the data folder's .env file and ends every session, so everyone signs in again. Refused when JWT_SECRET is set through the environment or JWT_SECRET_FILE. Admin only.
   *     tags:
   *       - Encryption
   *     responses:
   *       200:
   *         description: Secret rotated and sessions ended.
   *       409:
   *         description: The secret is set outside .env and must be rotated there.
   *       500:
   *         description: Failed to rotate the secret.
   */
  app.post("/encryption/regenerate-jwt", requireAdmin, rotateJwt);

  /**
   * @openapi
   * /encryption/regenerate:
   *   post:
   *     summary: Rotate the JWT secret (old path)
   *     description: Same as /encryption/regenerate-jwt.
   *     tags:
   *       - Encryption
   *     responses:
   *       200:
   *         description: Secret rotated and sessions ended.
   *       409:
   *         description: The secret is set outside .env and must be rotated there.
   *       500:
   *         description: Failed to rotate the secret.
   */
  app.post("/encryption/regenerate", requireAdmin, rotateJwt);

  /**
   * @openapi
   * /encryption/rotate-key:
   *   post:
   *     summary: Rotate the encryption key
   *     description: Replaces the ENCRYPTION_KEY kept in the data folder's .env file, re-wraps every user's data key and re-seals every stored secret with the new key. Sessions stay valid. Refused when ENCRYPTION_KEY is set through the environment or ENCRYPTION_KEY_FILE; use ENCRYPTION_KEY_PREVIOUS there. Admin only.
   *     tags:
   *       - Encryption
   *     responses:
   *       200:
   *         description: Key rotated, with counts of what moved.
   *       409:
   *         description: The key is set outside .env and must be rotated there.
   *       500:
   *         description: Failed to rotate the key.
   */
  app.post("/encryption/rotate-key", requireAdmin, async (req, res) => {
    try {
      const result = await rotateEncryptionKey();
      await audit(req, "rotate_encryption_key", true, { ...result });
      res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof ExternalSecretError) {
        refuseExternal(res, error);
        return;
      }
      apiLogger.error("Failed to rotate encryption key", error, {
        operation: "encryption_key_rotate_failed",
      });
      await audit(req, "rotate_encryption_key", false);
      res.status(500).json({ error: "Failed to rotate encryption key" });
    }
  });
}
