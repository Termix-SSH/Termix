import type { NextFunction, Request, Response } from "express";
import { markChanged } from "./feed.js";

const READS = new Set(["GET", "HEAD", "OPTIONS"]);
const writeListeners = new Set<() => void>();

/** Called after every successful write request, for a linked desktop's engine. */
export function onLocalWrite(listener: () => void): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

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
      for (const listener of writeListeners) listener();
    });
  }
  next();
}
