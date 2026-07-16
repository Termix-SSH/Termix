import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { RecentActivityRepository } from "../../../database/repositories/recent-activity-repository.js";

describe("RecentActivityRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<{
    repository: RecentActivityRepository;
    sqlite: NonNullable<
      Awaited<ReturnType<TestSqliteDatabase["connect"]>>["sqlite"]
    >;
  }> {
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
      INSERT INTO recent_activity (id, user_id, type, host_id, host_name, timestamp)
      VALUES
        (1, 'user-1', 'connect', 1, 'one', '2026-06-26T00:00:00.000Z'),
        (2, 'user-1', 'disconnect', 2, 'two', '2026-06-26T00:01:00.000Z'),
        (3, 'user-2', 'connect', 3, 'other', '2026-06-26T00:02:00.000Z');
    `);

    return {
      repository: new RecentActivityRepository(context, onWrite),
      sqlite: context.sqlite!,
    };
  }

  it("lists, creates, and trims recent activity", async () => {
    let writeCount = 0;
    const { repository, sqlite } = await createRepository(() => {
      writeCount += 1;
    });

    expect(
      (await repository.listByUserId("user-1", 2)).map((row) => row.id),
    ).toEqual([2, 1]);

    const created = await repository.create({
      userId: "user-1",
      type: "terminal",
      hostId: 1,
      hostName: "one",
      timestamp: "2026-06-26T00:03:00.000Z",
    });
    expect(created).toMatchObject({
      userId: "user-1",
      type: "terminal",
      hostId: 1,
    });

    expect(await repository.trimUserActivity("user-1", 2)).toBe(1);
    expect(
      sqlite
        .prepare(
          "SELECT id FROM recent_activity WHERE user_id = ? ORDER BY timestamp DESC",
        )
        .all("user-1"),
    ).toEqual([{ id: created.id }, { id: 2 }]);
    expect(writeCount).toBe(2);
  });

  it("deletes activity by user id and only triggers writes for changed rows", async () => {
    let writeCount = 0;
    const { repository: repo } = await createRepository(() => {
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
    const { repository: repo } = await createRepository(() => {
      writeCount += 1;
    });

    expect(await repo.deleteByHostId(1)).toBe(1);
    expect(await repo.deleteByHostId(1)).toBe(0);
    expect(await repo.deleteByHostIds([])).toBe(0);
    expect(await repo.deleteByHostIds([2, 3])).toBe(2);
    expect(writeCount).toBe(2);
  });
});
