import { ElevationError } from "@termix/plugin-sdk/host-commands";
import type { Request, Response } from "express";
import type { Client } from "ssh2";
import type { PluginHostShareLevel } from "@termix/plugin-sdk/backend";
import { errorMessage } from "../util.js";
import type { MetricsLogger } from "../log.js";
import type { ManagerHost, RunOnHost } from "./types.js";

export class AccessDeniedError extends Error {
  constructor(message = "No access to this host") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export class ManagerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagerInputError";
  }
}

/**
 * Wrap a manager handler: parses hostId, runs `fn` on a pooled connection at the
 * given access level, and maps known errors to clean HTTP responses.
 */
export function managerHandler(
  { runOnHost, log }: { runOnHost: RunOnHost; log: MetricsLogger },
  level: PluginHostShareLevel,
  operation: string,
  fn: (client: Client, host: ManagerHost, req: Request) => Promise<unknown>,
) {
  return async (req: Request, res: Response) => {
    const hostId = parseInt(String(req.params.id), 10);
    try {
      const result = await runOnHost(hostId, level, (client, host) =>
        fn(client, host, req),
      );
      return res.json(result);
    } catch (error) {
      if (error instanceof ManagerInputError) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof AccessDeniedError) {
        return res.status(403).json({ error: error.message });
      }
      if (error instanceof ElevationError) {
        return res.status(403).json({ error: error.message, code: error.code });
      }
      log.error(`Manager operation failed: ${operation}`, {
        operation,
        hostId,
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        error: errorMessage(error, "Operation failed"),
      });
    }
  };
}
