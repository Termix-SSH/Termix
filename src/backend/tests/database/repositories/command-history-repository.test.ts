import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { CommandHistoryRepository } from "../../../database/repositories/command-history-repository.js";

describe("CommandHistoryRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<CommandHistoryRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type)
      VALUES (1, 'user-1', 'one', '10.0.0.1', 22, 'root', 'password'), (2, 'user-1', 'two', '10.0.0.1', 22, 'root', 'password'), (3, 'user-2', 'other', '10.0.0.1', 22, 'root', 'password');
    `);

    return new CommandHistoryRepository(context, onWrite);
  }

  it("creates and lists unique commands by latest execution", async () => {
    const repo = await createRepository();

    await repo.create("user-1", 1, "ls", "2026-06-27T00:00:00.000Z");
    await repo.create("user-1", 1, "pwd", "2026-06-27T01:00:00.000Z");
    await repo.create("user-1", 1, "ls", "2026-06-27T02:00:00.000Z");
    await repo.create("user-2", 3, "whoami", "2026-06-27T03:00:00.000Z");

    expect(await repo.listUniqueCommandsForHost("user-1", 1)).toEqual([
      "ls",
      "pwd",
    ]);
    expect(await repo.listCommandsForHost("user-1", 1)).toEqual([
      "ls",
      "pwd",
      "ls",
    ]);
  });

  it("deletes commands by command, host, host list, and user", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.create("user-1", 1, "ls");
    await repo.create("user-1", 1, "ls");
    await repo.create("user-1", 2, "pwd");
    await repo.create("user-2", 3, "whoami");
    expect(writeCount).toBe(4);

    expect(await repo.deleteCommandForHost("user-1", 1, "missing")).toBe(0);
    expect(writeCount).toBe(4);

    expect(await repo.deleteCommandForHost("user-1", 1, "ls")).toBe(2);
    expect(writeCount).toBe(5);

    expect(await repo.deleteByUserAndHost("user-1", 2)).toBe(1);
    expect(await repo.deleteByHostIds([])).toBe(0);
    expect(await repo.deleteByHostIds([3])).toBe(1);
    expect(writeCount).toBe(7);

    await repo.create("user-1", 1, "date");
    expect(await repo.deleteByUserId("user-1")).toBe(1);
    expect(writeCount).toBe(9);
  });
});
