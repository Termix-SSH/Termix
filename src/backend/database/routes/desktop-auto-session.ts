import type { Request } from "express";
import type { UserRecord } from "../repositories/user-repository.js";

export function isLoopbackRequest(req: Request): boolean {
  const ip = req.ip || req.socket?.remoteAddress || "";
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.endsWith(":127.0.0.1")
  );
}

export function extractBearerOrCookieToken(req: Request): string | undefined {
  const cookieToken = (req as Request & { cookies?: Record<string, string> })
    .cookies?.jwt;
  if (cookieToken) return cookieToken;

  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }
  return undefined;
}

/**
 * Decides whether the desktop auto-session endpoint should mint a session
 * for the given set of local users, and for whom.
 *
 * The local embedded backend's trust boundary is machine access (loopback),
 * not any individual account's credentials -- anyone who can reach loopback
 * already has full filesystem access to the local, encrypted-at-rest
 * database and its keys. So the sole local user is always eligible here
 * regardless of whether it has a password, OIDC identity, or TOTP
 * configured. This only ever declines when the local database has more
 * than one user (never produced by sync -- user accounts are never synced
 * -- but reachable via manual registration), since there'd be no way to
 * know which account to log into.
 */
export function resolveDesktopAutoSessionUser(
  allUsers: UserRecord[],
): UserRecord | null {
  if (allUsers.length !== 1) return null;
  return allUsers[0];
}
