import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { RecentActivityRepository } from "./recent-activity-repository.js";

describe("RecentActivityRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<RecentActivityRepository> {
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

      CREATE TABLE recent_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        host_name TEXT,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO hosts (id, user_id, name)
      VALUES (1, 'user-1', 'one'), (2, 'user-1', 'two'), (3, 'user-2', 'other');
      INSERT INTO recent_activity (user_id, type, host_id, host_name)
      VALUES
        ('user-1', 'connect', 1, 'one'),
        ('user-1', 'disconnect', 2, 'two'),
        ('user-2', 'connect', 3, 'other');
    `);

    return new RecentActivityRepository(context, onWrite);
  }

  it("deletes activity by user id and only triggers writes for changed rows", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    expect(await repo.deleteByUserId("missing")).toBe(0);
    expect(writeCount).toBe(0);

    expect(await repo.deleteByUserId("user-1")).toBe(2);
    expect(writeCount).toBe(1);
    expect(await repo.deleteByUserId("user-1")).toBe(0);
    expect(writeCount).toBe(1);
  });

  it("deletes activity by host id and host id list", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    expect(await repo.deleteByHostId(1)).toBe(1);
    expect(await repo.deleteByHostId(1)).toBe(0);
    expect(await repo.deleteByHostIds([])).toBe(0);
    expect(await repo.deleteByHostIds([2, 3])).toBe(2);
    expect(writeCount).toBe(2);
  });
});
