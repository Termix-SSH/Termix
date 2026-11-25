import type { NextFunction, Request, Response } from "express";
import { markChanged, markUserChanged } from "./feed.js";
import { notifyLocalWrite } from "./write-listeners.js";

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

const GLOBAL_PATH_PREFIXES = [
  "/rbac",
  "/users/admin",
  "/users/make-admin",
  "/users/remove-admin",
  "/host/share",
  "/database/restore",
  "/encryption/",
  "/plugins",
  "/plugin-api",
  "/version/",
];

interface SyncWatcherRequest extends Request {
  userId?: string;
  actingAdminUserId?: string;
}

export function isGlobalChangePath(path: string): boolean {
  for (const prefix of GLOBAL_PATH_PREFIXES) {
    if (
      path === prefix ||
      path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) ||
      (prefix === "/users/admin" && path.startsWith("/users/admin-"))
    ) {
      return true;
    }
  }
  return /(?:^|\/)share(?:\/|$)/.test(path);
}

/**
 * Any successful write may change what a linked desktop should have, so it
 * nudges the change feed. Sync's own pushes reconcile themselves.
 *
 * Single-user writes mark only the affected user(s) dirty so one user's
 * activity does not trigger full-table decrypt/diff for every online user.
 * Cross-user, shared, RBAC/admin, and unauthenticated writes fall back to
 * a global markChanged().
 */
export function syncChangeWatcher(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!READS.has(req.method) && !req.path.startsWith("/sync/")) {
    const authReq = req as SyncWatcherRequest;
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      const userId = authReq.userId;
      if (!userId || isGlobalChangePath(req.path)) {
        markChanged();
      } else {
        markUserChanged(userId);
        if (authReq.actingAdminUserId && authReq.actingAdminUserId !== userId) {
          markUserChanged(authReq.actingAdminUserId);
        }
      }
      notifyLocalWrite();
    });
  }
  next();
}
