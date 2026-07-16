import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { VaultProfileRepository } from "./vault-profile-repository.js";

describe("VaultProfileRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<VaultProfileRepository> {
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
        password_hash TEXT NOT NULL
      );

      CREATE TABLE vault_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        folder TEXT,
        tags TEXT,
        vault_addr TEXT NOT NULL,
        vault_namespace TEXT,
        oidc_mount TEXT,
        oidc_role TEXT,
        ssh_mount TEXT,
        ssh_role TEXT NOT NULL,
        valid_principals TEXT,
        key_type TEXT,
        shared INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO vault_profiles (
        id, user_id, name, vault_addr, ssh_role, shared, updated_at
      )
      VALUES
        (1, 'user-1', 'owned', 'https://vault.one', 'role-one', 0, '2026-01-01T00:00:00.000Z'),
        (2, 'user-2', 'shared', 'https://vault.two', 'role-two', 1, '2026-01-02T00:00:00.000Z'),
        (3, 'user-2', 'hidden', 'https://vault.three', 'role-three', 0, '2026-01-03T00:00:00.000Z');
    `);

    return new VaultProfileRepository(context, onWrite);
  }

  it("lists profiles owned by or shared with the user", async () => {
    const repo = await createRepository();

    const rows = await repo.listVisibleToUser("user-1");

    expect(rows.map((row) => row.id)).toEqual([2, 1]);
  });

  it("creates and reads a profile", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const created = await repo.create({
      userId: "user-1",
      name: "new",
      description: "desc",
      folder: "folder",
      tags: "prod,ssh",
      vaultAddr: "https://vault.new",
      vaultNamespace: "ns",
      oidcMount: "oidc",
      oidcRole: "oidc-role",
      sshMount: "ssh",
      sshRole: "ssh-role",
      validPrincipals: "root",
      keyType: "ed25519",
      shared: true,
    });

    const found = await repo.findById(created.id);
    expect(found).toMatchObject({
      userId: "user-1",
      name: "new",
      vaultAddr: "https://vault.new",
      sshRole: "ssh-role",
      shared: true,
    });
    expect(writeCount).toBe(1);
  });

  it("updates and deletes profiles", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const updated = await repo.updateById(1, {
      name: "renamed",
      shared: true,
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(updated).toMatchObject({
      id: 1,
      name: "renamed",
      shared: true,
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    expect(await repo.updateById(999, { name: "missing" })).toBeNull();
    expect(await repo.deleteById(1)).toBe(true);
    expect(await repo.deleteById(1)).toBe(false);
    expect(await repo.findById(1)).toBeNull();
    expect(writeCount).toBe(2);
  });

  it("deletes all profiles for a user", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await expect(repo.deleteByUserId("user-2")).resolves.toBe(2);
    await expect(repo.deleteByUserId("missing")).resolves.toBe(0);

    expect(await repo.findById(2)).toBeNull();
    expect(await repo.findById(3)).toBeNull();
    expect((await repo.findById(1))?.userId).toBe("user-1");
    expect(writeCount).toBe(1);
  });
});
