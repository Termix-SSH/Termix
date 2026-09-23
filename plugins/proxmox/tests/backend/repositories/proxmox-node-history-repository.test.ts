import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { proxmoxNodeHistory } from "../../../src/backend/tables.js";
import {
  createProxmoxNodeHistoryRepository,
  type ProxmoxNodeHistoryRepository,
} from "../../../src/backend/proxmox-node-history-repository.js";
import { pluginDir } from "../helpers.js";

describe("ProxmoxNodeHistoryRepository", () => {
  let db: TestDb | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  async function createRepository(): Promise<ProxmoxNodeHistoryRepository> {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec(
          "INSERT INTO users (id, username) VALUES ('user-1', 'user-1'), ('user-2', 'user-2')",
        );
        sqlite.exec("INSERT INTO ssh_data (id) VALUES (1), (2)");
      },
      skipMigrations: false,
    });
    // Migrations already ran (adopting proxmox_node_history), so seed rows on
    // the real table after the fact.
    db.sqlite.exec(`
      INSERT INTO p_proxmox_node_history (
        host_id, ts, cpu_percent, mem_percent, disk_percent, net_rx_bytes, net_tx_bytes
      )
      VALUES
        (1, '2026-01-01 00:00:00', 10, 20, 30, 100, 200),
        (1, '2026-01-02 00:00:00', 11, 21, 31, 101, 201),
        (1, '2999-01-01 00:00:00', 12, 22, 32, 102, 202),
        (2, '2026-01-02 00:00:00', 99, 99, 99, 999, 999);
    `);

    return createProxmoxNodeHistoryRepository(
      db.database,
      await db.database.define(proxmoxNodeHistory),
    );
  }

  it("creates and lists node history rows by range", async () => {
    const repo = await createRepository();

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
    expect(db!.persisted).toBe(1);
  });

  it("prunes old history for a host only", async () => {
    const repo = await createRepository();

    await repo.pruneOlderThan(1, 1);

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
