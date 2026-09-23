/**
 * Every login runs through here:
 *
 *   method -> verified identity -> find or provision the user -> unlock the
 *   data key -> second factors (fail closed) -> session
 *
 * A method never mints a session. It says who the user is and core does the
 * rest, so password, passkey, OIDC, LDAP and any plugin method get the same
 * second factors, the same cookie and the same audit line.
 */

import crypto from "crypto";
import type { Request, Response } from "express";
import { AuthManager } from "../utils/auth-manager.js";
import { loginRateLimiter } from "../utils/login-rate-limiter.js";
import { authLogger } from "../utils/logger.js";
import {
  generateDeviceFingerprint,
  getDeviceId,
  parseUserAgent,
} from "../utils/user-agent-parser.js";
import { logAudit, getRequestMeta } from "../utils/audit-logger.js";
import {
  createCurrentUserAuthRepository,
  createCurrentUserRepository,
} from "../database/repositories/factory.js";
import type { UserRecord } from "../database/repositories/user-repository.js";
import { ensureCoreLoginProviders } from "./core-auth.js";
import { findOrProvisionExternalUser } from "./provisioning.js";
import {
  getSecondFactor,
  listSecondFactors,
  type SecondFactor,
} from "./registry.js";
import {
  issueSession,
  sendSession,
  syncSharedCredentialsForUserRoles,
} from "./session-issuer.js";
import {
  LoginMethodError,
  type PendingLogin,
  type VerifiedIdentity,
} from "./types.js";

const PENDING_TTL_MS = 10 * 60 * 1000;
export const PENDING_LOGIN_COOKIE = "termix_pending_login";

const pendingLogins = new Map<string, PendingLogin>();

function prunePending(now = Date.now()): void {
  for (const [key, pending] of pendingLogins) {
    if (now - pending.createdAt > PENDING_TTL_MS) pendingLogins.delete(key);
  }
}

