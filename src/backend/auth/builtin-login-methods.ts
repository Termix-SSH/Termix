/**
 * Password login, core's one built-in method. It only proves who the user is;
 * the pipeline does second factors and the session.
 */

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { authLogger } from "../utils/logger.js";
import { loginRateLimiter } from "../utils/login-rate-limiter.js";
import { isTrustedProxyAuthEnabled } from "../utils/trusted-proxy-auth.js";
import { createCurrentUserRepository } from "../database/repositories/factory.js";
import { getPasswordLoginStatus } from "./core-auth.js";
import { registerLoginMethod, type LoginMethod } from "./registry.js";
import { LoginMethodError, type VerifiedIdentity } from "./types.js";

// Compared against when there is no usable hash, so a missing user takes as
// long as a wrong password. Same cost as real password hashes.
let dummyHash: Promise<string> | null = null;
function spendCompare(password: string): Promise<boolean> {
  dummyHash ??= bcrypt.hash(crypto.randomBytes(16).toString("hex"), 10);
  return dummyHash.then((hash) => bcrypt.compare(password, hash));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function verifyPasswordLogin(request: {
  body: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): Promise<VerifiedIdentity & { rateLimitUsername: string }> {
  if (isTrustedProxyAuthEnabled()) {
    throw new LoginMethodError(
      "Password login is disabled while trusted proxy authentication is enabled",
      403,
    );
  }

  const { username, password } = request.body;
  const clientIp = request.ip || request.socket?.remoteAddress || "unknown";

  if (!nonEmpty(username) || !nonEmpty(password)) {
    throw new LoginMethodError("Invalid username or password", 400);
  }

  const lockStatus = loginRateLimiter.isLocked(clientIp, username);
  if (lockStatus.locked) {
    authLogger.warn("Login attempt blocked due to rate limiting", {
      operation: "user_login_blocked",
      username,
      ip: clientIp,
      remainingTime: lockStatus.remainingTime,
    });
    const error = new LoginMethodError(
      "Too many login attempts. Please try again later.",
      429,
    );
    Object.assign(error, { remainingTime: lockStatus.remainingTime });
    throw error;
  }

  if (!(await getPasswordLoginStatus()).allowed) {
    throw new LoginMethodError(
      "Password authentication is currently disabled",
      403,
    );
  }

  const user = await createCurrentUserRepository().findByUsername(username);
  if (!user) {
    await spendCompare(password);
    loginRateLimiter.recordFailedAttempt(clientIp, username);
    authLogger.warn("Login failed: user not found", {
      operation: "user_login",
      username,
      ip: clientIp,
    });
    throw new LoginMethodError("Invalid username or password", 401);
  }

  if (
    user.isExternal &&
    (!user.passwordHash || user.passwordHash.trim() === "")
  ) {
    await spendCompare(password);
    loginRateLimiter.recordFailedAttempt(clientIp, username);
    authLogger.warn("External-only user attempted password login", {
      operation: "user_login",
      username,
      userId: user.id,
    });
    throw new LoginMethodError("Invalid username or password", 401);
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    loginRateLimiter.recordFailedAttempt(clientIp, username);
    authLogger.warn("Login failed: incorrect password", {
      operation: "user_login",
      username,
      userId: user.id,
      ip: clientIp,
    });
    throw new LoginMethodError("Invalid username or password", 401);
  }

  return {
    kind: "user",
    userId: user.id,
    password,
    rememberMe: !!request.body.rememberMe,
    rateLimitUsername: username,
  };
}

const passwordLoginMethod: LoginMethod = {
  id: "password",
  pluginId: "core",
  labelKey: "auth.password",
  kind: "form",
  describe: async () => {
    const status = await getPasswordLoginStatus();
    return [{ id: "password", label: "Password", enabled: status.allowed }];
  },
  verify: (request) => verifyPasswordLogin(request as never),
};

export function registerPasswordLoginMethod(): () => void {
  return registerLoginMethod(passwordLoginMethod);
}
