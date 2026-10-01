import { describe, expect, it, afterEach } from "vitest";
import {
  PERMISSION_CATALOG,
  getPermissionCatalog,
  isValidPermission,
  loadKnownPermissions,
  markPluginPermissionsDisabled,
  registerPluginPermissions,
  rememberPermissionGroup,
  resetPermissionCatalog,
  SYSTEM_ROLE_DEFAULTS,
} from "../../utils/permission-catalog.js";

const GROUP = "testplugin";
const PERMISSIONS = ["testplugin.view", "testplugin.manage"];

function register() {
  registerPluginPermissions({
    group: GROUP,
    pluginId: GROUP,
    label: "Test Plugin",
    icon: "Sparkles",
    permissions: PERMISSIONS,
    items: PERMISSIONS.map((permission) => ({
      permission,
      titleKey: "permissions.x.title",
      descriptionKey: "permissions.x.description",
    })),
  });
}

describe("permission catalog", () => {
  afterEach(() => {
    resetPermissionCatalog();
  });

  it("accepts every cataloged permission and group wildcard", () => {
    for (const entry of PERMISSION_CATALOG) {
      expect(isValidPermission(`${entry.group}.*`)).toBe(true);
      for (const permission of entry.permissions) {
        expect(isValidPermission(permission)).toBe(true);
      }
    }
  });

  it("accepts the global wildcard", () => {
    expect(isValidPermission("*")).toBe(true);
  });

  it("rejects unknown permissions and malformed wildcards", () => {
    expect(isValidPermission("hosts.hack")).toBe(false);
    expect(isValidPermission("unknown.*")).toBe(false);
    expect(isValidPermission("")).toBe(false);
    expect(isValidPermission("hosts")).toBe(false);
  });

  // Both moved out to their plugins in A5; the ids did not change, so no role
  // had to be migrated.
  it("no longer carries the ai or automations groups", () => {
    const groups = PERMISSION_CATALOG.map((entry) => entry.group);
    expect(groups).not.toContain("ai");
    expect(groups).not.toContain("automations");
  });

  it("no longer seeds ai or automations onto the user role", () => {
    expect(SYSTEM_ROLE_DEFAULTS.user.permissions).not.toContain("ai.*");
    expect(SYSTEM_ROLE_DEFAULTS.user.permissions).not.toContain(
      "automations.*",
    );
    expect(SYSTEM_ROLE_DEFAULTS.user.permissions).toContain("hosts.*");
  });

  it("gives every core group a label key for the role editor", () => {
    for (const entry of PERMISSION_CATALOG) {
      expect(entry.labelKey).toBeTruthy();
    }
  });
});

describe("plugin permission lifecycle", () => {
  afterEach(() => {
    resetPermissionCatalog();
  });

  it("rejects a plugin's permissions before it registers", () => {
    expect(isValidPermission("testplugin.view")).toBe(false);
    expect(isValidPermission("testplugin.*")).toBe(false);
  });

  it("accepts them once registered", () => {
    register();

    expect(isValidPermission("testplugin.view")).toBe(true);
    expect(isValidPermission("testplugin.manage")).toBe(true);
    expect(isValidPermission("testplugin.*")).toBe(true);
  });

  it("carries the plugin id, label and icon into the catalog", () => {
    register();

    const entry = getPermissionCatalog().find((row) => row.group === GROUP);
    expect(entry?.pluginId).toBe(GROUP);
    expect(entry?.label).toBe("Test Plugin");
    expect(entry?.icon).toBe("Sparkles");
    expect(entry?.enabled).toBe(true);
    expect(entry?.items).toHaveLength(2);
  });

  // The bug A5 fixes: unregistering made PUT /rbac/roles/:id reject every role
  // that still held one of these, so an admin could not save an unrelated
  // change while the plugin was off.
  it("keeps a disabled plugin's permissions valid", () => {
    register();
    markPluginPermissionsDisabled(GROUP);

    expect(isValidPermission("testplugin.view")).toBe(true);
    expect(isValidPermission("testplugin.*")).toBe(true);
  });

  it("marks a disabled plugin's group so the editor can grey it", () => {
    register();
    markPluginPermissionsDisabled(GROUP);

    const entry = getPermissionCatalog().find((row) => row.group === GROUP);
    expect(entry?.enabled).toBe(false);
  });

  it("does not mutate the static PERMISSION_CATALOG array", () => {
    const originalLength = PERMISSION_CATALOG.length;
    register();

    expect(PERMISSION_CATALOG.length).toBe(originalLength);
    expect(PERMISSION_CATALOG.some((entry) => entry.group === GROUP)).toBe(
      false,
    );
  });

  it("lists a plugin group exactly once when re-registered", () => {
    register();
    register();

    const matches = getPermissionCatalog().filter(
      (entry) => entry.group === GROUP,
    );
    expect(matches).toHaveLength(1);
  });
});

describe("known permissions", () => {
  afterEach(() => {
    resetPermissionCatalog();
  });

  // The upgrade path: a permission a role already holds stays grantable even
  // if no plugin ever registers it again.
  it("accepts a permission loaded from the record with no plugin present", () => {
    expect(isValidPermission("gone.use")).toBe(false);

    loadKnownPermissions(["gone.use"]);

    expect(isValidPermission("gone.use")).toBe(true);
    expect(isValidPermission("gone.*")).toBe(true);
  });

  it("accepts a group recorded from a wildcard nothing else named", () => {
    rememberPermissionGroup("legacy");

    expect(isValidPermission("legacy.*")).toBe(true);
    // Still rejects a concrete permission nobody ever registered.
    expect(isValidPermission("legacy.invent")).toBe(false);
  });

  it("still rejects a permission nobody has ever registered", () => {
    loadKnownPermissions(["gone.use"]);

    expect(isValidPermission("madeup.use")).toBe(false);
  });
});
