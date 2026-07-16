import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { HostMetricsHistoryRepository } from "../../../database/repositories/host-metrics-history-repository.js";

describe("HostMetricsHistoryRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<HostMetricsHistoryRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE hosts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL
      );

      CREATE TABLE host_metrics_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL,
        ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        cpu_percent REAL,
        mem_percent REAL,
        disk_percent REAL,
        net_rx_bytes INTEGER,
        net_tx_bytes INTEGER
      );

      INSERT INTO hosts (id, user_id, name)
      VALUES (1, 'user-1', 'one'), (2, 'user-2', 'two');
      INSERT INTO host_metrics_history (
        host_id, ts, cpu_percent, mem_percent, disk_percent, net_rx_bytes, net_tx_bytes
      )
      VALUES
        (1, '2026-01-01 00:00:00', 10, 20, 30, 100, 200),
        (1, '2026-01-02 00:00:00', 11, 21, 31, 101, 201),
        (1, '2999-01-01 00:00:00', 12, 22, 32, 102, 202),
        (2, '2026-01-02 00:00:00', 99, 99, 99, 999, 999);
    `);

    return new HostMetricsHistoryRepository(context, onWrite);
  }

  it("creates and lists metrics history rows by range", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.create({
      hostId: 1,
      cpuPercent: 12,
      memPercent: 22,
      diskPercent: 32,
      netRxBytes: 102,
      netTxBytes: 202,
    });

    const rows = await repo.listRange(
      1,
      "2026-01-01 00:00:00",
      "2026-01-02 23:59:59",
    );

    expect(rows.map((row) => row.cpuPercent)).toEqual([10, 11]);
    expect(writeCount).toBe(1);
  });

  it("prunes old history for a host only", async () => {
    const repo = await createRepository();

    repo.pruneOlderThan(1, 1);

    const rows = await repo.listRange(
      1,
      "2000-01-01 00:00:00",
      "2999-12-31 23:59:59",
    );
    expect(rows.map((row) => row.ts)).toEqual(["2999-01-01 00:00:00"]);
    expect(
      await repo.listRange(2, "2026-01-01 00:00:00", "2026-01-03 00:00:00"),
    ).toHaveLength(1);
  });
});
