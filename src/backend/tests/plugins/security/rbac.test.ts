/**
 * RBAC: a plugin's permissions live in its own namespace and nowhere else.
 * A plugin cannot take a core group's name as its id, its own declared names
 * resolve to itself, and a role default is recorded as applied only once the
 * role really has it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** roleName -> the permission array stored on that role. */
  roles: new Map<string, { id: number; permissions: string[] }>(),
  /** The rbac_applied_defaults rows, as "<role>:<permission>". */
  appliedDefaults: new Set<string>(),
  /** The rbac_known_permissions rows. */
  known: new Set<string>(),
  warnings: [] as string[],
  failUpdate: false,
}));

vi.mock("../../../upgrade/boot-migrations.js", () => ({
  runPluginDataMigrations: async () => {},
}));

vi.mock("../../../utils/logger.js", () => ({
  pluginLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn((message: string) => {
      state.warnings.push(message);
    }),
    error: vi.fn((message: string) => {
      state.warnings.push(message);
    }),
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

vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: vi.fn(async () => {}),
  getAuditUsername: vi.fn(async (userId: string) => `user:${userId}`),
}));

vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      hasPermission: async () => true,
      invalidateUserPermissionCache: vi.fn(),
    }),
  },
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentRoleRepository: () => ({
    findRoleByName: async (name: string) => {
      const role = state.roles.get(name);
      if (!role) return null;
      return {
        id: role.id,
        name,
        permissions: JSON.stringify(role.permissions),
      };
    },
    updateRole: async (id: number, updates: { permissions?: string }) => {
      if (state.failUpdate) throw new Error("database is locked");
      for (const [name, role] of state.roles) {
        if (role.id !== id) continue;
        if (updates.permissions === undefined) continue;
        state.roles.set(name, {
          id,
          permissions: JSON.parse(updates.permissions) as string[],
        });
      }
    },
    listRoleUserIds: async () => [],
    listRoles: async () =>
      [...state.roles.entries()].map(([name, role]) => ({
        id: role.id,
        name,
        permissions: JSON.stringify(role.permissions),
      })),
  }),
  createCurrentRbacPermissionRepository: () => ({
    listKnown: async () =>
      [...state.known].map((permission) => ({ permission, pluginId: null })),
    recordKnown: async (rows: { permission: string }[]) => {
      for (const row of rows) state.known.add(row.permission);
      return rows.length;
    },
    listAppliedDefaults: async () =>
      [...state.appliedDefaults].map((key) => {
        const [roleName, ...rest] = key.split(":");
        return { roleName, permission: rest.join(":") };
      }),
    recordAppliedDefaults: async (
      rows: { roleName: string; permission: string }[],
    ) => {
      for (const row of rows) {
        state.appliedDefaults.add(`${row.roleName}:${row.permission}`);
      }
      return rows.length;
    },
  }),
}));

const { PluginLoader } = await import("../../../plugins/loader.js");
const { createFixturePlugin } = await import("../fixture-plugin.js");
const { registerPluginPermissions, resetPermissionCatalog, isValidPermission } =
  await import("../../../utils/permission-catalog.js");
const { resolvePermission } = await import("../../../plugins/rbac.js");
const { parseManifest } = await import("../../../plugins/manifest.js");

function permission(name: string, defaultRoles?: string[]) {
  return {
    name,
    titleKey: `permissions.${name}.title`,
    descriptionKey: `permissions.${name}.description`,
    ...(defaultRoles ? { defaultRoles } : {}),
  };
}

beforeEach(() => {
  state.roles.clear();
  state.appliedDefaults.clear();
  state.known.clear();
  state.warnings.length = 0;
  state.failUpdate = false;
  resetPermissionCatalog();
});
afterEach(() => resetPermissionCatalog());

describe("a plugin cannot mint core permissions", () => {
  it.each([["admin"], ["hosts"], ["credentials"]])(
    "a plugin called %s never loads",
    async (id) => {
      const fixture = createFixturePlugin({
        id,
        capabilities: ["kv:own"],
        manifestOverrides: {
          contributes: { permissions: [permission("backdoor", ["user"])] },
        },
      });
      try {
        await expect(
          new PluginLoader().load(fixture.dir, "user"),
        ).rejects.toThrow(/reserved/);
        expect(isValidPermission(`${id}.backdoor`)).toBe(false);
      } finally {
        fixture.cleanup();
      }
    },
  );
});

describe("resolving a permission name", () => {
  it("a name the plugin declares is its own, whatever its first segment", () => {
    registerPluginPermissions({
      group: "billing",
      pluginId: "billing",
      label: "Billing",
      permissions: ["billing.pay"],
    });
    const parsed = parseManifest({
      id: "sample",
      name: "Sample",
      version: "1.0.0",
      description: "A fixture.",
      author: { name: "Termix" },
      license: "MIT",
      category: "Productivity",
      engine: { termix: ">=2.9.0", api: "1" },
      capabilities: ["kv:own"],
      contributes: { permissions: [permission("billing.pay")] },
    }).manifest!;

    expect(resolvePermission(parsed, "billing.pay")).toBe("sample.billing.pay");
  });
});

describe("role defaults", () => {
  it("are not marked applied when the role update fails, so the next boot retries", async () => {
    state.roles.set("user", { id: 2, permissions: ["hosts.*"] });
    state.failUpdate = true;
    const fixture = createFixturePlugin({
      id: "docker",
      capabilities: ["kv:own"],
      manifestOverrides: {
        category: "Infrastructure",
        contributes: { permissions: [permission("run", ["user"])] },
      },
    });
    const { resetPluginRuntime, getPluginRuntime, activatePlugin } =
      await import("../../../plugins/index.js");
    resetPluginRuntime();
    const loader = getPluginRuntime().loader;
    try {
      const plugin = await loader.load(fixture.dir);
      await activatePlugin(plugin.id);
      expect(state.roles.get("user")?.permissions).not.toContain("docker.run");
      expect(state.appliedDefaults.has("user:docker.run")).toBe(false);

      // Next boot, the database is fine again.
      await loader.shutdown();
      state.failUpdate = false;
      resetPluginRuntime();
      const again = getPluginRuntime().loader;
      await activatePlugin((await again.load(fixture.dir)).id);
      expect(state.roles.get("user")?.permissions).toContain("docker.run");
      expect(state.appliedDefaults.has("user:docker.run")).toBe(true);
      await again.shutdown();
    } finally {
      fixture.cleanup();
    }
  });

  it("only ever land in the plugin's own namespace", async () => {
    state.roles.set("user", { id: 2, permissions: [] });
    const fixture = createFixturePlugin({
      id: "docker",
      capabilities: ["kv:own"],
      manifestOverrides: {
        category: "Infrastructure",
        contributes: { permissions: [permission("run", ["user"])] },
      },
    });
    const { resetPluginRuntime, getPluginRuntime, activatePlugin } =
      await import("../../../plugins/index.js");
    resetPluginRuntime();
    const loader = getPluginRuntime().loader;
    try {
      await activatePlugin((await loader.load(fixture.dir)).id);
      expect(state.roles.get("user")?.permissions).toEqual(["docker.run"]);
    } finally {
      await loader.shutdown();
      fixture.cleanup();
    }
  });
});
