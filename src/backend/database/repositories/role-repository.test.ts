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
