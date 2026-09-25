/**
 * The plugin control plane: listing installed plugins (with their declared
 * and granted capabilities) and granting/revoking a capability. Enable/disable
 * is not re-tested here beyond what already existed; the grant/revoke routes
 * are the new surface this file covers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

interface PluginRow {
  id: string;
  name: string;
  version: string;
  tier: string;
  source: string;
  state: string;
  lastError?: string | null;
  manifestJson: string;
}

const state = vi.hoisted(() => ({
  plugins: new Map<string, PluginRow>(),
  grants: [] as {
    pluginId: string;
    capability: string;
    grantedBy: string | null;
    source?: string;
  }[],
  // Which users have admin.plugins.manage, keyed by userId.
  managers: new Set<string>(["admin-1"]),
  // Plugins the loader reports as running.
  active: new Set<string>(),
}));

vi.mock("../../../upgrade/boot-migrations.js", () => ({
  runPluginDataMigrations: async () => {},
}));

vi.mock("../../../utils/crypto-migration/raw-rows.js", () => ({
  runStatement: vi.fn(async () => {}),
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

/**
 * The caller identifies as whichever user the x-test-user-id header names,
 * mirroring the real JWT middleware's job of setting req.userId -- these
 * tests only need to vary which user is calling, not verify real tokens.
 */
vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (
          req: Record<string, unknown> & { headers: Record<string, string> },
          _res: unknown,
          next: () => void,
        ) => {
          req.userId = req.headers["x-test-user-id"] ?? "admin-1";
          next();
        },
    }),
  },
}));

vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      // The list route asks directly rather than gating the whole mount, so
      // it can return a narrower shape to a non-admin instead of a 403.
      hasPermission: async (userId: string) => state.managers.has(userId),
      requirePermission:
        (_permission: string) =>
        (
          req: Record<string, unknown>,
          res: {
            status: (code: number) => { json: (body: unknown) => void };
          },
          next: () => void,
        ) => {
          const userId = req.userId as string;
          if (!state.managers.has(userId)) {
            res.status(403).json({ error: "Insufficient permissions" });
            return;
          }
          next();
        },
    }),
  },
}));

vi.mock("../../../plugins/index.js", () => ({
  getPluginRuntime: () => ({
    loader: {
      list: () => [],
      get: (id: string) =>
        state.active.has(id)
          ? {
              id,
              state: "active",
              dir: "/nonexistent/plugin",
              manifest: { id, locales: "locales" },
            }
          : undefined,
    },
  }),
  activatePlugin: vi.fn(),
  deactivatePlugin: vi.fn(),
}));

vi.mock("../../../plugins/permissions.js", () => ({
  invalidatePluginPermissionCache: vi.fn(),
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    listAll: async () => [...state.plugins.values()],
    findById: async (id: string) => state.plugins.get(id) ?? null,
    update: async (id: string, changes: Partial<PluginRow>) => {
      const existing = state.plugins.get(id);
      if (existing) state.plugins.set(id, { ...existing, ...changes });
    },
  }),
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async (pluginId: string) =>
      state.grants
        .filter((g) => g.pluginId === pluginId)
        .map((g) => ({ capability: g.capability })),
    findGrant: async (pluginId: string, capability: string) =>
      state.grants.find(
        (g) => g.pluginId === pluginId && g.capability === capability,
      ) ?? null,
    grant: async (input: {
      pluginId: string;
      capability: string;
      grantedBy: string | null;
      source?: string;
    }) => {
      state.grants.push(input);
      return input;
    },
    revoke: async (pluginId: string, capability: string) => {
      const before = state.grants.length;
      state.grants = state.grants.filter(
        (g) => !(g.pluginId === pluginId && g.capability === capability),
      );
      return state.grants.length < before;
    },
  }),
}));

const pluginRoutes = (await import("../../../database/routes/plugins.js"))
  .default;

function makePlugin(overrides: Partial<PluginRow> = {}): PluginRow {
  return {
    id: "sample-plugin",
    name: "Sample Plugin",
    version: "1.0.0",
    tier: "community",
    source: "community",
    state: "enabled",
    manifestJson: JSON.stringify({
      capabilities: ["hosts:read", "kv:own"],
    }),
    ...overrides,
  };
}

