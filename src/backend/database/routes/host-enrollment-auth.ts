import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { DataCrypto } from "../../utils/data-crypto.js";

export function applyHostEnrollmentDefaults(
  hostData: Record<string, unknown>,
): Record<string, unknown> {
  return {
    connectionType: "ssh",
    port: 22,
    authType: "none",
    enableTerminal: true,
    enableSsh: true,
    ...hostData,
  };
}

export function requireHostEnrollmentAccessForPath(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.path !== "/enroll") {
    next();
    return;
  }

  const authReq = req as AuthenticatedRequest;
  if (!authReq.apiKeyId) {
    res.status(401).json({
      error: "Host enrollment requires an API key",
      code: "API_KEY_REQUIRED",
    });
    return;
  }

  if (!DataCrypto.canUserAccessData(authReq.userId)) {
    res.status(423).json({
      error: "User data is locked. Sign in before enrolling hosts.",
      code: "DATA_LOCKED",
    });
    return;
  }

  next();
}
