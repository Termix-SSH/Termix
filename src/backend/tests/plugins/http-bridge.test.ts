import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createFixturePlugin, type Fixture } from "./fixture-plugin.js";

const state = vi.hoisted(() => ({
  grants: [] as { pluginId: string; capability: string }[],
}));

vi.mock("../../utils/logger.js", () => ({
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

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: vi.fn(async () => {}),
  getAuditUsername: vi.fn(async (userId: string) => `user:${userId}`),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async (pluginId: string) =>
      state.grants.filter((g) => g.pluginId === pluginId),
  }),
}));

const { PluginBroker } = await import("../../plugins/broker.js");
const { PluginLoader } = await import("../../plugins/loader.js");
const { buildPluginRouter } = await import("../../plugins/http-bridge.js");
const pluginApi = await import("../../database/routes/plugin-api-routes.js");
const { invalidatePluginPermissionCache } =
  await import("../../plugins/permissions.js");

const WORKER_TIMEOUT = 30_000;

describe("plugin HTTP bridge", () => {
  const fixtures: Fixture[] = [];
  let loader: InstanceType<typeof PluginLoader> | null = null;
  let broker: InstanceType<typeof PluginBroker> | null = null;
  let server: Server | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    state.grants = [];

    const app = express();
    app.use("/plugin-api", pluginApi.default);

    server = await new Promise<Server>((resolve) => {
      const created = app.listen(0, "127.0.0.1", () => resolve(created));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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

  async function activate(backendSource: string) {
    const fixture = createFixturePlugin({ backendSource });
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
  }

  it("404s for a plugin that is not running", async () => {
    const res = await fetch(`${baseUrl}/plugin-api/ghost/anything`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Plugin not installed or not running",
    });
  });

  it(
    "dispatches a GET to an active plugin's handler",
    async () => {
      await activate(`
        export async function activate(ctx) {
          await ctx.http.route("GET", "/ping", async () => ({ pong: true }));
        }
      `);

      const res = await fetch(`${baseUrl}/plugin-api/sample-plugin/ping`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ pong: true });
    },
    WORKER_TIMEOUT,
  );

  it(
    "passes the body, query and params through to the handler",
    async () => {
      await activate(`
        export async function activate(ctx) {
          await ctx.http.route("POST", "/echo/:id", async (req) => ({
            id: req.params.id,
            q: req.query.q,
            body: req.body,
            method: req.method,
          }));
        }
      `);

      const res = await fetch(
        `${baseUrl}/plugin-api/sample-plugin/echo/7?q=hello`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "termix" }),
        },
      );

      expect(await res.json()).toEqual({
        id: "7",
        q: "hello",
        body: { name: "termix" },
        method: "POST",
      });
    },
    WORKER_TIMEOUT,
  );

  it(
    "honours an explicit status/body envelope",
    async () => {
      await activate(`
        export async function activate(ctx) {
          await ctx.http.route("GET", "/missing", async () => ({
            status: 404,
            body: { error: "nope" },
          }));
        }
      `);

      const res = await fetch(`${baseUrl}/plugin-api/sample-plugin/missing`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "nope" });
    },
    WORKER_TIMEOUT,
  );

  it(
    "treats a payload with a body field as the body, not an envelope",
    async () => {
      await activate(`
        export async function activate(ctx) {
          await ctx.http.route("GET", "/doc", async () => ({
            body: "the article text",
            title: "A post",
          }));
        }
      `);

      const res = await fetch(`${baseUrl}/plugin-api/sample-plugin/doc`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        body: "the article text",
        title: "A post",
      });
    },
    WORKER_TIMEOUT,
  );

  it(
    "returns 502 when the plugin handler throws",
    async () => {
      await activate(`
        export async function activate(ctx) {
          await ctx.http.route("GET", "/boom", async () => {
            throw new Error("handler exploded");
          });
        }
      `);

      const res = await fetch(`${baseUrl}/plugin-api/sample-plugin/boom`);
      expect(res.status).toBe(502);
      expect((await res.json()).detail).toContain("handler exploded");
    },
    WORKER_TIMEOUT,
  );

  it(
    "does not forward authorization headers or cookies to the plugin",
    async () => {
      await activate(`
        export async function activate(ctx) {
          await ctx.http.route("GET", "/headers", async (req) => ({
            seen: Object.keys(req.headers).sort(),
          }));
        }
      `);

      const res = await fetch(`${baseUrl}/plugin-api/sample-plugin/headers`, {
        headers: {
          authorization: "Bearer super-secret-token",
          cookie: "session=secret",
          "content-type": "application/json",
        },
      });

      const seen = (await res.json()).seen as string[];
      expect(seen).not.toContain("authorization");
      expect(seen).not.toContain("cookie");
      expect(seen).toContain("content-type");
    },
    WORKER_TIMEOUT,
  );

  it(
    "rejects an unsupported method and a path without a leading slash",
    async () => {
      const fixture = createFixturePlugin({
        backendSource: `
          export async function activate(ctx) {
            const errors = [];
            try {
              await ctx.http.route("TRACE", "/x", () => null);
            } catch (e) { errors.push(e.message); }
            try {
              await ctx.http.route("GET", "no-slash", () => null);
            } catch (e) { errors.push(e.message); }
            if (errors.length !== 2) throw new Error("expected two rejections");
            await ctx.http.route("GET", "/ok", async () => ({ errors }));
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
        onWorkerGone: (plugin) => broker!.detach(plugin.id),
      });

      await loader.load(fixture.dir);
      await loader.activate("sample-plugin", "user-1");

      const res = await fetch(`${baseUrl}/plugin-api/sample-plugin/ok`);
      const errors = (await res.json()).errors as string[];
      expect(errors[0]).toContain("does not support the TRACE method");
      expect(errors[1]).toContain('must start with "/"');
    },
    WORKER_TIMEOUT,
  );

  it(
    "404s again once the plugin is deactivated",
    async () => {
      await activate(`
        export async function activate(ctx) {
          await ctx.http.route("GET", "/ping", async () => ({ pong: true }));
        }
      `);

      expect(
        (await fetch(`${baseUrl}/plugin-api/sample-plugin/ping`)).status,
      ).toBe(200);

      await loader!.deactivate("sample-plugin");
      pluginApi.unregisterPluginRouter("sample-plugin");

      const res = await fetch(`${baseUrl}/plugin-api/sample-plugin/ping`);
      expect(res.status).toBe(404);
    },
    WORKER_TIMEOUT,
  );

  describe("per-request actor identity", () => {
    /**
     * Exercises the real worker end to end: the fixture's activate() calls
     * ctx.hosts.list() from inside a genuine ctx.http.route handler, so the
     * AsyncLocalStorage context worker-bootstrap.ts enters around that
     * invocation is the thing under test, not a mock of it. Two concurrent
     * requests as two different users must each see only their own hosts,
     * even though both are in flight on the very same worker at once.
     */
    async function activateWithHostsRoute() {
      const fixture = createFixturePlugin({
        backendSource: `
          export async function activate(ctx) {
            await ctx.http.route("GET", "/my-hosts", async () => {
              const hosts = await ctx.hosts.list();
              return { hosts };
            });
          }
        `,
      });
      fixtures.push(fixture);

      const hostsByUser: Record<string, { id: number; name: string }[]> = {
        alice: [{ id: 1, name: "alice-host" }],
        bob: [{ id: 2, name: "bob-host" }],
      };

      broker = new PluginBroker({
        listHosts: async (userId) => hostsByUser[userId] ?? [],
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

      state.grants.push({
        pluginId: "sample-plugin",
        capability: "hosts.read",
      });
      invalidatePluginPermissionCache("sample-plugin");

      await loader.load(fixture.dir);
      // Activated under "install-owner", a third identity distinct from
      // alice and bob, so a test that accidentally fell back to ownerUserId
      // instead of the per-request actor would show up as a clear mismatch
      // rather than an accidental pass.
      await loader.activate("sample-plugin", "install-owner");
    }

    /**
     * Mimics authenticateJWT setting req.userId ahead of the dispatcher, the
     * way database.ts really wires it (see plugin-api-routes-auth.test.ts for
     * that wiring itself). This file's own app has no auth in front of
     * pluginApi.default on purpose, to test the dispatcher in isolation, so
     * the per-user identity is injected the same minimal way here.
     */
    function fetchAsUser(path: string, userId: string) {
      return fetch(`${baseUrl}${path}`, {
        headers: { "x-test-user-id": userId },
      });
    }

    it(
      "two concurrent requests as different users each see only their own hosts",
      async () => {
        await activateWithHostsRoute();

        // Reopen the server with a stand-in auth middleware that reads the
        // test header, since the beforeEach server has none.
        await new Promise<void>((resolve) => server?.close(() => resolve()));
        const app = express();
        app.use((req, _res, next) => {
          const userId = req.headers["x-test-user-id"];
          if (typeof userId === "string") {
            (req as typeof req & { userId?: string }).userId = userId;
          }
          next();
        });
        app.use("/plugin-api", pluginApi.default);
        server = await new Promise((resolve) => {
          const created = app.listen(0, "127.0.0.1", () => resolve(created));
        });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

        const [aliceRes, bobRes] = await Promise.all([
          fetchAsUser("/plugin-api/sample-plugin/my-hosts", "alice"),
          fetchAsUser("/plugin-api/sample-plugin/my-hosts", "bob"),
        ]);

        expect(await aliceRes.json()).toMatchObject({
          hosts: [{ id: 1, name: "alice-host" }],
        });
        expect(await bobRes.json()).toMatchObject({
          hosts: [{ id: 2, name: "bob-host" }],
        });
      },
      WORKER_TIMEOUT,
    );

    it(
      "falls back to the install owner when a call has no inbound request",
      async () => {
        const fixture = createFixturePlugin({
          backendSource: `
            export async function activate(ctx) {
              const hosts = await ctx.hosts.list();
              await ctx.log.info(JSON.stringify({ hosts }));
            }
          `,
        });
        fixtures.push(fixture);

        const hostsByUser: Record<string, { id: number; name: string }[]> = {
          "install-owner": [{ id: 9, name: "owner-host" }],
        };

        broker = new PluginBroker({
          listHosts: async (userId) => hostsByUser[userId] ?? [],
          resolveHost: async () => null,
        });

        const logged: string[] = [];
        const { pluginLogger } = await import("../../utils/logger.js");
        vi.mocked(pluginLogger.info).mockImplementation((message: string) => {
          logged.push(message);
        });

        loader = new PluginLoader({
          onWorkerReady: (plugin, worker) => broker!.attach(plugin, worker),
          onWorkerGone: (plugin) => broker!.detach(plugin.id),
        });

        state.grants.push({
          pluginId: "sample-plugin",
          capability: "hosts.read",
        });
        invalidatePluginPermissionCache("sample-plugin");

        await loader.load(fixture.dir);
        await loader.activate("sample-plugin", "install-owner");

        const line = logged.find((entry) => entry.startsWith("{"));
        expect(line && JSON.parse(line)).toMatchObject({
          hosts: [{ id: 9, name: "owner-host" }],
        });
      },
      WORKER_TIMEOUT,
    );
  });
});
