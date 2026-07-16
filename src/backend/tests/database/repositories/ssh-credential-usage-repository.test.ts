import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { SshCredentialUsageRepository } from "../../../database/repositories/ssh-credential-usage-repository.js";

describe("SshCredentialUsageRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<SshCredentialUsageRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_oidc INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE hosts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL
      );

      CREATE TABLE ssh_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL
      );

      CREATE TABLE ssh_credential_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        credential_id INTEGER NOT NULL,
        host_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO hosts (id, user_id, name)
      VALUES (1, 'user-1', 'one'), (2, 'user-1', 'two'), (3, 'user-2', 'other');
      INSERT INTO ssh_credentials (id, user_id, name)
      VALUES (1, 'user-1', 'cred-one'), (2, 'user-2', 'cred-two');
    `);

    return new SshCredentialUsageRepository(context, onWrite);
  }

  it("creates usage records", async () => {
    const repo = await createRepository();

    const created = await repo.create(1, 1, "user-1");

    expect(created).toMatchObject({
      credentialId: 1,
      hostId: 1,
      userId: "user-1",
    });
  });

  it("lists usage records by user", async () => {
    const repo = await createRepository();

    await repo.create(1, 1, "user-1");
    await repo.create(1, 2, "user-1");
    await repo.create(2, 3, "user-2");

    expect(
      (await repo.listByUserId("user-1")).map((row) => row.hostId),
    ).toEqual([1, 2]);
  });

  it("deletes usage records by user, host, and host list", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.create(1, 1, "user-1");
    await repo.create(1, 2, "user-1");
    await repo.create(2, 3, "user-2");
    expect(writeCount).toBe(3);

    expect(await repo.deleteByHostId(1)).toBe(1);
    expect(await repo.deleteByHostId(1)).toBe(0);
    expect(await repo.deleteByHostIds([])).toBe(0);
    expect(await repo.deleteByHostIds([2])).toBe(1);
    expect(writeCount).toBe(5);

    expect(await repo.deleteByUserId("user-2")).toBe(1);
    expect(await repo.deleteByUserId("user-2")).toBe(0);
    expect(writeCount).toBe(6);
  });
});
