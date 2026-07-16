import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { RoleRepository } from "./role-repository.js";

describe("RoleRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<RoleRepository> {
    adapter = new SqliteDatabaseAdapter({
      dialect: "sqlite",
      url: ":memory:",
      sqlitePath: ":memory:",
    });
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_oidc INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        description TEXT,
        is_system INTEGER NOT NULL DEFAULT 0,
        permissions TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE user_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        role_id INTEGER NOT NULL,
        granted_by TEXT,
        granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE host_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL,
        user_id TEXT,
        role_id INTEGER,
        granted_by TEXT NOT NULL,
        permission_level TEXT NOT NULL DEFAULT 'view',
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash, is_admin, is_oidc)
      VALUES ('admin', 'admin', 'hash', 1, 0), ('user-1', 'user', 'hash', 0, 0);
    `);

    return new RoleRepository(context, onWrite);
  }

  it("creates, lists, updates, and finds roles", async () => {
    const repo = await createRepository();

    const roleId = await repo.createRole({
      name: "ops",
      displayName: "Operations",
      description: "Ops access",
      isSystem: false,
      permissions: null,
    });

    expect((await repo.findRoleByName("ops"))?.id).toBe(roleId);
    expect((await repo.findRoleById(roleId))?.displayName).toBe("Operations");

    await repo.updateRole(roleId, {
      displayName: "Ops",
      description: null,
      updatedAt: "2026-06-26T00:00:00.000Z",
    });

    const roles = await repo.listRoles();
    expect(roles.map((role) => role.name)).toEqual(["ops"]);
    expect(roles[0].displayName).toBe("Ops");
    expect(roles[0].description).toBeNull();
  });

  it("assigns, lists, and removes user roles", async () => {
    const repo = await createRepository();
    const roleId = await repo.createRole({
      name: "ops",
      displayName: "Operations",
      isSystem: false,
      permissions: JSON.stringify(["hosts.read", "hosts.*"]),
    });

    await repo.assignRoleToUser({
      userId: "user-1",
      roleId,
      grantedBy: "admin",
    });

    expect(await repo.findUserRole("user-1", roleId)).not.toBeNull();
    expect(await repo.listUserRoleIds("user-1")).toEqual([roleId]);
    expect(await repo.listRoleUserIds(roleId)).toEqual(["user-1"]);
    expect((await repo.listUserRoles("user-1"))[0]).toMatchObject({
      roleId,
      roleName: "ops",
      roleDisplayName: "Operations",
      isSystem: false,
    });
    expect(await repo.listUserRolePermissions("user-1")).toEqual([
      { permissions: JSON.stringify(["hosts.read", "hosts.*"]) },
    ]);
    expect(await repo.userHasAnyRoleName("user-1", ["admin", "ops"])).toBe(
      true,
    );
    expect(await repo.userHasAnyRoleName("user-1", ["admin"])).toBe(false);
    expect(await repo.userHasAnyRoleName("user-1", [])).toBe(false);

    await repo.removeRoleFromUser("user-1", roleId);
    expect(await repo.findUserRole("user-1", roleId)).toBeNull();
  });

  it("assigns roles by name", async () => {
    const repo = await createRepository();
    const roleId = await repo.createRole({
      name: "user",
      displayName: "User",
      isSystem: true,
      permissions: null,
    });

    expect(
      await repo.assignRoleNameToUser({
        userId: "user-1",
        roleName: "missing",
        grantedBy: "admin",
      }),
    ).toBe(false);
    expect(await repo.listUserRoleIds("user-1")).toEqual([]);

    expect(
      await repo.assignRoleNameToUser({
        userId: "user-1",
        roleName: "user",
        grantedBy: "admin",
      }),
    ).toBe(true);
    expect(await repo.listUserRoleIds("user-1")).toEqual([roleId]);
  });

  it("switches user roles by role name", async () => {
    const repo = await createRepository();
    const userRoleId = await repo.createRole({
      name: "user",
      displayName: "User",
      isSystem: true,
      permissions: null,
    });
    const adminRoleId = await repo.createRole({
      name: "admin",
      displayName: "Admin",
      isSystem: true,
      permissions: null,
    });
    await repo.assignRoleToUser({
      userId: "user-1",
      roleId: userRoleId,
      grantedBy: "admin",
    });

    await expect(
      repo.switchUserRoleName({
        userId: "user-1",
        addRoleName: "admin",
        removeRoleName: "user",
        grantedBy: "admin",
      }),
    ).resolves.toEqual({ added: true, removed: true });
    expect(await repo.listUserRoleIds("user-1")).toEqual([adminRoleId]);

    await expect(
      repo.switchUserRoleName({
        userId: "user-1",
        addRoleName: "missing",
        removeRoleName: "admin",
        grantedBy: "admin",
      }),
    ).resolves.toEqual({ added: false, removed: true });
    expect(await repo.listUserRoleIds("user-1")).toEqual([]);
  });

  it("deletes role assignments and returns affected users", async () => {
    const repo = await createRepository();
    const roleId = await repo.createRole({
      name: "ops",
      displayName: "Operations",
      isSystem: false,
      permissions: null,
    });
    await repo.assignRoleToUser({
      userId: "user-1",
      roleId,
      grantedBy: "admin",
    });

    const result = await repo.deleteRole(roleId);

    expect(result.deletedUserIds).toEqual(["user-1"]);
    expect(await repo.findRoleById(roleId)).toBeNull();
    expect(await repo.listUserRoleIds("user-1")).toEqual([]);
  });

  it("removes all roles for a user only when assignments exist", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });
    const opsRoleId = await repo.createRole({
      name: "ops",
      displayName: "Operations",
      isSystem: false,
      permissions: null,
    });
    const auditRoleId = await repo.createRole({
      name: "audit",
      displayName: "Audit",
      isSystem: false,
      permissions: null,
    });
    await repo.assignRoleToUser({
      userId: "user-1",
      roleId: opsRoleId,
      grantedBy: "admin",
    });
    await repo.assignRoleToUser({
      userId: "user-1",
      roleId: auditRoleId,
      grantedBy: "admin",
    });

    expect(await repo.removeAllRolesFromUser("missing-user")).toBe(0);
    expect(writeCount).toBe(4);

    expect(await repo.removeAllRolesFromUser("user-1")).toBe(2);
    expect(await repo.listUserRoleIds("user-1")).toEqual([]);
    expect(writeCount).toBe(5);
  });

  it("runs the write hook after writes", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const roleId = await repo.createRole({
      name: "ops",
      displayName: "Operations",
      isSystem: false,
      permissions: null,
    });
    await repo.assignRoleToUser({
      userId: "user-1",
      roleId,
      grantedBy: "admin",
    });
    await repo.updateRole(roleId, { displayName: "Ops" });
    await repo.removeRoleFromUser("user-1", roleId);
    await repo.deleteRole(roleId);

    expect(writeCount).toBe(5);
  });
});
