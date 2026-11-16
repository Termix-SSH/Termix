/**
 * ctx.users account calls: make, change, turn off, delete and give roles to
 * accounts under users:write, with the last admin always kept and every
 * change audited under the plugin's name.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthState,
  fakeAuthManager,
  type AuthState,
} from "../auth/auth-test-helpers.js";

const h = vi.hoisted(() => ({
  state: null as unknown as AuthState,
  manager: null as unknown as ReturnType<
    typeof import("../auth/auth-test-helpers.js").fakeAuthManager
  >,
  deleted: [] as Array<{ userId: string; successorUserId?: string }>,
}));

vi.mock("../../database/repositories/factory.js", async () => {
  const helpers = await import("../auth/auth-test-helpers.js");
  const names = Object.keys(helpers.fakeFactory(helpers.createAuthState()));
  return Object.fromEntries(
    names.map((name) => [
      name,
      (...args: unknown[]) =>
        (
          helpers.fakeFactory(h.state) as Record<
            string,
            (...a: unknown[]) => unknown
          >
        )[name](...args),
    ]),
  );
});
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: { getInstance: () => h.manager },
}));
vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    h.state.audits.push(entry);
  },
}));
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave: vi.fn(async () => {}) },
}));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({ invalidateUserPermissionCache: vi.fn() }),
  },
}));
vi.mock("../../auth/admin-status.js", () => ({
  afterAdminStatusChange: vi.fn(async () => {}),
}));
vi.mock("../../database/routes/delete-user-data.js", () => ({
  deleteUserAndRelatedData: vi.fn(
    async (userId: string, options: { successorUserId?: string }) => {
      h.deleted.push({ userId, successorUserId: options.successorUserId });
      h.state.users.delete(userId);
    },
  ),
}));
vi.mock("../../plugins/permissions.js", () => ({
  assertCapability: async (
    _pluginId: string,
    capability: string,
    granted: string[],
  ) => {
    if (!granted.includes(capability)) {
      throw Object.assign(new Error(`needs ${capability}`), {
        code: "capability",
      });
    }
  },
}));

const { createPluginUsers } = await import("../../plugins/ctx-users.js");

function users(capabilities = ["users:read", "users:write"]) {
  return createPluginUsers({
    id: "scim",
    name: "SCIM",
    version: "1.0.0",
    capabilities,
  } as never);
}

function addUser(id: string, extra: Record<string, unknown> = {}) {
  h.state.users.set(id, {
    id,
    username: id,
    passwordHash: "hash",
    isAdmin: false,
    ...extra,
  } as never);
}

beforeEach(() => {
  h.state = createAuthState();
  h.manager = fakeAuthManager(h.state);
  h.deleted = [];
  addUser("root", { isAdmin: true });
});

describe("ctx.users capabilities", () => {
  it("needs users:read to look and users:write to change", async () => {
    await expect(users([]).get("root")).rejects.toMatchObject({
      code: "capability",
    });
    await expect(
      users(["users:read"]).create({ username: "bob" }),
    ).rejects.toMatchObject({ code: "capability" });
    expect(await users(["users:read"]).get("root")).toMatchObject({
      id: "root",
      isAdmin: true,
    });
  });

  it("never shows a password hash", async () => {
    const user = await users().get("root");
    expect(JSON.stringify(user)).not.toContain("hash");
  });
});

describe("ctx.users.create", () => {
  it("makes a managed account with the user role and a data key", async () => {
    const made = await users().create({
      username: "bob@example.com",
      displayName: "Bob",
      email: "Bob@Example.com",
    });
    expect(made).toMatchObject({
      username: "bob@example.com",
      displayName: "Bob",
      email: "bob@example.com",
      isAdmin: false,
      managedBy: "scim",
    });
    expect(h.state.users.get(made.id)!.passwordHash).toBe("");
    expect(h.state.roles).toContainEqual({ userId: made.id, roleName: "user" });
    expect(h.manager.registerExternalUser).toHaveBeenCalledWith(made.id);
    expect(h.state.audits).toContainEqual(
      expect.objectContaining({
        action: "plugin_user_create",
        username: "plugin:scim",
        resourceId: made.id,
      }),
    );
  });

  it("refuses a taken username or email and a bad email", async () => {
    addUser("carol", { email: "carol@example.com" });
    await expect(users().create({ username: "carol" })).rejects.toMatchObject({
      code: "username_taken",
    });
    await expect(
      users().create({ username: "c2", email: "carol@example.com" }),
    ).rejects.toMatchObject({ code: "email_taken" });
    await expect(
      users().create({ username: "c3", email: "not-an-email" }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(users().create({ username: " " })).rejects.toMatchObject({
      code: "invalid",
    });
  });
});

describe("ctx.users changes", () => {
  it("renames and refuses a taken name", async () => {
    addUser("bob");
    addUser("carol");
    expect((await users().update("bob", { username: "robert" })).username).toBe(
      "robert",
    );
    await expect(
      users().update("bob", { username: "carol" }),
    ).rejects.toMatchObject({ code: "username_taken" });
    await expect(users().update("nobody", {})).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("turns an account off and on, never the last admin", async () => {
    addUser("bob");
    await users().setDisabled("bob", true, "scim");
    expect(h.state.users.get("bob")).toMatchObject({ disabledReason: "scim" });
    expect(h.manager.revokeAllUserSessions).toHaveBeenCalledWith("bob");
    await users().setDisabled("bob", false);
    expect(h.state.users.get("bob")!.disabledAt).toBeNull();

    await expect(users().setDisabled("root", true)).rejects.toMatchObject({
      code: "last_admin",
    });
    expect(h.state.audits.map((a) => a.action)).toEqual([
      "plugin_user_disable",
      "plugin_user_enable",
    ]);
  });

  it("deletes an account and never the last admin", async () => {
    addUser("bob");
    await users().delete("bob", { successorUserId: "root" });
    expect(h.deleted).toEqual([{ userId: "bob", successorUserId: "root" }]);
    await expect(users().delete("root")).rejects.toMatchObject({
      code: "last_admin",
    });
  });

  it("syncs only managed roles and never system roles", async () => {
    addUser("bob");
    h.state.roles.push(
      { userId: "bob", roleName: "user" },
      { userId: "bob", roleName: "ops" },
      { userId: "bob", roleName: "by-hand" },
    );
    await users().syncRoles("bob", {
      desired: ["viewer", "admin"],
      managed: ["viewer", "ops", "user"],
    });
    const names = h.state.roles
      .filter((role) => role.userId === "bob")
      .map((role) => role.roleName)
      .sort();
    expect(names).toEqual(["by-hand", "user", "viewer"]);
    expect(h.state.users.get("bob")!.isAdmin).toBe(false);
  });

  it("makes and unmakes admins, never the last one", async () => {
    addUser("bob");
    await users().setAdmin("bob", true);
    expect(h.state.users.get("bob")!.isAdmin).toBe(true);
    await users().setAdmin("bob", false);
    expect(h.state.users.get("bob")!.isAdmin).toBe(false);
    await expect(users().setAdmin("root", false)).rejects.toMatchObject({
      code: "last_admin",
    });
  });
});
