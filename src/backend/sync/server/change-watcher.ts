import type { NextFunction, Request, Response } from "express";
import { markChanged } from "./feed.js";
import { notifyLocalWrite } from "./write-listeners.js";

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Any successful write may change what a linked desktop should have, so it
 * nudges the change feed. Sync's own pushes reconcile themselves.
 */
export function syncChangeWatcher(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!READS.has(req.method) && !req.path.startsWith("/sync/")) {
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      markChanged();
      notifyLocalWrite();
    });
  }
  next();
}
