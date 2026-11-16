import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { AccessReviewRepository } from "../../../database/repositories/access-review-repository.js";
import { UserInviteRepository } from "../../../database/repositories/user-invite-repository.js";

describe("AccessReviewRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function seed() {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash, is_admin)
      VALUES ('owner', 'owner', 'hash', 0), ('alice', 'alice', 'hash', 0),
             ('bob', 'bob', 'hash', 0);
      INSERT INTO roles (id, name, display_name, is_system, permissions)
      VALUES (10, 'ops', 'Ops', 0, '[]');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type)
      VALUES (1, 'owner', 'web', '10.0.0.1', 22, 'root', 'password');
      INSERT INTO ssh_credentials (id, user_id, name, auth_type, username)
      VALUES (5, 'owner', 'deploy key', 'key', 'root');
      INSERT INTO host_access (host_id, user_id, granted_by, permission_level, created_at)
      VALUES (1, 'alice', 'owner', 'view', '2026-11-01T00:00:00.000Z');
      INSERT INTO host_access (host_id, role_id, granted_by, permission_level, created_at)
      VALUES (1, 10, 'owner', 'connect', '2026-11-02T00:00:00.000Z');
      INSERT INTO folder_access (owner_user_id, folder, user_id, granted_by, permission_level, expires_at, created_at)
      VALUES ('owner', 'Prod', 'bob', 'owner', 'connect', '2020-01-01T00:00:00.000Z', '2026-11-03T00:00:00.000Z');
      INSERT INTO credential_access (credential_id, user_id, granted_by, permission_level, created_at)
      VALUES (5, 'bob', 'owner', 'use', '2026-11-04T00:00:00.000Z');
    `);
    return new AccessReviewRepository(context);
  }

  it("lists every kind of share, newest first", async () => {
    const repo = await seed();
    const rows = await repo.list();
    expect(rows.map((row) => row.kind)).toEqual([
      "credential",
      "folder",
      "host",
      "host",
    ]);
    const role = rows.find((row) => row.granteeRoleName === "ops");
    expect(role).toMatchObject({
      targetName: "web",
      permissionLevel: "connect",
    });
    expect(rows[0]).toMatchObject({
      targetName: "deploy key",
      granteeUsername: "bob",
      grantedByUsername: "owner",
    });
  });

  it("filters by kind and by user", async () => {
    const repo = await seed();
    expect((await repo.list({ kind: "folder" })).length).toBe(1);
    const alice = await repo.list({ userId: "alice" });
    expect(alice.map((row) => row.granteeUsername)).toEqual(["alice"]);
    const owner = await repo.list({ userId: "owner" });
    expect(owner.length).toBe(4);
  });

  it("removes folder and credential shares that ran out", async () => {
    const repo = await seed();
    expect(await repo.deleteExpired("2026-12-01T00:00:00.000Z")).toBe(1);
    expect((await repo.list({ kind: "folder" })).length).toBe(0);
    expect((await repo.list({ kind: "credential" })).length).toBe(1);
  });
});

describe("UserInviteRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  it("hands out each use once and stops when revoked", async () => {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(
      `INSERT INTO users (id, username, password_hash, is_admin) VALUES ('admin', 'admin', 'hash', 1);`,
    );
    const repo = new UserInviteRepository(context);
    await repo.create({
      id: "inv1",
      tokenHash: "sha256:abc",
      maxUses: 2,
      uses: 0,
      makeAdmin: false,
      createdBy: "admin",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    expect(await repo.claimUse("inv1")).toBe(true);
    expect(await repo.claimUse("inv1")).toBe(true);
    expect(await repo.claimUse("inv1")).toBe(false);
    await repo.releaseUse("inv1");
    expect(await repo.revoke("inv1")).toBe(true);
    expect(await repo.claimUse("inv1")).toBe(false);

    const listed = await repo.list();
    expect(listed[0]).toMatchObject({
      id: "inv1",
      createdByUsername: "admin",
      uses: 1,
    });
    expect(listed[0]).not.toHaveProperty("tokenHash");
    expect((await repo.findByTokenHash("sha256:abc"))?.id).toBe("inv1");
  });
});
