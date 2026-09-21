/**
 * Turns a plugin's registered routes into an Express router mounted on the
 * existing /plugin-api/:pluginId dispatcher.
 *
 * The plugin never sees the Express req/res objects. It gets a plain,
 * structured-cloneable summary of the request, and returns a plain object that
 * this module turns back into a response. That keeps sockets, headers carrying
 * session cookies, and the rest of the server's request context on this side of
 * the boundary.
 */

import express, { type Request, type Response, type Router } from "express";
import { pluginLogger } from "../utils/logger.js";
import type { PluginBroker, PluginRuntime } from "./broker.js";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Headers a plugin is allowed to see. Anything carrying auth is withheld. */
const FORWARDED_HEADERS = ["content-type", "accept", "user-agent"];

export function buildPluginRouter(
  broker: PluginBroker,
  runtime: PluginRuntime,
): Router {
  const router = express.Router();
  router.use(express.json({ limit: "1mb" }));

  for (const route of runtime.routes) {
    const key = `${route.method} ${route.path}`;
    const method = route.method.toLowerCase() as
      "get" | "post" | "put" | "patch" | "delete";

    router[method](route.path, async (req: Request, res: Response) => {
      try {
        const result = await broker.invokeRoute(runtime, key, {
          method: route.method,
          path: req.path,
          params: req.params,
          query: req.query,
          body: req.body ?? null,
          headers: pickHeaders(req),
          // The acting user, verified by authenticateJWT ahead of the
          // /plugin-api mount in database.ts. A plugin cannot set or spoof this.
          userId: (req as Request & { userId?: string }).userId ?? null,
        });

        sendPluginResponse(res, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pluginLogger.error(
          `Plugin ${runtime.plugin.id} route ${key} failed`,
          error instanceof Error ? error : new Error(message),
          { operation: "plugin_http" },
        );
        res.status(502).json({ error: "Plugin route failed", detail: message });
      }
    });
  }

  return router;
}

function pickHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const value = req.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  return headers;
}

function sendPluginResponse(res: Response, result: unknown): void {
  if (result === null || result === undefined) {
    res.status(204).end();
    return;
  }

  const shape = result as {
    status?: unknown;
    body?: unknown;
    headers?: Record<string, unknown>;
  };

  // An envelope is only recognised when `status` is present. Keying off `body`
  // alone would swallow an ordinary payload that happens to have a body field,
  // which is a perfectly normal thing for a handler to return.
  const hasEnvelope =
    typeof shape === "object" && shape !== null && "status" in shape;

  const status = hasEnvelope ? Number(shape.status ?? 200) : 200;
  const body = hasEnvelope ? (shape.body ?? null) : result;

  if (!Number.isInteger(status) || status < 100 || status > 599) {
    res.status(502).json({ error: "Plugin returned an invalid status code" });
    return;
  }

  const serialised = JSON.stringify(body);
  if (
    serialised &&
    Buffer.byteLength(serialised, "utf8") > MAX_RESPONSE_BYTES
  ) {
    res.status(502).json({ error: "Plugin response exceeded the size limit" });
    return;
  }

  res.status(status).json(body);
}
