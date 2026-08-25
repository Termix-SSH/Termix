import type { Request } from "express";
import type { UserRecord } from "../repositories/user-repository.js";

/**
 * The auto-session endpoint hands out a full session for the local account
 * without any credential, so it must only exist where that trade is actually
 * intended: the Electron build, whose trust boundary is machine access.
 * `ELECTRON_EMBEDDED` is set by electron/main.cjs when it spawns the embedded
 * backend and by nothing else, so a server deployment never enables it.
 *
 * Without this gate the endpoint stays mounted on every server install and its
 * only defense is the loopback heuristic below - which holds for the bundled
 * nginx, but silently turns into an unauthenticated admin login as soon as the
 * backend is fronted by some other loopback proxy that does not set
 * `X-Real-IP`.
 */
export function isDesktopAutoSessionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.ELECTRON_EMBEDDED === "true";
}

export function isLoopbackRequest(req: Request): boolean {
  // Requests relayed by the bundled nginx always carry X-Real-IP, which
  // nginx overwrites with the actual client address -- so its presence
  // means the caller reached the backend through the reverse proxy and is
  // not a local process, whatever the TCP peer address says (it is nginx
  // itself on loopback). Everything else is judged by the TCP peer
  // address, which no client-supplied header can influence: with
  // `trust proxy = true`, req.ip comes from X-Forwarded-For and would let
  // any remote caller claim to be loopback.
  if (req.headers["x-real-ip"]) return false;

  const ip = req.socket?.remoteAddress || "";
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
