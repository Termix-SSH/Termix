/**
 * database.ts mounts /plugin-api behind authenticateJWT, the same way every
 * other router is gated. This exercises that exact wiring (rather than
 * http-bridge.test.ts's bare app, which mounts the dispatcher with no auth
 * in front of it on purpose, to test the dispatcher in isolation) so a
 * regression here - an unauthenticated caller reaching a plugin route - is
 * caught.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  createFixturePlugin,
  type Fixture,
} from "../../plugins/fixture-plugin.js";

const state = vi.hoisted(() => ({
  validToken: "valid-token",
  userId: "user-1",
}));

vi.mock("../../../utils/logger.js", () => ({
  pluginLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  databaseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (
          req: Record<string, unknown> & { headers: Record<string, string> },
          res: { status: (code: number) => { json: (body: unknown) => void } },
          next: () => void,
        ) => {
          const auth = req.headers["authorization"];
          const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
          if (token !== state.validToken) {
            res.status(401).json({ error: "Missing authentication token" });
            return;
          }
          req.userId = state.userId;
          next();
        },
    }),
  },
}));

const { AuthManager } = await import("../../../utils/auth-manager.js");
const { PluginBroker } = await import("../../../plugins/broker.js");
const { PluginLoader } = await import("../../../plugins/loader.js");
const { buildPluginRouter } = await import("../../../plugins/http-bridge.js");
const pluginApi = await import("../../../database/routes/plugin-api-routes.js");

const WORKER_TIMEOUT = 30_000;

describe("/plugin-api behind the app's real auth middleware", () => {
  const fixtures: Fixture[] = [];
  let loader: InstanceType<typeof PluginLoader> | null = null;
  let broker: InstanceType<typeof PluginBroker> | null = null;
  let server: Server | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    const authenticateJWT = AuthManager.getInstance().createAuthMiddleware();

    const app = express();
    // Mirrors database.ts: app.use("/plugin-api", authenticateJWT, pluginApiRoutes).
    app.use("/plugin-api", authenticateJWT, pluginApi.default);

    server = await new Promise<Server>((resolve) => {
      const created = app.listen(0, "127.0.0.1", () => resolve(created));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const fixture = createFixturePlugin({
      backendSource: `
        export async function activate(ctx) {
          await ctx.http.route("GET", "/whoami", async (req) => ({
            userId: req.userId ?? null,
          }));
        }
      `,
    });
    fixtures.push(fixture);

    broker = new PluginBroker({
      listHosts: async () => [],
      resolveHost: async () => null,
      onRoutesChanged: (runtime) => {
        pluginApi.registerPluginRouter(
          runtime.plugin.id,
          buildPluginRouter(broker!, runtime),
        );
      },
    });

    loader = new PluginLoader({
      onWorkerReady: (plugin, worker) => broker!.attach(plugin, worker),
      onWorkerGone: (plugin) => {
        broker!.detach(plugin.id);
        pluginApi.unregisterPluginRouter(plugin.id);
      },
    });

    await loader.load(fixture.dir);
    await loader.activate("sample-plugin", "user-1");
  });

  afterEach(async () => {
    await loader?.shutdown();
    loader = null;
    broker = null;

    for (const id of pluginApi.getRegisteredPluginIds()) {
      pluginApi.unregisterPluginRouter(id);
    }

    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
    while (fixtures.length) fixtures.pop()!.cleanup();
  });

  it(
    "rejects a request with no token before it reaches the plugin",
    async () => {
      const res = await fetch(`${baseUrl}/plugin-api/sample-plugin/whoami`);
      expect(res.status).toBe(401);
    },
    WORKER_TIMEOUT,
  );

  it(
    "rejects a request with an invalid token",
    async () => {
      const res = await fetch(`${baseUrl}/plugin-api/sample-plugin/whoami`, {
        headers: { authorization: "Bearer not-the-right-token" },
      });
      expect(res.status).toBe(401);
    },
    WORKER_TIMEOUT,
  );

  it(
    "forwards the verified userId once authenticated",
    async () => {
      const res = await fetch(`${baseUrl}/plugin-api/sample-plugin/whoami`, {
        headers: { authorization: `Bearer ${state.validToken}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ userId: state.userId });
    },
    WORKER_TIMEOUT,
  );
});
