import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  roles: new Map<string, { id: number; permissions: string | null }>(),
  userRoles: new Map<string, Set<string>>(),
  users: [] as { id: string; isAdmin: boolean }[],
  applied: [] as { roleName: string; permission: string }[],
  nextId: 1,
}));

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentRoleRepository: () => ({
    findRoleByName: async (name: string) => {
      const role = h.roles.get(name);
      return role ? { ...role, name } : null;
    },
    createRole: async (role: { name: string; permissions: string }) => {
      const id = h.nextId++;
      h.roles.set(role.name, { id, permissions: role.permissions });
      return id;
    },
    updateRole: async () => true,
    listUserRoleIds: async (userId: string) =>
      [...(h.userRoles.get(userId) ?? [])].map((name) => h.roles.get(name)!.id),
    userHasAnyRoleName: async (userId: string, names: string[]) =>
      names.some((name) => h.userRoles.get(userId)?.has(name)),
    assignRoleNameToUser: async (input: {
      userId: string;
      roleName: string;
    }) => {
      const set = h.userRoles.get(input.userId) ?? new Set();
      set.add(input.roleName);
      h.userRoles.set(input.userId, set);
      return true;
    },
    switchUserRoleName: async (input: {
      userId: string;
      addRoleName: string;
      removeRoleName: string;
    }) => {
      const set = h.userRoles.get(input.userId) ?? new Set();
      set.delete(input.removeRoleName);
      set.add(input.addRoleName);
      h.userRoles.set(input.userId, set);
      return { added: true, removed: true };
    },
  }),
  createCurrentUserRepository: () => ({ listAll: async () => h.users }),
  createCurrentRbacPermissionRepository: () => ({
    listAppliedDefaults: async () => h.applied,
    recordAppliedDefaults: async (
      entries: { roleName: string; permission: string }[],
    ) => {
      h.applied.push(...entries);
      return entries.length;
    },
  }),
}));

const { ensureSystemRoles } = await import("../../utils/system-roles.js");

beforeEach(() => {
  h.roles = new Map();
  h.userRoles = new Map();
  h.users = [];
  h.applied = [];
  h.nextId = 1;
});

describe("ensureSystemRoles", () => {
  it("creates the starter roles once and never brings back a deleted one", async () => {
    await ensureSystemRoles();
    expect([...h.roles.keys()].sort()).toEqual([
      "admin",
      "auditor",
      "helpdesk",
      "operator",
      "user",
      "viewer",
    ]);
    expect(JSON.parse(h.roles.get("auditor")!.permissions!)).toContain(
      "admin.audit.view",
    );

    h.roles.delete("viewer");
    await ensureSystemRoles();
    expect(h.roles.has("viewer")).toBe(false);
  });

  it("puts the admin role back in line with the admin flag", async () => {
    await ensureSystemRoles();
    h.users = [
      { id: "flagged", isAdmin: true },
      { id: "stale", isAdmin: false },
    ];
    h.userRoles.set("flagged", new Set(["user"]));
    h.userRoles.set("stale", new Set(["admin"]));

    await ensureSystemRoles();

    expect([...h.userRoles.get("flagged")!]).toEqual(["admin"]);
    expect([...h.userRoles.get("stale")!]).toEqual(["user"]);
  });
});
