/**
 * Password login, core's one built-in method. It only proves who the user is;
 * the pipeline does second factors and the session.
 */

import bcrypt from "bcryptjs";
import { authLogger } from "../utils/logger.js";
import { loginRateLimiter } from "../utils/login-rate-limiter.js";
import { isTrustedProxyAuthEnabled } from "../utils/trusted-proxy-auth.js";
import { createCurrentUserRepository } from "../database/repositories/factory.js";
import { getPasswordLoginStatus } from "./core-auth.js";
import { registerLoginMethod, type LoginMethod } from "./registry.js";
import { LoginMethodError, type VerifiedIdentity } from "./types.js";

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
    loginRateLimiter.recordFailedAttempt(clientIp, username);
    authLogger.warn("Login failed: user not found", {
      operation: "user_login",
      username,
      ip: clientIp,
    });
    throw new LoginMethodError("Invalid username or password", 401);
  }

  if (user.isOidc && (!user.passwordHash || user.passwordHash.trim() === "")) {
    authLogger.warn("OIDC-only user attempted traditional login", {
      operation: "user_login",
      username,
      userId: user.id,
    });
    throw new LoginMethodError("This user uses external authentication", 403);
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
