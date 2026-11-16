/**
 * Removing someone's admin rights takes effect at once: cached permissions
 * are dropped and their sessions end. The admin role only counts while the
 * admin flag is set.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  users: new Map<
    string,
    { id: string; isAdmin: boolean; disabledAt: string | null }
  >(),
  roles: new Map<string, { roleName: string; permissions: string }[]>(),
  revoked: [] as string[],
}));

vi.mock("../../database/db/index.js", () => ({ db: {} }));
vi.mock("../../utils/logger.js", () => {
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  };
  return { databaseLogger: log, authLogger: log };
});
vi.mock("../../database/repositories/factory.js", () => ({
  getCurrentSettingValue: () => null,
  createCurrentAccessReviewRepository: () => ({ deleteExpired: async () => 0 }),
  createCurrentRbacAccessRepository: () => ({
    deleteExpiredHostAccess: async () => 0,
  }),
  createCurrentHostResolutionRepository: () => ({}),
  createCurrentRoleRepository: () => ({
    listUserRolePermissions: async (userId: string) =>
      h.roles.get(userId) ?? [],
  }),
  createCurrentUserRepository: () => ({
    findById: async (userId: string) => h.users.get(userId) ?? null,
  }),
}));
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      revokeAllUserSessions: async (userId: string) => {
        h.revoked.push(userId);
        return 1;
      },
    }),
  },
}));

const { PermissionManager } = await import("../../utils/permission-manager.js");
const { afterAdminStatusChange } = await import("../../auth/admin-status.js");

const ADMIN_ROLE = { roleName: "admin", permissions: '["*"]' };

describe("GHSA-24pw-mffg-75q8 demoted admins lose rights at once", () => {
  beforeEach(() => {
    h.users.clear();
    h.roles.clear();
    h.revoked = [];
  });

  it("drops cached admin permissions and ends sessions on demotion", async () => {
    const manager = PermissionManager.getInstance();
    h.users.set("u1", { id: "u1", isAdmin: true, disabledAt: null });
    h.roles.set("u1", [ADMIN_ROLE]);
    expect(await manager.hasPermission("u1", "admin.plugins.manage")).toBe(
      true,
    );

    h.users.set("u1", { id: "u1", isAdmin: false, disabledAt: null });
    h.roles.set("u1", [{ roleName: "user", permissions: '["hosts.*"]' }]);
    await afterAdminStatusChange("u1", false);

    expect(await manager.hasPermission("u1", "admin.plugins.manage")).toBe(
      false,
    );
    expect(h.revoked).toEqual(["u1"]);
  });

  it("ignores an admin role left on a user without the admin flag", async () => {
    const manager = PermissionManager.getInstance();
    manager.invalidateUserPermissionCache("u2");
    h.users.set("u2", { id: "u2", isAdmin: false, disabledAt: null });
    h.roles.set("u2", [ADMIN_ROLE]);

    expect(await manager.hasPermission("u2", "admin.roles.manage")).toBe(false);
    expect(await manager.isAdmin("u2")).toBe(false);
  });

  it("gives a turned off account no permissions", async () => {
    const manager = PermissionManager.getInstance();
    manager.invalidateUserPermissionCache("u3");
    h.users.set("u3", {
      id: "u3",
      isAdmin: true,
      disabledAt: "2026-11-16T00:00:00.000Z",
    });
    h.roles.set("u3", [ADMIN_ROLE]);

    expect(await manager.getUserPermissions("u3")).toEqual([]);
    expect(await manager.isAdmin("u3")).toBe(false);
  });

  it("keeps sessions when someone is made admin", async () => {
    h.users.set("u4", { id: "u4", isAdmin: true, disabledAt: null });
    await afterAdminStatusChange("u4", true);
    expect(h.revoked).toEqual([]);
  });
});
