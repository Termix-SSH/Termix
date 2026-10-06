/**
 * The plugin control plane: listing installed plugins (with their declared
 * and granted capabilities) and granting/revoking a capability. Enable/disable
 * is not re-tested here beyond what already existed; the grant/revoke routes
 * are the new surface this file covers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginManageError } from "../../../plugins/manage.js";
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

const manageMock = vi.hoisted(() => ({
  listRegistry: vi.fn(),
  installPlugin: vi.fn(),
  updatePlugin: vi.fn(),
  updateAllPlugins: vi.fn(),
  uninstallPlugin: vi.fn(),
  setPluginOptions: vi.fn(),
  getPluginDataSummary: vi.fn(),
  getPluginChangelog: vi.fn(),
  deletePluginData: vi.fn(),
  planStateChange: vi.fn(),
  setPluginState: vi.fn(),
  getDeveloperMode: vi.fn(),
  setDeveloperMode: vi.fn(),
  stageUpload: vi.fn(),
  installUpload: vi.fn(),
  isLinkedDesktop: vi.fn(async () => false),
}));
const auditMock = vi.hoisted(() => ({ logAudit: vi.fn(async () => {}) }));

vi.mock("../../../plugins/manage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../plugins/manage.js")>()),
  ...manageMock,
}));

vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: auditMock.logAudit,
  getAuditUsername: async () => "admin",
  getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

const onboardingMock = vi.hoisted(() => ({
  describeOnboardingPlugins: vi.fn(),
  applyOnboardingChoices: vi.fn(),
}));

vi.mock("../../../plugins/onboarding.js", () => onboardingMock);

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
      expect(body[0].version).toBe("");
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
      expect(body.map((plugin: { version: string }) => plugin.version)).toEqual(
        ["", ""],
      );
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
  describe("onboarding plugin picker", () => {
    const post = (body: unknown, user = "admin-1") =>
      fetch(`${baseUrl}/plugins/onboarding/apply`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user-id": user },
        body: JSON.stringify(body),
      });

    beforeEach(() => {
      onboardingMock.describeOnboardingPlugins.mockReset();
      onboardingMock.applyOnboardingChoices.mockReset();
      manageMock.isLinkedDesktop.mockResolvedValue(false);
      auditMock.logAudit.mockClear();
    });

    it("lists plugins for a manager only", async () => {
      onboardingMock.describeOnboardingPlugins.mockResolvedValue({
        pending: true,
        managedByLinkedServer: false,
        plugins: [],
      });
      const ok = await fetch(`${baseUrl}/plugins/onboarding`, {
        headers: { "x-test-user-id": "admin-1" },
      });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ pending: true });

      const denied = await fetch(`${baseUrl}/plugins/onboarding`, {
        headers: { "x-test-user-id": "user-2" },
      });
      expect(denied.status).toBe(403);
    });

    it("applies choices and audits each change", async () => {
      onboardingMock.applyOnboardingChoices.mockResolvedValue({
        resolved: {},
        adjustments: [],
        enabled: ["a"],
        disabled: ["b"],
        removed: ["c"],
        failed: [],
      });
      const res = await post({
        choices: { a: "enabled", b: "disabled", c: "remove" },
      });
      expect(res.status).toBe(200);
      expect(onboardingMock.applyOnboardingChoices).toHaveBeenCalledWith(
        { a: "enabled", b: "disabled", c: "remove" },
        { dryRun: false },
      );
      const actions = auditMock.logAudit.mock.calls.map(
        (call) => (call as unknown as [{ action: string }])[0].action,
      );
      expect(actions).toEqual([
        "enable_plugin",
        "disable_plugin",
        "uninstall_plugin",
      ]);
    });

    it("rejects bad choices", async () => {
      expect((await post({})).status).toBe(400);
      expect((await post({ choices: ["a"] })).status).toBe(400);
      expect((await post({ choices: { a: "delete" } })).status).toBe(400);
      expect(
        (await post({ choices: { a: "enabled" }, dryRun: "yes" })).status,
      ).toBe(400);
      expect(onboardingMock.applyOnboardingChoices).not.toHaveBeenCalled();
    });

    it("refuses on a linked desktop and for non-managers", async () => {
      manageMock.isLinkedDesktop.mockResolvedValue(true);
      expect((await post({ choices: { a: "enabled" } })).status).toBe(409);
      manageMock.isLinkedDesktop.mockResolvedValue(false);
      expect((await post({ choices: { a: "enabled" } }, "user-2")).status).toBe(
        403,
      );
      expect(onboardingMock.applyOnboardingChoices).not.toHaveBeenCalled();
    });
  });

  describe("install, update, uninstall", () => {
    const post = (path: string, body: unknown = {}, user = "admin-1") =>
      fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user-id": user },
        body: JSON.stringify(body),
      });

    beforeEach(() => {
      for (const fn of Object.values(manageMock)) fn.mockReset();
      manageMock.isLinkedDesktop.mockResolvedValue(false);
      auditMock.logAudit.mockClear();
    });

    it("installs a plugin as the caller and audits it", async () => {
      manageMock.installPlugin.mockResolvedValue({
        id: "docker",
        version: "1.0.0",
        state: "active",
      });
      const res = await post("/plugins/docker/install", {
        version: "1.0.0",
        capabilities: ["kv:own"],
      });
      expect(res.status).toBe(200);
      expect(manageMock.installPlugin).toHaveBeenCalledWith("docker", {
        version: "1.0.0",
        userId: "admin-1",
        capabilities: ["kv:own"],
      });
      expect(auditMock.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "install_plugin",
          resourceId: "docker",
        }),
      );
    });

    it("rejects a bad id or version before touching anything", async () => {
      expect((await post("/plugins/..%2Fx/install")).status).toBe(400);
      expect(
        (await post("/plugins/docker/install", { version: 7 })).status,
      ).toBe(400);
      expect(
        (await post("/plugins/docker/install", { capabilities: "kv:own" }))
          .status,
      ).toBe(400);
      expect(
        (await post("/plugins/docker/install", { capabilities: [1] })).status,
      ).toBe(400);
      expect(manageMock.installPlugin).not.toHaveBeenCalled();
    });

    it("passes a refusal through with its code and details", async () => {
      manageMock.updatePlugin.mockRejectedValue(
        new PluginManageError("new caps", 409, "CAPABILITIES_ADDED", {
          capabilities: ["notify:send"],
        }),
      );
      const res = await post("/plugins/docker/update", {});
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: "CAPABILITIES_ADDED",
        capabilities: ["notify:send"],
      });
      expect(manageMock.updatePlugin).toHaveBeenCalledWith("docker", {
        version: undefined,
        userId: "admin-1",
        acceptCapabilities: false,
        capabilities: undefined,
      });
    });

    it("passes the consented list on an accepted update", async () => {
      manageMock.updatePlugin.mockResolvedValue({
        id: "docker",
        version: "1.1.0",
        state: "active",
      });
      await post("/plugins/docker/update", {
        acceptCapabilities: true,
        capabilities: ["notify:send"],
      });
      expect(manageMock.updatePlugin).toHaveBeenCalledWith("docker", {
        version: undefined,
        userId: "admin-1",
        acceptCapabilities: true,
        capabilities: ["notify:send"],
      });
    });

    it("uninstalls", async () => {
      manageMock.uninstallPlugin.mockResolvedValue({
        id: "docker",
        removed: { tables: ["p_docker_x"], kvKeys: 0 },
      });
      const res = await fetch(`${baseUrl}/plugins/docker`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      expect(manageMock.uninstallPlugin).toHaveBeenCalledWith("docker");
    });

    it("refuses changes on a linked desktop", async () => {
      manageMock.isLinkedDesktop.mockResolvedValue(true);
      const res = await post("/plugins/docker/install");
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("MANAGED_BY_SERVER");
      expect(manageMock.installPlugin).not.toHaveBeenCalled();
    });

    it("previews a state change without making it", async () => {
      state.plugins.set("sample-plugin", makePlugin());
      manageMock.planStateChange.mockResolvedValue({
        enable: [],
        disable: ["addon"],
        missing: [],
      });
      const res = await fetch(
        `${baseUrl}/plugins/sample-plugin/state?dryRun=1`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        },
      );
      expect(await res.json()).toMatchObject({ disable: ["addon"] });
      expect(manageMock.setPluginState).not.toHaveBeenCalled();
    });

    it("returns an installed plugin's release notes", async () => {
      manageMock.getPluginChangelog.mockResolvedValue([
        { version: "1.0.0", changes: [{ type: "added", text: "First" }] },
      ]);
      const res = await fetch(`${baseUrl}/plugins/docker/changelog`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        id: "docker",
        releases: [
          { version: "1.0.0", changes: [{ type: "added", text: "First" }] },
        ],
      });
      expect(manageMock.getPluginChangelog).toHaveBeenCalledWith("docker");
    });

    it("answers 502 when the registry is unreachable", async () => {
      manageMock.listRegistry.mockRejectedValue(new Error("offline"));
      const res = await fetch(`${baseUrl}/plugins/registry`);
      expect(res.status).toBe(502);
    });

    it("403s a non-admin on every management route", async () => {
      const user = "regular-user";
      const headers = {
        "content-type": "application/json",
        "x-test-user-id": user,
      };
      const calls = [
        fetch(`${baseUrl}/plugins/registry`, { headers }),
        post("/plugins/docker/install", {}, user),
        post("/plugins/docker/update", {}, user),
        post("/plugins/update-all", {}, user),
        fetch(`${baseUrl}/plugins/docker`, { method: "DELETE", headers }),
        fetch(`${baseUrl}/plugins/docker/options`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ autoUpdate: true }),
        }),
        fetch(`${baseUrl}/plugins/docker/data`, { headers }),
        fetch(`${baseUrl}/plugins/docker/changelog`, { headers }),
        fetch(`${baseUrl}/plugins/developer-mode`, { headers }),
        fetch(`${baseUrl}/plugins/developer-mode`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ enabled: true }),
        }),
        fetch(`${baseUrl}/plugins/upload`, {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-test-user-id": user,
          },
          body: Buffer.from("x"),
        }),
        post(`/plugins/upload/${"a".repeat(32)}/install`, {}, user),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(403);
      }
      for (const fn of Object.values(manageMock)) {
        if (fn !== manageMock.isLinkedDesktop) {
          expect(fn).not.toHaveBeenCalled();
        }
      }
    });
  });

  describe("developer mode and file installs", () => {
    beforeEach(() => {
      for (const fn of Object.values(manageMock)) fn.mockReset();
      manageMock.isLinkedDesktop.mockResolvedValue(false);
      auditMock.logAudit.mockClear();
    });

    it("reads and saves developer mode, auditing the change", async () => {
      manageMock.getDeveloperMode.mockResolvedValue(true);
      const read = await fetch(`${baseUrl}/plugins/developer-mode`);
      expect(await read.json()).toEqual({ enabled: true, signedOnly: false });

      const bad = await fetch(`${baseUrl}/plugins/developer-mode`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: "yes" }),
      });
      expect(bad.status).toBe(400);

      const saved = await fetch(`${baseUrl}/plugins/developer-mode`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      expect(saved.status).toBe(200);
      expect(manageMock.setDeveloperMode).toHaveBeenCalledWith(false);
      expect(auditMock.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "plugin_developer_mode" }),
      );
    });

    it("hands the raw upload to the stager", async () => {
      manageMock.stageUpload.mockResolvedValue({ token: "t", id: "notes" });
      const res = await fetch(`${baseUrl}/plugins/upload`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: Buffer.from("archive"),
      });
      expect(res.status).toBe(200);
      const [buffer] = manageMock.stageUpload.mock.calls[0];
      expect(Buffer.from(buffer).toString()).toBe("archive");
    });

    it("refuses an upload that is not octet-stream", async () => {
      const res = await fetch(`${baseUrl}/plugins/upload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      expect(manageMock.stageUpload).not.toHaveBeenCalled();
    });

    it("passes the developer mode refusal through", async () => {
      manageMock.stageUpload.mockRejectedValue(
        new PluginManageError("off", 403, "DEVELOPER_MODE_OFF"),
      );
      const res = await fetch(`${baseUrl}/plugins/upload`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: Buffer.from("archive"),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("DEVELOPER_MODE_OFF");
    });

    it("installs a staged upload and audits it as unverified", async () => {
      manageMock.installUpload.mockResolvedValue({
        id: "notes",
        version: "0.1.0",
        state: "active",
      });
      const token = "b".repeat(32);
      const res = await fetch(`${baseUrl}/plugins/upload/${token}/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capabilities: ["kv:own"] }),
      });
      expect(res.status).toBe(200);
      expect(manageMock.installUpload).toHaveBeenCalledWith(token, {
        userId: "admin-1",
        capabilities: ["kv:own"],
      });
      expect(auditMock.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "install_plugin_from_file",
          resourceId: "notes",
        }),
      );
    });

    it("rejects a malformed upload token", async () => {
      const res = await fetch(`${baseUrl}/plugins/upload/nope/install`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capabilities: [] }),
      });
      expect(res.status).toBe(400);
      expect(manageMock.installUpload).not.toHaveBeenCalled();
    });
  });
});
