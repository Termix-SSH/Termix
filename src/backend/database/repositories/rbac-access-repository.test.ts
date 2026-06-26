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

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<RbacAccessRepository> {
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
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_accessed_at TEXT,
        access_count INTEGER NOT NULL DEFAULT 0,
        override_credential_id INTEGER
      );

      CREATE TABLE shared_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_access_id INTEGER NOT NULL,
        credential_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        encrypted_data TEXT
      );

      CREATE TABLE ssh_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT,
        ip TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT NOT NULL,
        credential_id INTEGER,
        folder TEXT,
        tags TEXT
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

      INSERT INTO ssh_data (id, user_id, name, ip, port, username, credential_id, folder, tags)
      VALUES (42, 'owner-1', 'prod', '10.0.0.42', 22, 'root', 123, 'servers', 'linux');

      INSERT INTO host_access (
        id, host_id, user_id, role_id, granted_by, permission_level, expires_at, created_at
      )
      VALUES
        (1, 42, 'user-1', NULL, 'admin', 'view', NULL, '2026-06-26T00:00:00.000Z'),
        (2, 42, NULL, 7, 'admin', 'view', '2026-06-27T00:00:00.000Z', '2026-06-26T01:00:00.000Z'),
        (5, 44, 'user-1', NULL, 'admin', 'view', '2026-06-25T00:00:00.000Z', '2026-06-24T00:00:00.000Z');

      INSERT INTO snippets (id, user_id, name, content)
      VALUES (99, 'owner-1', 'deploy', 'echo deploy');

      INSERT INTO snippet_access (
        id, snippet_id, user_id, role_id, granted_by, permission_level, expires_at, created_at
      )
      VALUES
        (3, 99, 'user-1', NULL, 'admin', 'view', NULL, '2026-06-26T00:00:00.000Z'),
        (4, 99, NULL, 7, 'admin', 'view', '2026-06-27T00:00:00.000Z', '2026-06-26T01:00:00.000Z');
    `);

    return new RbacAccessRepository(context, onWrite);
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

  it("lists shared hosts for direct and role access", async () => {
    const repo = await createRepository();

    const sharedHosts = await repo.listSharedHosts("user-1", [7]);

    expect(sharedHosts).toMatchObject([
      {
        id: 42,
        name: "prod",
        ip: "10.0.0.42",
        ownerUsername: "owner",
        permissionLevel: "view",
      },
      {
        id: 42,
        name: "prod",
        ip: "10.0.0.42",
        ownerUsername: "owner",
        permissionLevel: "view",
      },
    ]);
  });

  it("lists role host access credential sources for role assignment", async () => {
    const repo = await createRepository();

    await expect(repo.listRoleHostAccessCredentialSources(7)).resolves.toEqual([
      {
        hostAccessId: 2,
        credentialId: 123,
        hostId: 42,
        hostOwnerId: "owner-1",
      },
    ]);
  });

  it("lists shared snippets and preserves route-level direct-over-role behavior", async () => {
    const repo = await createRepository();

    const sharedSnippets = await repo.listSharedSnippets("user-1", [7]);

    expect(sharedSnippets).toHaveLength(1);
    expect(sharedSnippets[0]).toMatchObject({
      id: 99,
      name: "deploy",
      ownerUsername: "owner",
      permissionLevel: "view",
    });
  });

  it("lists visible shared snippets for the main snippets route", async () => {
    const repo = await createRepository();

    const sharedSnippets = await repo.listVisibleSharedSnippets("user-1", [7]);

    expect(sharedSnippets.map((snippet) => snippet.id)).toEqual([99, 99]);
    expect(sharedSnippets[0]).toMatchObject({
      userId: "owner-1",
      name: "deploy",
      content: "echo deploy",
      ownerUsername: "owner",
    });
  });

  it("upserts host access and updates overrides", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const updated = await repo.upsertHostAccess({
      hostId: 42,
      targetType: "user",
      targetUserId: "user-1",
      grantedBy: "admin",
      permissionLevel: "view",
      expiresAt: "2026-06-28T00:00:00.000Z",
    });

    expect(updated).toEqual({ id: 1, created: false });
    expect(
      (await repo.listHostAccess(42)).find((row) => row.id === 1),
    ).toMatchObject({
      expiresAt: "2026-06-28T00:00:00.000Z",
    });

    const created = await repo.upsertHostAccess({
      hostId: 43,
      targetType: "role",
      targetRoleId: 7,
      grantedBy: "admin",
      permissionLevel: "view",
      expiresAt: null,
    });
    expect(created.created).toBe(true);

    const directAccess = await repo.findDirectHostAccess(42, "user-1");
    expect(directAccess?.id).toBe(1);

    await repo.updateHostAccessOverrideCredential(1, 123);
    expect(
      (await repo.findDirectHostAccess(42, "user-1"))?.overrideCredentialId,
    ).toBe(123);

    await repo.touchHostAccess(1, "2026-06-26T03:00:00.000Z");
    expect(
      (await repo.findDirectHostAccess(42, "user-1"))?.lastAccessedAt,
    ).toBe("2026-06-26T03:00:00.000Z");

    await repo.revokeHostAccess(1);
    expect(await repo.findDirectHostAccess(42, "user-1")).toBeNull();
    expect(writeCount).toBe(5);
  });

  it("finds active host access and deletes expired host access", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    expect(
      await repo.findActiveHostAccess(
        42,
        "user-1",
        [7],
        "2026-06-26T12:00:00.000Z",
      ),
    ).toMatchObject({ id: 1 });
    expect(
      await repo.findActiveHostAccess(
        44,
        "user-1",
        [],
        "2026-06-26T12:00:00.000Z",
      ),
    ).toBeNull();

    expect(await repo.deleteExpiredHostAccess("2026-06-26T12:00:00.000Z")).toBe(
      1,
    );
    expect(await repo.findDirectHostAccess(44, "user-1")).toBeNull();
    expect(writeCount).toBe(1);
  });

  it("upserts and revokes snippet access", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const updated = await repo.upsertSnippetAccess({
      snippetId: 99,
      targetType: "user",
      targetUserId: "user-1",
      grantedBy: "admin",
      expiresAt: "2026-06-28T00:00:00.000Z",
    });

    expect(updated).toEqual({ id: 3, created: false });
    expect(
      (await repo.listSnippetAccess(99)).find((row) => row.id === 3),
    ).toMatchObject({ expiresAt: "2026-06-28T00:00:00.000Z" });

    const created = await repo.upsertSnippetAccess({
      snippetId: 100,
      targetType: "role",
      targetRoleId: 7,
      grantedBy: "admin",
      expiresAt: null,
    });
    expect(created.created).toBe(true);

    await repo.revokeSnippetAccess(3);
    expect((await repo.listSnippetAccess(99)).map((row) => row.id)).toEqual([
      4,
    ]);
    expect(writeCount).toBe(3);
  });
});
