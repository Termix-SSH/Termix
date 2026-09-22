/**
 * /plugin-api is mounted behind authenticateJWT in database.ts, the same way
 * every other router is gated, so an unauthenticated caller can never reach
 * plugin code.
 *
 * The dispatcher itself has no routes registered in A1: the worker HTTP
 * bridge was removed with the worker tier and A4 rebuilds routing on top of
 * the SDK. What still has to hold, and what this covers, is that the auth
 * gate sits in front of the mount and that an unknown plugin id is a 404
 * rather than a crash.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  validToken: "valid-token",
  userId: "user-1",
}));

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const pluginApi = await import("../../../database/routes/plugin-api-routes.js");

/** Stands in for AuthManager's middleware, with the same 401 behaviour. */
function authenticateJWT(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (token !== state.validToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  (req as express.Request & { userId?: string }).userId = state.userId;
  next();
}

let server: Server | null = null;

async function startServer(): Promise<string> {
  const app = express();
  // The same order database.ts uses: the gate, then the dispatcher.
  app.use("/plugin-api", authenticateJWT, pluginApi.default);

  return new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server!.close(() => resolve(undefined)));
    server = null;
  }
  for (const id of pluginApi.getRegisteredPluginIds()) {
    pluginApi.unregisterPluginRouter(id);
  }
});

describe("/plugin-api authentication", () => {
  it("rejects a request with no token", async () => {
    const base = await startServer();

    const response = await fetch(`${base}/plugin-api/sample-plugin/thing`);

    expect(response.status).toBe(401);
  });

  it("rejects a request with the wrong token", async () => {
    const base = await startServer();

    const response = await fetch(`${base}/plugin-api/sample-plugin/thing`, {
      headers: { Authorization: "Bearer nope" },
    });

    expect(response.status).toBe(401);
  });

  // Past the gate, an id nothing registered is a plain 404. The auth check
  // runs first either way, so a caller cannot use the difference between 401
  // and 404 to find out which plugins are installed.
  it("returns 404 for an unregistered plugin id when authenticated", async () => {
    const base = await startServer();

    const response = await fetch(`${base}/plugin-api/sample-plugin/thing`, {
      headers: { Authorization: `Bearer ${state.validToken}` },
    });

    expect(response.status).toBe(404);
  });

  it("dispatches to a registered router only when authenticated", async () => {
    const router = express.Router();
    router.get("/thing", (req, res) => {
      res.json({
        ok: true,
        userId: (req as express.Request & { userId?: string }).userId,
      });
    });
    pluginApi.registerPluginRouter("sample-plugin", router);

    const base = await startServer();

    const unauthorized = await fetch(`${base}/plugin-api/sample-plugin/thing`);
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${base}/plugin-api/sample-plugin/thing`, {
      headers: { Authorization: `Bearer ${state.validToken}` },
    });

    expect(authorized.status).toBe(200);
    // The user id the plugin sees is the one the gate verified, never one the
    // caller supplied.
    expect(await authorized.json()).toEqual({
      ok: true,
      userId: state.userId,
    });
  });
});
