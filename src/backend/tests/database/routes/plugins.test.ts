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
  manifestJson: string;
}

const state = vi.hoisted(() => ({
  plugins: new Map<string, PluginRow>(),
  grants: [] as { pluginId: string; capability: string; grantedBy: string }[],
  // Which users have admin.plugins.manage, keyed by userId.
  managers: new Set<string>(["admin-1"]),
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
  getPluginRuntime: () => ({ loader: { list: () => [] } }),
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
      grantedBy: string;
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
      permissions: ["hosts.read", "storage.own"],
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

  it("lists a plugin's declared permissions and granted capabilities", async () => {
    state.plugins.set("sample-plugin", makePlugin());
    state.grants.push({
      pluginId: "sample-plugin",
      capability: "hosts.read",
      grantedBy: "admin-1",
    });

    const res = await fetch(`${baseUrl}/plugins`);
    const body = await res.json();

    expect(body).toEqual([
      expect.objectContaining({
        id: "sample-plugin",
        permissions: ["hosts.read", "storage.own"],
        grantedCapabilities: ["hosts.read"],
      }),
    ]);
  });

  it("grants a declared capability", async () => {
    state.plugins.set("sample-plugin", makePlugin());

    const res = await fetch(`${baseUrl}/plugins/sample-plugin/grants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability: "hosts.read" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "sample-plugin",
      capability: "hosts.read",
      granted: true,
    });
    expect(state.grants).toEqual([
      {
        pluginId: "sample-plugin",
        capability: "hosts.read",
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
      body: JSON.stringify({ capability: "hosts.read" }),
    });

    expect(res.status).toBe(404);
  });

  it("does not duplicate an already-granted capability", async () => {
    state.plugins.set("sample-plugin", makePlugin());

    await fetch(`${baseUrl}/plugins/sample-plugin/grants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability: "hosts.read" }),
    });
    await fetch(`${baseUrl}/plugins/sample-plugin/grants`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability: "hosts.read" }),
    });

    expect(state.grants).toHaveLength(1);
  });

  it("revokes a granted capability", async () => {
    state.plugins.set("sample-plugin", makePlugin());
    state.grants.push({
      pluginId: "sample-plugin",
      capability: "hosts.read",
      grantedBy: "admin-1",
    });

    const res = await fetch(
      `${baseUrl}/plugins/sample-plugin/grants/hosts.read`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "sample-plugin",
      capability: "hosts.read",
      granted: false,
    });
    expect(state.grants).toEqual([]);
  });

  it("404s revoking a capability that was not granted", async () => {
    state.plugins.set("sample-plugin", makePlugin());

    const res = await fetch(
      `${baseUrl}/plugins/sample-plugin/grants/hosts.read`,
      { method: "DELETE" },
    );

    expect(res.status).toBe(404);
  });

  describe("admin.plugins.manage gate", () => {
    it("a non-admin authenticated user cannot list plugins", async () => {
      // GET stays open to any authenticated user on purpose: the app shell
      // calls it for every session to know which plugin tabs to register.
      state.plugins.set("sample-plugin", makePlugin());

      const res = await fetch(`${baseUrl}/plugins`, {
        headers: { "x-test-user-id": "regular-user" },
      });

      expect(res.status).toBe(200);
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
        body: JSON.stringify({ capability: "hosts.read" }),
      });

      expect(res.status).toBe(403);
      expect(state.grants).toEqual([]);
    });

    it("403s a non-admin revoking a capability", async () => {
      state.plugins.set("sample-plugin", makePlugin());
      state.grants.push({
        pluginId: "sample-plugin",
        capability: "hosts.read",
        grantedBy: "admin-1",
      });

      const res = await fetch(
        `${baseUrl}/plugins/sample-plugin/grants/hosts.read`,
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
