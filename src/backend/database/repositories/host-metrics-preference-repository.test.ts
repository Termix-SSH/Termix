import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { HostMetricsPreferenceRepository } from "./host-metrics-preference-repository.js";

describe("HostMetricsPreferenceRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<HostMetricsPreferenceRepository> {
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

      CREATE TABLE ssh_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        stats_config TEXT
      );

      CREATE TABLE host_metrics_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        layout TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_data (id, user_id, name, stats_config)
      VALUES (1, 'user-1', 'one', '{}'), (2, 'user-2', 'two', '{}');
      INSERT INTO host_metrics_preferences (
        user_id, host_id, layout, created_at, updated_at
      )
      VALUES (
        'user-1',
        1,
        '{"slots":[],"columns":3}',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z'
      );
    `);

    return new HostMetricsPreferenceRepository(context, onWrite);
  }

  it("finds a saved layout by user and host", async () => {
    const repo = await createRepository();

    const existing = await repo.findByUserAndHost("user-1", 1);
    expect(existing?.layout).toBe('{"slots":[],"columns":3}');
    expect(await repo.findByUserAndHost("user-1", 2)).toBeNull();
  });

  it("updates and inserts layouts with write notifications", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const updated = await repo.upsertLayout(
      "user-1",
      1,
      '{"slots":[{"id":"cpu"}],"columns":2}',
      "2026-02-01T00:00:00.000Z",
    );
    expect(updated).toMatchObject({
      id: 1,
      layout: '{"slots":[{"id":"cpu"}],"columns":2}',
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    const created = await repo.upsertLayout(
      "user-2",
      2,
      '{"slots":[{"id":"mem"}],"columns":1}',
      "2026-03-01T00:00:00.000Z",
    );
    expect(created).toMatchObject({
      userId: "user-2",
      hostId: 2,
      layout: '{"slots":[{"id":"mem"}],"columns":1}',
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(writeCount).toBe(2);
  });

  it("updates host stats config for the owning user", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await expect(
      repo.updateHostStatsConfig(
        "user-1",
        1,
        '{"enabledWidgets":["cpu","memory"]}',
      ),
    ).resolves.toBe(true);
    await expect(
      repo.updateHostStatsConfig("user-2", 1, '{"enabledWidgets":["disk"]}'),
    ).resolves.toBe(false);

    expect(writeCount).toBe(1);
  });
});
