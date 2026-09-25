/**
 * The one place a login becomes a session: JWT, cookie, response body,
 * audit line and the user_login internal event. Every login method ends here, so
 * they all behave the same way.
 */

import type { Request, Response } from "express";
import { AuthManager } from "../utils/auth-manager.js";
import { authLogger } from "../utils/logger.js";
import { loginRateLimiter } from "../utils/login-rate-limiter.js";
import { logAudit, getRequestMeta } from "../utils/audit-logger.js";
import { parseUserAgent } from "../utils/user-agent-parser.js";
import { emitInternalEvent } from "../hosts/internal-events.js";
import {
  createCurrentSettingsRepository,
  createCurrentUserAuthRepository,
} from "../database/repositories/factory.js";
import type { UserRecord } from "../database/repositories/user-repository.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function isNativeAppRequest(req: Request): boolean {
  return (
    (req.get("User-Agent") || "").startsWith("Termix-Mobile/") ||
    req.get("X-Electron-App") === "true"
  );
}

/** Cookie lifetime: 30 days when remembered, else session_timeout_hours. */
async function sessionCookieMaxAge(rememberMe: boolean): Promise<number> {
  if (rememberMe) return THIRTY_DAYS_MS;
  const value = await createCurrentSettingsRepository().get(
    "session_timeout_hours",
  );
  const hours = value ? parseInt(value, 10) || 24 : 24;
  return hours * 60 * 60 * 1000;
}

export async function syncSharedCredentialsForUserRoles(
  userId: string,
  operation: string,
): Promise<void> {
  try {
    const { SharedHostSecretsManager } =
      await import("../utils/shared-host-secrets-manager.js");
    await SharedHostSecretsManager.getInstance().snapshotForUserRoles(userId);
    const { SharedCredentialSecretsManager } =
      await import("../utils/shared-credential-secrets-manager.js");
    await SharedCredentialSecretsManager.getInstance().snapshotForUserRoles(
      userId,
    );
  } catch (error) {
    authLogger.warn("Failed to sync role shared host secrets", {
      operation,
      userId,
      error,
    });
  }
}

export interface IssueSessionOptions {
  methodId: string;
  rememberMe: boolean;
  /** Username the rate limiter counted attempts under, to clear them. */
  rateLimitUsername?: string;
  ssoProviderId?: number | null;
  oidcSub?: string | null;
  oidcSid?: string | null;
  /** SSO logins keep desktop and mobile apps signed in for 30 days. */
  longLivedForApps?: boolean;
}

export interface IssuedSession {
  token: string;
  maxAge: number;
  body: Record<string, unknown>;
}

/**
 * Mints the JWT and writes the audit line. The caller decides how the token
 * reaches the client: a JSON body with a cookie, or a redirect.
 */
export async function issueSession(
  req: Request,
  user: UserRecord,
  options: IssueSessionOptions,
): Promise<IssuedSession> {
  const authManager = AuthManager.getInstance();
  const deviceInfo = parseUserAgent(req);

  const token = await authManager.generateJWTToken(user.id, {
    rememberMe: options.rememberMe,
    deviceType: deviceInfo.type,
    deviceInfo: deviceInfo.deviceInfo,
    oidcSub: options.oidcSub ?? null,
    oidcSid: options.oidcSid ?? null,
    ssoProviderId: options.ssoProviderId ?? null,
  });

  if (options.rateLimitUsername) {
    const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
    loginRateLimiter.resetAttempts(clientIp, options.rateLimitUsername);
  }

  const { ipAddress, userAgent } = getRequestMeta(req);
  await logAudit({
    userId: user.id,
    username: user.username,
    action: "login",
    resourceType: "session",
    details: JSON.stringify({ method: options.methodId }),
    ipAddress,
    userAgent,
    success: true,
  });
  emitInternalEvent("user_login", user.id, undefined, {
    username: user.username,
    ipAddress,
  });

  authLogger.success("User login successful", {
    operation: "user_login_complete",
    userId: user.id,
    username: user.username,
    method: options.methodId,
  });

  const maxAge =
    options.longLivedForApps &&
    (deviceInfo.type === "desktop" || deviceInfo.type === "mobile")
      ? THIRTY_DAYS_MS
      : await sessionCookieMaxAge(options.rememberMe);

  return {
    token,
    maxAge,
    body: {
      success: true,
      is_admin: !!user.isAdmin,
      username: user.username,
      userId: user.id,
      is_oidc: !!user.isOidc,
      // Any second factor; the name is what 2.8 clients read.
      totp_enabled: await createCurrentUserAuthRepository().hasSecondFactor(
        user.id,
      ),
      ...(isNativeAppRequest(req) ? { token } : {}),
    },
  };
}

/** Sets the cookie and sends the body. */
export function sendSession(
  req: Request,
  res: Response,
  session: IssuedSession,
): Response {
  const authManager = AuthManager.getInstance();
  return res
    .cookie(
      "jwt",
      session.token,
      authManager.getSecureCookieOptions(req, session.maxAge),
    )
    .json(session.body);
}