function pendingKey(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Test helper. */
export function resetPendingLoginsForTests(): void {
  pendingLogins.clear();
}

export interface SecondFactorState {
  /** Factors the user must pass, all with an active provider. */
  required: SecondFactor[];
  /** Enrolled in a factor whose plugin is disabled or missing. */
  blocked: { pluginId: string; factorId: string }[];
}

/**
 * Which second factors apply to a user. A factor recorded in
 * user_second_factors whose plugin is not running blocks the login: skipping
 * it would turn "disable the plugin" into "remove everyone's 2FA".
 */
export async function evaluateSecondFactors(
  userId: string,
): Promise<SecondFactorState> {
  ensureCoreLoginProviders();
  const rows =
    await createCurrentUserAuthRepository().listSecondFactors(userId);
  const required = new Map<string, SecondFactor>();
  const blocked: SecondFactorState["blocked"] = [];

  for (const row of rows) {
    const factor = getSecondFactor(row.pluginId, row.factorId);
    if (!factor) {
      blocked.push({ pluginId: row.pluginId, factorId: row.factorId });
      continue;
    }
    required.set(`${factor.pluginId}:${factor.id}`, factor);
  }

  // A factor can also report enrolment itself, for data from before
  // user_second_factors existed.
  for (const factor of listSecondFactors()) {
    const key = `${factor.pluginId}:${factor.id}`;
    if (required.has(key)) continue;
    try {
      if (await factor.isEnrolled(userId)) required.set(key, factor);
    } catch (error) {
      authLogger.warn("Second factor enrolment check failed", {
        operation: "second_factor_enrolment_check",
        factorId: factor.id,
        error,
      });
    }
  }

  return { required: [...required.values()], blocked };
}

async function isTrustedDevice(req: Request, userId: string): Promise<boolean> {
  const deviceInfo = parseUserAgent(req);
  const fingerprint = generateDeviceFingerprint(deviceInfo, getDeviceId(req));
  if (!fingerprint) return false;
  const trusted = await AuthManager.getInstance().isTrustedDevice(
    userId,
    fingerprint,
  );
  if (trusted) {
    authLogger.info("Second factor bypassed for trusted device", {
      operation: "totp_bypass",
      userId,
      deviceFingerprint: fingerprint,
    });
  }
  return trusted;
}

type DeviceType = ReturnType<typeof parseUserAgent>["type"];

async function resolveUser(
  identity: VerifiedIdentity,
  deviceType: DeviceType,
): Promise<UserRecord> {
  if (identity.kind === "external") {
    return findOrProvisionExternalUser(identity, deviceType);
  }
  const user = await createCurrentUserRepository().findById(identity.userId);
  if (!user)
    throw new LoginMethodError("User not found", 404, "user_not_found");
  return user;
}

/**
 * Unlocks the user's data key. A password login migrates and opens the key
 * with the password; everything else uses the server-held wrapping.
 */
async function unlockUser(
  user: UserRecord,
  identity: VerifiedIdentity,
  deviceType: DeviceType,
): Promise<void> {
  const authManager = AuthManager.getInstance();

  if (identity.kind === "external" || user.isOidc) {
    try {
      await authManager.authenticateOIDCUser(user.id, deviceType);
    } catch (error) {
      authLogger.error("Failed to set up external user encryption", error, {
        operation: "external_user_encryption_setup_failed",
        userId: user.id,
      });
    }
    return;
  }

  const ok = identity.password
    ? await authManager.authenticateUser(user.id, identity.password, deviceType)
    : await authManager.authenticateWebAuthnUser(user.id, deviceType);
  if (!ok) {
    throw new LoginMethodError(
      identity.password
        ? "Incorrect password"
        : (identity.unlockError ?? "This account could not be unlocked"),
      401,
      "unlock_failed",
    );
  }
}

export interface LoginContext {
  methodId: string;
  rememberMe: boolean;
  /** Username the rate limiter counted, cleared on success. */
  rateLimitUsername?: string;
}

export type LoginResult =
  | {
      kind: "session";
      token: string;
      maxAge: number;
      body: Record<string, unknown>;
    }
  | {
      kind: "second-factor";
      tempToken: string;
      factors: Array<{ id: string; pluginId: string; labelKey: string }>;
      rememberMe: boolean;
    };

/**
 * Takes a verified identity to either a session or a second-factor step.
 * Throws LoginMethodError for anything the user should be told.
 */
export async function runLogin(
  req: Request,
  identity: VerifiedIdentity,
  context: LoginContext,
): Promise<LoginResult> {
  const deviceType = parseUserAgent(req).type;
  const user = await resolveUser(identity, deviceType);

  await unlockUser(user, identity, deviceType);
  await syncSharedCredentialsForUserRoles(
    user.id,
    `${context.methodId}_role_shared_credentials`,
  );

  const factors = await evaluateSecondFactors(user.id);
  if (factors.blocked.length > 0) {
    authLogger.warn("Login refused: an enrolled second factor is unavailable", {
      operation: "second_factor_unavailable",
      userId: user.id,
      factors: factors.blocked,
    });
    const { ipAddress, userAgent } = getRequestMeta(req);
    await logAudit({
      userId: user.id,
      username: user.username,
      action: "login_blocked_second_factor",
      resourceType: "session",
      details: JSON.stringify({ unavailable: factors.blocked }),
      ipAddress,
      userAgent,
      success: false,
      errorMessage: "Enrolled second factor unavailable",
    });
    throw new LoginMethodError(
      "Your account uses a second factor that is not available right now. Contact an admin to reset it.",
      403,
      "second_factor_unavailable",
    );
  }

  const ssoClaims = {
    ssoProviderId: identity.ssoProviderId ?? null,
    oidcSub: identity.oidcSub ?? null,
    oidcSid: identity.oidcSid ?? null,
  };

  if (
    factors.required.length > 0 &&
    !identity.mfaSatisfied &&
    !(await isTrustedDevice(req, user.id))
  ) {
    const tempToken = await AuthManager.getInstance().generateJWTToken(
      user.id,
      { pendingTOTP: true, expiresIn: "10m" },
    );
    prunePending();
    pendingLogins.set(pendingKey(tempToken), {
      userId: user.id,
      methodId: context.methodId,
      rememberMe: context.rememberMe,
      ...ssoClaims,
      createdAt: Date.now(),
    });
    return {
      kind: "second-factor",
      tempToken,
      rememberMe: context.rememberMe,
      factors: factors.required.map((factor) => ({
        id: factor.id,
        pluginId: factor.pluginId,
        labelKey: factor.labelKey,
      })),
    };
  }

  const session = await issueSession(req, user, {
    methodId: context.methodId,
    rememberMe: context.rememberMe,
    rateLimitUsername: context.rateLimitUsername ?? identity.rateLimitUsername,
    longLivedForApps: identity.kind === "external",
    ...ssoClaims,
  });
  return { kind: "session", ...session };
}

/** JSON form of a login result, the shape the login screen expects. */
export function secondFactorBody(
  result: Extract<LoginResult, { kind: "second-factor" }>,
): Record<string, unknown> {
  return {
    success: true,
    requires_totp: true,
    requires_second_factor: true,
    temp_token: result.tempToken,
    rememberMe: result.rememberMe,
    second_factors: result.factors,
  };
}

/** Runs a form login and writes the response. */
export async function respondWithLogin(
  req: Request,
  res: Response,
  identity: VerifiedIdentity,
  context: LoginContext,
): Promise<Response> {
  const result = await runLogin(req, identity, context);
  if (result.kind === "second-factor") {
    return res.json(secondFactorBody(result));
  }
  return sendSession(req, res, result);
}

export function sendLoginError(res: Response, error: unknown): Response {
  if (error instanceof LoginMethodError) {
    const remainingTime = (error as { remainingTime?: number }).remainingTime;
    return res.status(error.status).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(remainingTime !== undefined ? { remainingTime } : {}),
    });
  }
  authLogger.error("Login failed", error);
  return res.status(500).json({ error: "Login failed" });
}

