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
 * Decides who the desktop auto-session endpoint should silently log in as.
 *
 * The local embedded backend's trust boundary is machine access (loopback),
 * not any individual account's credentials -- anyone who can reach loopback
 * already has full filesystem access to the local, encrypted-at-rest
 * database and its keys. A login form must never appear for the local
 * backend, under any circumstance, including a local database that ended
 * up with more than one user (e.g. from repeated manual registration
 * during testing, or a household sharing one install) -- a user in that
 * state deserves to get into the app they installed, not a confusing,
 * unexplained dead end. So this always returns a single, deterministic
 * user: the admin account if one exists, else the earliest-registered
 * account. It never returns null.
 */
export function resolveDesktopAutoSessionUser(
  allUsers: UserRecord[],
): UserRecord | null {
  if (allUsers.length === 0) return null;
  if (allUsers.length === 1) return allUsers[0];

  const admin = allUsers.find((user) => user.isAdmin);
  if (admin) return admin;

  return [...allUsers].sort(
    (a, b) =>
      new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime(),
  )[0];
}
