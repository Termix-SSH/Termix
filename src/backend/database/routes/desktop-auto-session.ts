import type { Request } from "express";
import type { UserRecord } from "../repositories/user-repository.js";
import { isDesktopAppOrigin } from "../../utils/cors-config.js";

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

/**
 * Whether this backend may hand out the desktop auto-session at all: the
 * embedded desktop backend, or a development backend the desktop app points
 * at. A production server never does, whoever asks.
 */
export function allowsDesktopAutoSession(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.ELECTRON_EMBEDDED === "true" || env.NODE_ENV !== "production";
}

/** Why the auto-session must be refused for this request, or null. */
export function desktopAutoSessionRefusal(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!allowsDesktopAutoSession(env)) return "not a desktop backend";
  if (!isLoopbackRequest(req)) return "not loopback";
  const origin = req.headers.origin;
  if (origin !== undefined && !isDesktopAppOrigin(origin)) return "origin";
  // A custom header makes any browser page send a CORS preflight first,
  // which a foreign origin fails.
  if (req.headers["x-electron-app"] !== "true") return "not the app";
  // The app's own page sits on another scheme, so it reads as cross site.
  // With no Origin to name it, a cross site call is someone else's page.
  const site = req.headers["sec-fetch-site"];
  if (!origin && (site === "cross-site" || site === "same-site")) {
    return "cross site";
  }
  return null;
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

export function isNativeTokenExportRequest(req: Request): boolean {
  const userAgent = req.get("user-agent") || "";
  return /^(Termix-Mobile|Termix-Desktop)\//.test(userAgent);
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
 * user: the account the user switched to if it still exists, else the admin
 * account if one exists, else the earliest-registered account. It never
 * returns null when there are users.
 */
export function resolveDesktopAutoSessionUser(
  allUsers: UserRecord[],
  preferredId?: string | null,
): UserRecord | null {
  if (allUsers.length === 0) return null;
  if (allUsers.length === 1) return allUsers[0];

  // An account the user switched to on purpose, while it still exists.
  const preferred = preferredId
    ? allUsers.find((user) => user.id === preferredId)
    : undefined;
  if (preferred) return preferred;

  const admin = allUsers.find((user) => user.isAdmin);
  if (admin) return admin;

  return [...allUsers].sort(
    (a, b) =>
      new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime(),
  )[0];
}