describe("plugins route", () => {
  let server: Server | null = null;
  let baseUrl = "";

  beforeEach(async () => {
    state.plugins = new Map();
    state.grants = [];
    state.managers = new Set(["admin-1"]);
    state.active = new Set();

    const app = express();
    app.use(express.json());
    app.use("/plugins", pluginRoutes);

    server = await new Promise<Server>((resolve) => {
      const created = app.listen(0, "127.0.0.1", () => resolve(created));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = null;
  });

  describe("GET /plugins/public", () => {
    it("lists only enabled plugins that opt into guest pages", async () => {
      state.plugins.set(
        "guest-plugin",
        makePlugin({
          id: "guest-plugin",
          manifestJson: JSON.stringify({
            capabilities: ["hosts:read"],
            contributes: { guest: true, guestViews: ["shared"] },
          }),
        }),
      );
      state.plugins.set(
        "off-guest",
        makePlugin({
          id: "off-guest",
          state: "disabled",
          manifestJson: JSON.stringify({ contributes: { guest: true } }),
        }),
      );
      state.plugins.set("sample-plugin", makePlugin());

      const res = await fetch(`${baseUrl}/plugins/public`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.map((plugin: { id: string }) => plugin.id)).toEqual([
        "guest-plugin",
      ]);
      expect(body[0].contributes).toEqual({
        guest: true,
        guestViews: ["shared"],
      });
      expect(body[0]).not.toHaveProperty("capabilities");
      expect(body[0]).not.toHaveProperty("lastError");
    });

    it("skips a plugin whose manifest does not parse", async () => {
      state.plugins.set(
        "broken",
        makePlugin({ id: "broken", manifestJson: "{" }),
      );
      const res = await fetch(`${baseUrl}/plugins/public`);
      expect(await res.json()).toEqual([]);
    });
  });

  describe("GET /plugins/public-manifest", () => {
    it("lists only running plugins with login or second-factor UI, and nothing sensitive", async () => {
      state.plugins.set(
        "login-plugin",
        makePlugin({
          id: "login-plugin",
          manifestJson: JSON.stringify({
            capabilities: ["auth:provide", "credentials:read"],
            contributes: {
              auth: { loginMethods: ["corp-sso"], sshAuthTypes: ["corp"] },
              settings: { admin: [{ key: "clientSecret", type: "secret" }] },
              permissions: [{ name: "manage" }],
            },
          }),
        }),
      );
      state.plugins.set(
        "factor-plugin",
        makePlugin({
          id: "factor-plugin",
          manifestJson: JSON.stringify({
            contributes: { auth: { secondFactors: ["pin"] } },
          }),
        }),
      );
      state.plugins.set(
        "stopped-login",
        makePlugin({
          id: "stopped-login",
          manifestJson: JSON.stringify({
            contributes: { auth: { loginMethods: ["other"] } },
          }),
        }),
      );
      state.plugins.set(
        "disabled-login",
        makePlugin({
          id: "disabled-login",
          state: "disabled",
          manifestJson: JSON.stringify({
            contributes: { auth: { loginMethods: ["x"] } },
          }),
        }),
      );
      state.plugins.set("sample-plugin", makePlugin());
      state.active = new Set([
        "login-plugin",
        "factor-plugin",
        "disabled-login",
        "sample-plugin",
      ]);

      const res = await fetch(`${baseUrl}/plugins/public-manifest`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.map((plugin: { id: string }) => plugin.id)).toEqual([
        "login-plugin",
        "factor-plugin",
      ]);
      expect(body[0].contributes).toEqual({
        auth: { loginMethods: ["corp-sso"], secondFactors: [] },
      });
      for (const plugin of body) {
        expect(Object.keys(plugin).sort()).toEqual(
          [
            "assetVersion",
            "contributes",
            "css",
            "dependencies",
            "enabled",
            "frontend",
            "id",
            "locales",
            "name",
            "optionalDependencies",
            "state",
            "version",
          ].sort(),
        );
      }
      const raw = JSON.stringify(body);
      expect(raw).not.toContain("clientSecret");
      expect(raw).not.toContain("credentials:read");
      expect(raw).not.toContain("sshAuthTypes");
    });
  });

  it("lists a plugin's declared and granted capabilities", async () => {
    state.plugins.set("sample-plugin", makePlugin());
    state.grants.push({
      pluginId: "sample-plugin",
      capability: "hosts:read",
      grantedBy: "admin-1",
    });

    const res = await fetch(`${baseUrl}/plugins`);
    const body = await res.json();

    expect(body).toEqual([
      expect.objectContaining({
        id: "sample-plugin",
        capabilities: ["hosts:read", "kv:own"],
        grantedCapabilities: ["hosts:read"],
      }),
    ]);
  });

  it("grants a declared capability", async () => {
    state.plugins.set("sample-plugin", makePlugin());

    const res = await fetch(`${baseUrl}/plugins/sample-plugin/grants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability: "hosts:read" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "sample-plugin",
      capability: "hosts:read",
      granted: true,
    });
    expect(state.grants).toEqual([
      {
        pluginId: "sample-plugin",
        capability: "hosts:read",
        grantedBy: "admin-1",
      },
    ]);
  });

  it("rejects granting a capability the manifest does not declare", async () => {
    state.plugins.set("sample-plugin", makePlugin());

    const res = await fetch(`${baseUrl}/plugins/sample-plugin/grants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability: "ssh.exec" }),
    });

    expect(res.status).toBe(400);
    expect(state.grants).toEqual([]);
  });

  it("404s granting a capability for a plugin that does not exist", async () => {
    const res = await fetch(`${baseUrl}/plugins/ghost/grants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability: "hosts:read" }),
    });

    expect(res.status).toBe(404);
  });

  it("does not duplicate an already-granted capability", async () => {
    state.plugins.set("sample-plugin", makePlugin());

    await fetch(`${baseUrl}/plugins/sample-plugin/grants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability: "hosts:read" }),
    });
    await fetch(`${baseUrl}/plugins/sample-plugin/grants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability: "hosts:read" }),
    });

    expect(state.grants).toHaveLength(1);
  });

  it("revokes a granted capability", async () => {
    state.plugins.set("sample-plugin", makePlugin());
    state.grants.push({
      pluginId: "sample-plugin",
      capability: "hosts:read",
      grantedBy: "admin-1",
    });

    const res = await fetch(
      `${baseUrl}/plugins/sample-plugin/grants/${encodeURIComponent("hosts:read")}`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "sample-plugin",
      capability: "hosts:read",
      granted: false,
    });
    expect(state.grants).toEqual([]);
  });

  it("404s revoking a capability that was not granted", async () => {
    state.plugins.set("sample-plugin", makePlugin());

    const res = await fetch(
      `${baseUrl}/plugins/sample-plugin/grants/${encodeURIComponent("hosts:read")}`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(404);
  });

  describe("admin.plugins.manage gate", () => {
    it("lets a non-admin list plugins", async () => {
      // GET stays open to any authenticated user on purpose: the app shell
      // calls it for every session to know which plugin tabs to register.
      state.plugins.set("sample-plugin", makePlugin());

      const res = await fetch(`${baseUrl}/plugins`, {
        headers: { "x-test-user-id": "regular-user" },
      });

      expect(res.status).toBe(200);
    });

    // What a plugin may do, what it has been granted and why it failed are
    // operational details. The shell needs none of them to render a tab.
    it("hides capabilities, grants and lastError from a non-admin", async () => {
      state.plugins.set(
        "sample-plugin",
        makePlugin({ lastError: "port already in use" }),
      );
      state.grants.push({
        pluginId: "sample-plugin",
        capability: "hosts:read",
        grantedBy: "admin-1",
      });

      const res = await fetch(`${baseUrl}/plugins`, {
        headers: { "x-test-user-id": "regular-user" },
      });
      const [plugin] = await res.json();

      expect(plugin).toEqual({
        id: "sample-plugin",
        name: "Sample Plugin",
        version: "1.0.0",
        enabled: true,
        state: "enabled",
        contributes: null,
        dependencies: {},
        optionalDependencies: {},
        frontend: false,
        css: false,
        assetVersion: null,
        locales: [],
      });
    });

    it("shows the full record to a holder of admin.plugins.manage", async () => {
      state.plugins.set(
        "sample-plugin",
        makePlugin({ lastError: "port already in use" }),
      );
      state.grants.push({
        pluginId: "sample-plugin",
        capability: "hosts:read",
        grantedBy: "admin-1",
      });

      const res = await fetch(`${baseUrl}/plugins`, {
        headers: { "x-test-user-id": "admin-1" },
      });
      const [plugin] = await res.json();

      expect(plugin).toMatchObject({
        id: "sample-plugin",
        capabilities: ["hosts:read", "kv:own"],
        grantedCapabilities: ["hosts:read"],
        lastError: "port already in use",
      });
    });

    it("403s a non-admin enabling or disabling a plugin", async () => {
      state.plugins.set("sample-plugin", makePlugin());

      const res = await fetch(`${baseUrl}/plugins/sample-plugin/state`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-test-user-id": "regular-user",
        },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(403);
      expect(state.plugins.get("sample-plugin")?.state).toBe("enabled");
    });

    it("403s a non-admin granting a capability", async () => {
      state.plugins.set("sample-plugin", makePlugin());

      const res = await fetch(`${baseUrl}/plugins/sample-plugin/grants`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-user-id": "regular-user",
        },
        body: JSON.stringify({ capability: "hosts:read" }),
      });

      expect(res.status).toBe(403);
      expect(state.grants).toEqual([]);
    });

    it("403s a non-admin revoking a capability", async () => {
      state.plugins.set("sample-plugin", makePlugin());
      state.grants.push({
        pluginId: "sample-plugin",
        capability: "hosts:read",
        grantedBy: "admin-1",
      });

      const res = await fetch(
        `${baseUrl}/plugins/sample-plugin/grants/${encodeURIComponent("hosts:read")}`,
        {
          method: "DELETE",
          headers: { "x-test-user-id": "regular-user" },
        },
      );

      expect(res.status).toBe(403);
      expect(state.grants).toHaveLength(1);
    });
  });
});
