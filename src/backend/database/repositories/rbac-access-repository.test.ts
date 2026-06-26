import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { RbacAccessRepository } from "./rbac-access-repository.js";

describe("RbacAccessRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(): Promise<RbacAccessRepository> {
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

      CREATE TABLE snippets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        description TEXT,
        folder TEXT,
        "order" INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        host_filter TEXT
      );

      CREATE TABLE snippet_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snippet_id INTEGER NOT NULL,
        user_id TEXT,
        role_id INTEGER,
        granted_by TEXT NOT NULL,
        permission_level TEXT NOT NULL DEFAULT 'view',
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash, is_admin, is_oidc)
      VALUES
        ('admin', 'admin', 'hash', 1, 0),
        ('user-1', 'alice', 'hash', 0, 0),
        ('owner-1', 'owner', 'hash', 0, 0);

      INSERT INTO roles (id, name, display_name, is_system)
      VALUES (7, 'ops', 'Operations', 0);

      INSERT INTO host_access (
        id, host_id, user_id, role_id, granted_by, permission_level, expires_at, created_at
      )
      VALUES
        (1, 42, 'user-1', NULL, 'admin', 'view', NULL, '2026-06-26T00:00:00.000Z'),
        (2, 42, NULL, 7, 'admin', 'view', '2026-06-27T00:00:00.000Z', '2026-06-26T01:00:00.000Z');

      INSERT INTO snippets (id, user_id, name, content)
      VALUES (99, 'owner-1', 'deploy', 'echo deploy');

      INSERT INTO snippet_access (
        id, snippet_id, user_id, role_id, granted_by, permission_level, expires_at, created_at
      )
      VALUES
        (3, 99, 'user-1', NULL, 'admin', 'view', NULL, '2026-06-26T00:00:00.000Z'),
        (4, 99, NULL, 7, 'admin', 'view', '2026-06-27T00:00:00.000Z', '2026-06-26T01:00:00.000Z');
    `);

    return new RbacAccessRepository(context);
  }

  it("lists host access with user and role target metadata", async () => {
    const repo = await createRepository();

    const accessList = await repo.listHostAccess(42);

    expect(accessList).toMatchObject([
      {
        id: 2,
        targetType: "role",
        userId: null,
        roleId: 7,
        username: null,
        roleName: "ops",
        roleDisplayName: "Operations",
        grantedByUsername: "admin",
      },
      {
        id: 1,
        targetType: "user",
        userId: "user-1",
        roleId: null,
        username: "alice",
        roleName: null,
        roleDisplayName: null,
        grantedByUsername: "admin",
      },
    ]);
  });

  it("lists snippet access with user and role target metadata", async () => {
    const repo = await createRepository();

    const accessList = await repo.listSnippetAccess(99);

    expect(accessList.map((access) => access.targetType)).toEqual([
      "role",
      "user",
    ]);
    expect(accessList[0]).toMatchObject({
      id: 4,
      roleId: 7,
      roleName: "ops",
      grantedByUsername: "admin",
    });
    expect(accessList[1]).toMatchObject({
      id: 3,
      userId: "user-1",
      username: "alice",
      grantedByUsername: "admin",
    });
  });
});
