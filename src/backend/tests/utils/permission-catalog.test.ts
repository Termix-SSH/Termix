import { describe, expect, it, afterEach } from "vitest";
import {
  PERMISSION_CATALOG,
  getPermissionCatalog,
  isValidPermission,
  registerPermissionGroup,
  unregisterPermissionGroup,
} from "../../utils/permission-catalog.js";

describe("permission catalog", () => {
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
});

describe("runtime permission group lifecycle", () => {
  const group = "testplugin";
  const permissions = ["testplugin.view", "testplugin.manage"];

  afterEach(() => {
    unregisterPermissionGroup(group);
  });

  it("rejects a group's permissions before it is registered", () => {
    expect(isValidPermission("testplugin.view")).toBe(false);
    expect(isValidPermission("testplugin.*")).toBe(false);
  });

  it("accepts a group's permissions and wildcard once registered", () => {
    registerPermissionGroup({ group, permissions });

    expect(isValidPermission("testplugin.view")).toBe(true);
    expect(isValidPermission("testplugin.manage")).toBe(true);
    expect(isValidPermission("testplugin.*")).toBe(true);
    expect(isValidPermission("*")).toBe(true);
  });

  it("rejects a group's permissions again after it is unregistered", () => {
    registerPermissionGroup({ group, permissions });
    expect(isValidPermission("testplugin.view")).toBe(true);

    unregisterPermissionGroup(group);

    expect(isValidPermission("testplugin.view")).toBe(false);
    expect(isValidPermission("testplugin.*")).toBe(false);
  });

  it("includes registered groups in getPermissionCatalog and drops them on unregister", () => {
    expect(getPermissionCatalog().some((entry) => entry.group === group)).toBe(
      false,
    );

    registerPermissionGroup({ group, permissions });
    expect(getPermissionCatalog().some((entry) => entry.group === group)).toBe(
      true,
    );

    unregisterPermissionGroup(group);
    expect(getPermissionCatalog().some((entry) => entry.group === group)).toBe(
      false,
    );
  });

  it("does not mutate the static PERMISSION_CATALOG array", () => {
    const originalLength = PERMISSION_CATALOG.length;
    registerPermissionGroup({ group, permissions });

    expect(PERMISSION_CATALOG.length).toBe(originalLength);
    expect(PERMISSION_CATALOG.some((entry) => entry.group === group)).toBe(
      false,
    );
  });

  it("overwrites an existing runtime group when re-registered with the same name", () => {
    registerPermissionGroup({ group, permissions: ["testplugin.view"] });
    expect(isValidPermission("testplugin.manage")).toBe(false);

    registerPermissionGroup({
      group,
      permissions: ["testplugin.view", "testplugin.manage"],
    });
    expect(isValidPermission("testplugin.manage")).toBe(true);
  });
});
