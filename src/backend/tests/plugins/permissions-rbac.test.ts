/**
 * A5: plugin permissions in core RBAC.
 *
 * Covers the four things that were structurally wrong before: a plugin could
 * name any namespace it liked, a disabled plugin's permissions stopped being
 * grantable, a revoked role default came back on the next boot, and the ai
 * group was declared twice.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Fixture } from "./fixture-plugin.js";

const state = vi.hoisted(() => ({
  /** roleName -> the permission array stored on that role. */
  roles: new Map<string, { id: number; permissions: string[] }>(),
  /** The rbac_applied_defaults rows, as "<role>:<permission>". */
  appliedDefaults: new Set<string>(),
  /** The rbac_known_permissions rows. */
  known: new Set<string>(),
  warnings: [] as string[],
}));

vi.mock("../../plugins/boot-migrations.js", () => ({
  runPluginDataMigrations: async () => {},
}));

vi.mock("../../utils/logger.js", () => ({
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

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: vi.fn(async () => {}),
  getAuditUsername: vi.fn(async (userId: string) => `user:${userId}`),
}));

vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      hasPermission: async () => true,
      invalidateUserPermissionCache: vi.fn(),
    }),
  },
}));

vi.mock("../../database/repositories/factory.js", () => ({
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

const { PluginLoader } = await import("../../plugins/loader.js");
const { createFixturePlugin } = await import("./fixture-plugin.js");
const {
  getPermissionCatalog,
  isValidPermission,
  markPluginPermissionsDisabled,
  registerPluginPermissions,
  resetPermissionCatalog,
} = await import("../../utils/permission-catalog.js");
const { parseManifest, qualifyPermission } =
  await import("../../plugins/manifest.js");
const { resolvePermission, declaredPermissions } =
  await import("../../plugins/rbac.js");
const { createRbacMiddleware } = await import("../../plugins/http.js");

function manifest(
  id: string,
  permissions: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: "A fixture.",
    author: { name: "Termix" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities: ["kv:own"],
    contributes: { permissions },
    ...extra,
  };
}

function permission(name: string, defaultRoles?: string[]) {
  const entry: Record<string, unknown> = {
    name,
    titleKey: `permissions.${name}.title`,
    descriptionKey: `permissions.${name}.description`,
  };
  if (defaultRoles) entry.defaultRoles = defaultRoles;
  return entry;
}

beforeEach(() => {
  state.roles.clear();
  state.appliedDefaults.clear();
  state.known.clear();
  state.warnings.length = 0;
  resetPermissionCatalog();
});

afterEach(() => {
  resetPermissionCatalog();
});

describe("namespacing", () => {
  it("registers a short name as <pluginId>.<name>", () => {
    expect(qualifyPermission("ai", "services.use")).toBe("ai.services.use");
    expect(qualifyPermission("ai", "use")).toBe("ai.use");
  });

  it("qualifies the ids a manifest declares", () => {
    const { manifest: parsed, errors } = parseManifest(
      manifest("ai", [permission("use"), permission("services.use")]),
    );

    expect(errors).toEqual([]);
    expect(
      parsed?.contributes?.permissions?.map((entry) =>
        qualifyPermission("ai", entry.name),
      ),
    ).toEqual(["ai.use", "ai.services.use"]);
  });

  it("prefixes a bare short name and leaves a full id alone", () => {
    const parsed = parseManifest(
      manifest("ai", [permission("services.use")]),
    ).manifest!;

    expect(resolvePermission(parsed, "services.use")).toBe("ai.services.use");
    // Its own full id is already qualified.
    expect(resolvePermission(parsed, "ai.services.use")).toBe(
      "ai.services.use",
    );
    // A core group is used as given.
    expect(resolvePermission(parsed, "hosts.view")).toBe("hosts.view");
  });

  it("leaves another plugin's id alone, for a cross-plugin check", () => {
    registerPluginPermissions({
      group: "automations",
      pluginId: "automations",
      label: "Automations",
      permissions: ["automations.run"],
    });

    const parsed = parseManifest(manifest("ai", [permission("use")])).manifest!;

    expect(resolvePermission(parsed, "automations.run")).toBe(
      "automations.run",
    );
  });
});

describe("namespace escalation is refused", () => {
  it.each([
    ["admin.users.manage", /reserved core group/],
    ["hosts.view", /reserved core group/],
    ["credentials.read", /reserved core group/],
    ["snippets.edit", /reserved core group/],
  ])("refuses the core name %s", (name, pattern) => {
    const { errors } = parseManifest(manifest("sample", [permission(name)]));

    expect(errors.join()).toMatch(pattern);
  });

  it("refuses a name that repeats the plugin's own id", () => {
    const { errors } = parseManifest(manifest("ai", [permission("ai.use")]));

    expect(errors.join()).toMatch(/already starts with this plugin/);
  });

  // The manifest validator cannot know which other plugins exist, so the
  // runtime re-checks against the live catalog when the plugin registers.
  it("drops a permission naming another plugin's namespace at registration", async () => {
    registerPluginPermissions({
      group: "automations",
      pluginId: "automations",
      label: "Automations",
      permissions: ["automations.run"],
    });

    const fixture = createFixturePlugin({
      id: "docker",
      capabilities: ["kv:own"],
      manifestOverrides: {
        category: "Infrastructure",
        contributes: {
          permissions: [permission("automations.run"), permission("ps")],
        },
      },
    });

    const { resetPluginRuntime, getPluginRuntime, activatePlugin } =
      await import("../../plugins/index.js");
    resetPluginRuntime();
    const loader = getPluginRuntime().loader;

    try {
      const plugin = await loader.load(fixture.dir);
      await activatePlugin(plugin.id);

      // Its own name registered; the one reaching into automations did not.
      expect(isValidPermission("docker.ps")).toBe(true);
      expect(isValidPermission("docker.automations.run")).toBe(false);
      expect(state.warnings.join()).toMatch(/belongs to someone else/);
      const { listRegistrationConflicts } =
        await import("../../plugins/conflicts.js");
      expect(listRegistrationConflicts()).toContainEqual(
        expect.objectContaining({ kind: "permission", heldBy: "automations" }),
      );
    } finally {
      await loader.shutdown();
      fixture.cleanup();
    }
  });

  it("only lets a route require a permission the plugin declares", () => {
    const parsed = parseManifest(manifest("ai", [permission("use")])).manifest!;

    expect(declaredPermissions(parsed).has("ai.use")).toBe(true);
    expect(() => createRbacMiddleware(parsed, "use")).not.toThrow();
    expect(() => createRbacMiddleware(parsed, "admin.users.manage")).toThrow(
      /cannot require permission/,
    );
  });
});

describe("a disabled plugin's permissions survive", () => {
  beforeEach(() => {
    registerPluginPermissions({
      group: "ai",
      pluginId: "ai",
      label: "AI Assistant",
      icon: "Sparkles",
      permissions: ["ai.use", "ai.services.use"],
    });
  });

  // The exact shape PUT /rbac/roles/:id validates, which used to 400 the whole
  // role while the plugin was off.
  it("keeps validating a role that holds them", () => {
    markPluginPermissionsDisabled("ai");

    const saved = ["hosts.view", "ai.use", "ai.services.use"];
    const invalid = saved.filter((entry) => !isValidPermission(entry));

    expect(invalid).toEqual([]);
  });

  it("keeps the group listed, marked disabled", () => {
    markPluginPermissionsDisabled("ai");

    const entry = getPermissionCatalog().find((row) => row.group === "ai");
    expect(entry?.enabled).toBe(false);
    expect(entry?.permissions).toContain("ai.use");
  });

  it("re-enables on the next registration", () => {
    markPluginPermissionsDisabled("ai");
    registerPluginPermissions({
      group: "ai",
      pluginId: "ai",
      label: "AI Assistant",
      permissions: ["ai.use", "ai.services.use"],
    });

    const entry = getPermissionCatalog().find((row) => row.group === "ai");
    expect(entry?.enabled).toBe(true);
  });
});

describe("the duplicate ai group is gone", () => {
  it("lists ai exactly once when the plugin registers", () => {
    registerPluginPermissions({
      group: "ai",
      pluginId: "ai",
      label: "AI Assistant",
      permissions: ["ai.use"],
    });

    const matches = getPermissionCatalog().filter(
      (entry) => entry.group === "ai",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].pluginId).toBe("ai");
  });
});

describe("shipped manifests keep their permission ids", () => {
  const root = path.resolve(import.meta.dirname, "../../../../plugins");

  function idsFor(pluginId: string): string[] {
    const raw = JSON.parse(
      fs.readFileSync(path.join(root, pluginId, "manifest.json"), "utf8"),
    );
    const { manifest: parsed, errors } = parseManifest(raw);
    expect(errors).toEqual([]);
    return (parsed?.contributes?.permissions ?? []).map((entry) =>
      qualifyPermission(pluginId, entry.name),
    );
  }

  // A role holding these today must keep working, which is only true because
  // <pluginId>.<name> reproduces the old id byte for byte.
  it("ai", () => {
    expect(idsFor("ai")).toEqual([
      "ai.use",
      "ai.manage_providers",
      "ai.apply_proposals",
      "ai.services.use",
      "ai.secrets.share",
    ]);
  });

  it("automations", () => {
    expect(idsFor("automations")).toEqual([
      "automations.view",
      "automations.create",
      "automations.edit",
      "automations.delete",
      "automations.run",
    ]);
  });

  it("tailscale", () => {
    expect(idsFor("tailscale")).toEqual(["tailscale.devices.view"]);
  });

  it("snippets", () => {
    expect(idsFor("snippets")).toEqual([
      "snippets.view",
      "snippets.create",
      "snippets.edit",
      "snippets.delete",
      "snippets.share",
    ]);
  });

  it("a role holding the old ids still validates once registered", () => {
    for (const pluginId of ["ai", "automations", "tailscale", "snippets"]) {
      const ids = idsFor(pluginId);
      registerPluginPermissions({
        group: pluginId,
        pluginId,
        label: pluginId,
        permissions: ids,
      });
    }

    const stored = [
      "ai.use",
      "ai.manage_providers",
      "ai.apply_proposals",
      "automations.run",
      "automations.view",
      "tailscale.devices.view",
      "snippets.view",
      "snippets.share",
    ];

    expect(stored.filter((entry) => !isValidPermission(entry))).toEqual([]);
  });
});

describe("role defaults apply exactly once", () => {
  let fixture: Fixture;
  let loader: InstanceType<typeof PluginLoader>;

  beforeEach(() => {
    state.roles.set("user", { id: 2, permissions: ["hosts.*"] });
    state.roles.set("admin", { id: 1, permissions: ["*"] });
  });

  afterEach(async () => {
    await loader?.shutdown();
    fixture?.cleanup();
  });

  async function registerOnce() {
    const { resetPluginRuntime, getPluginRuntime } =
      await import("../../plugins/index.js");
    resetPluginRuntime();
    loader = getPluginRuntime().loader;
    const plugin = await loader.load(fixture.dir);
    const { activatePlugin } = await import("../../plugins/index.js");
    await activatePlugin(plugin.id);
  }

  it("adds a declared default to the named role", async () => {
    fixture = createFixturePlugin({
      id: "docker",
      capabilities: ["kv:own"],
      manifestOverrides: {
        category: "Infrastructure",
        contributes: { permissions: [permission("run", ["user"])] },
      },
    });

    await registerOnce();

    expect(state.roles.get("user")?.permissions).toContain("docker.run");
    expect(state.appliedDefaults.has("user:docker.run")).toBe(true);
  });

  // The whole point of the ledger: an admin's revoke is a decision, not a gap.
  it("does not re-add a default an admin removed", async () => {
    fixture = createFixturePlugin({
      id: "docker",
      capabilities: ["kv:own"],
      manifestOverrides: {
        category: "Infrastructure",
        contributes: { permissions: [permission("run", ["user"])] },
      },
    });

    await registerOnce();
    expect(state.roles.get("user")?.permissions).toContain("docker.run");

    // The admin revokes it.
    state.roles.set("user", { id: 2, permissions: ["hosts.*"] });
    await loader.shutdown();

    await registerOnce();

    expect(state.roles.get("user")?.permissions).not.toContain("docker.run");
  });

  it("leaves a role alone when the plugin declares no defaults", async () => {
    fixture = createFixturePlugin({
      id: "docker",
      capabilities: ["kv:own"],
      manifestOverrides: {
        category: "Infrastructure",
        contributes: { permissions: [permission("run")] },
      },
    });

    await registerOnce();

    expect(state.roles.get("user")?.permissions).toEqual(["hosts.*"]);
    expect(isValidPermission("docker.run")).toBe(true);
  });

  it("records the qualified id, not the short name", async () => {
    fixture = createFixturePlugin({
      id: "docker",
      capabilities: ["kv:own"],
      manifestOverrides: {
        category: "Infrastructure",
        contributes: { permissions: [permission("containers.run", ["user"])] },
      },
    });

    await registerOnce();

    expect(state.roles.get("user")?.permissions).toContain(
      "docker.containers.run",
    );
    expect(state.known.has("docker.containers.run")).toBe(true);
  });
});