export interface PendingLoginLookup {
  userId: string;
  token: string;
  pending: PendingLogin | null;
}

/** Checks a pending token from the body or the redirect cookie. */
export async function readPendingLogin(
  req: Request,
): Promise<PendingLoginLookup | null> {
  const token =
    (typeof req.body?.temp_token === "string" && req.body.temp_token) ||
    (req.cookies?.[PENDING_LOGIN_COOKIE] as string | undefined);
  if (!token) return null;
  const decoded = await AuthManager.getInstance().verifyJWTToken(token);
  if (!decoded || !decoded.pendingTOTP) return null;
  prunePending();
  const pending = pendingLogins.get(pendingKey(token)) ?? null;
  return { userId: decoded.userId, token, pending };
}

export function consumePendingLogin(token: string): void {
  pendingLogins.delete(pendingKey(token));
}

/**
 * Finishes a login that stopped for a second factor. The pending token comes
 * from the body, or from the cookie a redirect method set.
 */
export async function verifySecondFactorAndRespond(
  req: Request,
  res: Response,
  factorId: string,
): Promise<Response> {
  const lookup = await readPendingLogin(req);
  if (!lookup) {
    return res.status(401).json({ error: "Invalid temporary token" });
  }

  const user = await createCurrentUserRepository().findById(lookup.userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const lockStatus = loginRateLimiter.isTOTPLocked(user.id);
  if (lockStatus.locked) {
    authLogger.warn("Second factor blocked due to rate limiting", {
      operation: "totp_verify_blocked",
      userId: user.id,
      remainingTime: lockStatus.remainingTime,
    });
    return res.status(429).json({
      error: `Rate limited: Too many TOTP verification attempts. Please wait ${lockStatus.remainingTime} seconds before trying again.`,
      remainingTime: lockStatus.remainingTime,
      code: "TOTP_RATE_LIMITED",
    });
  }
  loginRateLimiter.recordFailedTOTPAttempt(user.id);

  const factors = await evaluateSecondFactors(user.id);
  if (factors.blocked.length > 0) {
    return res.status(403).json({
      error:
        "Your account uses a second factor that is not available right now. Contact an admin to reset it.",
      code: "second_factor_unavailable",
    });
  }
  const factor = factors.required.find(
    (candidate) => candidate.id === factorId,
  );
  if (!factor) {
    return res
      .status(400)
      .json({ error: "That second factor is not enabled for this user" });
  }

  const result = await factor.verify(user.id, req.body ?? {});
  if (result !== true) {
    if (result && typeof result === "object") {
      return res.status(result.code === "SESSION_EXPIRED" ? 401 : 400).json({
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
      });
    }
    authLogger.warn("Second factor verification failed", {
      operation: "totp_verify_failed",
      userId: user.id,
      factorId,
    });
    const { ipAddress, userAgent } = getRequestMeta(req);
    await logAudit({
      userId: user.id,
      username: user.username,
      action: "login_second_factor_failed",
      resourceType: "session",
      details: JSON.stringify({ factor: factorId }),
      ipAddress,
      userAgent,
      success: false,
    });
    return res.status(401).json({
      error: "Invalid TOTP code",
      remainingAttempts: loginRateLimiter.getRemainingTOTPAttempts(user.id),
    });
  }
  loginRateLimiter.resetTOTPAttempts(user.id);

  const rememberMe =
    typeof req.body?.rememberMe === "boolean"
      ? req.body.rememberMe
      : (lookup.pending?.rememberMe ?? false);

  if (rememberMe) {
    const deviceInfo = parseUserAgent(req);
    const fingerprint = generateDeviceFingerprint(deviceInfo, getDeviceId(req));
    if (fingerprint) {
      await AuthManager.getInstance().addTrustedDevice(
        user.id,
        fingerprint,
        deviceInfo.type,
        deviceInfo.deviceInfo,
      );
      authLogger.info("Device automatically trusted via Remember Me", {
        operation: "totp_auto_trust",
        userId: user.id,
        deviceType: deviceInfo.type,
      });
    }
  }

  const pending = lookup.pending;
  const session = await issueSession(req, user, {
    methodId: pending?.methodId ?? "password",
    rememberMe,
    ssoProviderId: pending?.ssoProviderId ?? null,
    oidcSub: pending?.oidcSub ?? null,
    oidcSid: pending?.oidcSid ?? null,
  });

  consumePendingLogin(lookup.token);
  res.clearCookie(
    PENDING_LOGIN_COOKIE,
    AuthManager.getInstance().getClearCookieOptions(req),
  );
  return sendSession(req, res, session);
}

/**
 * Finishes a redirect login (OIDC and friends): back to where the browser
 * came from, with a cookie, or with the token in the URL for the desktop and
 * mobile app callbacks that cannot read one.
 */
export async function respondWithRedirectLogin(
  req: Request,
  res: Response,
  identity: VerifiedIdentity,
  context: LoginContext,
  isTokenCallback: (url: string) => boolean,
): Promise<void> {
  const returnTo = identity.returnTo;
  if (!returnTo) {
    res.status(500).json({ error: "Login method did not say where to return" });
    return;
  }
  const authManager = AuthManager.getInstance();

  let result: LoginResult;
  try {
    result = await runLogin(req, identity, context);
  } catch (error) {
    redirectWithLoginError(res, returnTo, error);
    return;
  }

  const url = new URL(returnTo);
  const tokenCallback = isTokenCallback(returnTo);
  res.clearCookie("jwt", authManager.getClearCookieOptions(req));

  if (result.kind === "second-factor") {
    url.searchParams.set("second_factor", "1");
    url.searchParams.set(
      "second_factors",
      result.factors.map((factor) => factor.id).join(","),
    );
    if (tokenCallback) {
      url.searchParams.set("temp_token", result.tempToken);
      res.redirect(url.toString());
      return;
    }
    res
      .cookie(
        PENDING_LOGIN_COOKIE,
        result.tempToken,
        authManager.getSecureCookieOptions(req, PENDING_TTL_MS),
      )
      .redirect(url.toString());
    return;
  }

  url.searchParams.set("success", "true");
  if (tokenCallback) {
    url.searchParams.set("token", result.token);
    res.redirect(url.toString());
    return;
  }
  res
    .cookie(
      "jwt",
      result.token,
      authManager.getSecureCookieOptions(req, result.maxAge),
    )
    .redirect(url.toString());
}

export function redirectWithLoginError(
  res: Response,
  returnTo: string,
  error: unknown,
): void {
  if (!(error instanceof LoginMethodError)) {
    authLogger.error("Redirect login failed", error);
  }
  const url = new URL(returnTo);
  url.searchParams.set(
    "error",
    error instanceof LoginMethodError
      ? (error.code ?? error.message)
      : "OIDC authentication failed",
  );
  res.redirect(url.toString());
}
