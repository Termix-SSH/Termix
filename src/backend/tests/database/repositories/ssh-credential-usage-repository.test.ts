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
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_credentials (id, user_id, name, username, auth_type)
      VALUES (1, 'user-1', 'cred-one', 'root', 'password'), (2, 'user-2', 'cred-two', 'root', 'password');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type)
      VALUES (1, 'user-1', 'one', '10.0.0.1', 22, 'root', 'password'), (2, 'user-1', 'two', '10.0.0.1', 22, 'root', 'password'), (3, 'user-2', 'other', '10.0.0.1', 22, 'root', 'password');
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
