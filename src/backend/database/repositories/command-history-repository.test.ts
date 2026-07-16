import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { CommandHistoryRepository } from "./command-history-repository.js";

describe("CommandHistoryRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<CommandHistoryRepository> {
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

      CREATE TABLE hosts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL
      );

      CREATE TABLE command_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        command TEXT NOT NULL,
        executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO hosts (id, user_id, name)
      VALUES (1, 'user-1', 'one'), (2, 'user-1', 'two'), (3, 'user-2', 'other');
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
