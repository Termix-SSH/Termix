import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { HostHealthRepository } from "../../../database/repositories/host-health-repository.js";

describe("HostHealthRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<HostHealthRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );

      CREATE TABLE hosts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL
      );

      CREATE TABLE host_health_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        checks TEXT NOT NULL,
        interval_seconds INTEGER NOT NULL DEFAULT 300,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE host_health_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        check_id TEXT NOT NULL,
        ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ok INTEGER NOT NULL,
        latency_ms INTEGER,
        detail TEXT
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO hosts (id, user_id, name)
      VALUES (1, 'user-1', 'one'), (2, 'user-2', 'two');
      INSERT INTO host_health_checks (
        user_id, host_id, checks, interval_seconds, created_at, updated_at
      )
      VALUES (
        'user-1',
        1,
        '[{"id":"tcp","name":"TCP","type":"tcp","target":"localhost","port":22}]',
        300,
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z'
      );
    `);

    return new HostHealthRepository(context, onWrite);
  }

  it("finds and upserts check configuration", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const existing = await repo.findChecksByUserAndHost("user-1", 1);
    expect(existing?.intervalSeconds).toBe(300);

    const updated = await repo.upsertChecks(
      "user-1",
      1,
      '[{"id":"http"}]',
      60,
      "2026-02-01T00:00:00.000Z",
    );
    expect(updated).toMatchObject({
      id: existing?.id,
      checks: '[{"id":"http"}]',
      intervalSeconds: 60,
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    const created = await repo.upsertChecks(
      "user-2",
      2,
      '[{"id":"tcp"}]',
      120,
      "2026-03-01T00:00:00.000Z",
    );
    expect(created).toMatchObject({
      userId: "user-2",
      hostId: 2,
      checks: '[{"id":"tcp"}]',
      intervalSeconds: 120,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(writeCount).toBe(2);
  });

  it("records and prunes history", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    expect(
      await repo.recordHistory(
        "user-1",
        1,
        [{ checkId: "one", ok: true, latencyMs: 12, detail: "open" }],
        1,
        "2026-01-01T00:00:00.000Z",
      ),
    ).toBe(1);
    expect(
      await repo.recordHistory(
        "user-1",
        1,
        [{ checkId: "two", ok: false, latencyMs: null, detail: "closed" }],
        1,
        "2026-01-02T00:00:00.000Z",
      ),
    ).toBe(1);

    const history = await repo.listHistory("user-1", 1, 10);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      userId: "user-1",
      hostId: 1,
      checkId: "two",
      ok: false,
      latencyMs: null,
      detail: "closed",
    });
    expect(writeCount).toBe(2);
  });

  it("deletes all health checks and history for a user", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.upsertChecks("user-2", 2, '[{"id":"tcp"}]', 120);
    await repo.recordHistory(
      "user-1",
      1,
      [{ checkId: "one", ok: true, latencyMs: 12, detail: "open" }],
      10,
    );
    await repo.recordHistory(
      "user-2",
      2,
      [{ checkId: "two", ok: false, latencyMs: null, detail: "closed" }],
      10,
    );

    await expect(repo.deleteByUserId("user-1")).resolves.toEqual({
      checksDeleted: 1,
      historyDeleted: 1,
    });
    await expect(repo.deleteByUserId("missing")).resolves.toEqual({
      checksDeleted: 0,
      historyDeleted: 0,
    });

    expect(await repo.findChecksByUserAndHost("user-1", 1)).toBeNull();
    expect(await repo.listHistory("user-1", 1, 10)).toEqual([]);
    expect((await repo.findChecksByUserAndHost("user-2", 2))?.hostId).toBe(2);
    expect(await repo.listHistory("user-2", 2, 10)).toHaveLength(1);
    expect(writeCount).toBe(4);
  });
});
