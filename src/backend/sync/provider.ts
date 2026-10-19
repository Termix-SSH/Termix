/**
 * The sync provider: a plugin that answers /sync/v2 and /sync/link through
 * ctx.sync.provide. Core only forwards. With no provider the paths answer 404,
 * so a server without it looks like one that never had sync.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { PluginSyncProvider } from "@termix-ssh/plugin-sdk/backend";
import { syncLogger } from "../utils/logger.js";

interface Entry {
  pluginId: string;
  provider: PluginSyncProvider;
}

const providers = new Map<symbol, Entry>();

export function provideSync(
  pluginId: string,
  provider: PluginSyncProvider,
): () => void {
  const key = Symbol(pluginId);
  providers.set(key, { pluginId, provider });
  return () => {
    providers.delete(key);
  };
}

/** Test seam. */
export function clearSyncProviders(): void {
  providers.clear();
}

export function hasSyncProvider(): boolean {
  return providers.size > 0;
}

/** Sends the request to the first provider that does not pass. */
export const syncForwarder: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const entries = [...providers.values()];
  const run = (index: number): void => {
    const entry = entries[index];
    if (!entry) {
      next();
      return;
    }
    const pass = (error?: unknown): void => {
      if (error) next(error);
      else run(index + 1);
    };
    try {
      const result = entry.provider.handle(req, res, pass);
      if (result && typeof result.catch === "function") {
        result.catch((error: unknown) => fail(entry, error, res, next));
      }
    } catch (error) {
      fail(entry, error, res, next);
    }
  };
  run(0);
};

function fail(
  entry: Entry,
  error: unknown,
  res: Response,
  next: NextFunction,
): void {
  syncLogger.warn("Sync provider failed", {
    operation: "sync_provider",
    pluginId: entry.pluginId,
    error: error instanceof Error ? error.message : String(error),
  });
  if (res.headersSent) next(error);
  else res.status(500).json({ error: "Sync is not available right now" });
}
