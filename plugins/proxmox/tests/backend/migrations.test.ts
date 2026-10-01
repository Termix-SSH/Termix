import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./helpers.js";

// proxmox_node_history and proxmox_stats_preferences as core's SQLite
// bootstrap created them before 2.9.0.
const LEGACY_DDL = `
  CREATE TABLE proxmox_node_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id INTEGER NOT NULL REFERENCES ssh_data(id) ON DELETE CASCADE,
    ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cpu_percent REAL,
    mem_percent REAL,
    disk_percent REAL,
    net_rx_bytes INTEGER,
    net_tx_bytes INTEGER
  );
  CREATE TABLE proxmox_stats_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    host_id INTEGER NOT NULL REFERENCES ssh_data(id) ON DELETE CASCADE,
    layout TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX idx_proxmox_stats_prefs_user_host ON proxmox_stats_preferences (user_id, host_id);
`;

let db: TestDb | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

const tableExists = (name: string) =>
  !!db!.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);

const indexOn = (table: string) =>
  (
    db!.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'",
      )
      .all(table) as { name: string }[]
  ).map((row) => row.name);

describe("adopting proxmox_node_history and proxmox_stats_preferences", () => {
  it("keeps every existing row when the legacy tables are there", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec(
          "INSERT INTO users (id, username) VALUES ('user-1', 'user-1')",
        );
        sqlite.exec("INSERT INTO ssh_data (id) VALUES (1)");
        sqlite.exec(LEGACY_DDL);
        sqlite
          .prepare(
            "INSERT INTO proxmox_node_history (host_id, ts, cpu_percent) VALUES (?, ?, ?)",
          )
          .run(1, "2026-01-01 00:00:00", 42);
        sqlite
          .prepare(
            "INSERT INTO proxmox_stats_preferences (user_id, host_id, layout) VALUES (?, ?, ?)",
          )
          .run("user-1", 1, '{"cards":[]}');
      },
    });

    expect(db.applied).toEqual(["0001_adopt_proxmox_stats"]);
    expect(tableExists("proxmox_node_history")).toBe(false);
    expect(tableExists("proxmox_stats_preferences")).toBe(false);
    expect(tableExists("p_proxmox_node_history")).toBe(true);
    expect(tableExists("p_proxmox_stats_preferences")).toBe(true);

    expect(
      db.sqlite.prepare("SELECT cpu_percent FROM p_proxmox_node_history").all(),
    ).toEqual([{ cpu_percent: 42 }]);
    expect(
      db.sqlite.prepare("SELECT layout FROM p_proxmox_stats_preferences").all(),
    ).toEqual([{ layout: '{"cards":[]}' }]);
    expect(indexOn("p_proxmox_stats_preferences")).toEqual([
      "idx_proxmox_stats_prefs_user_host",
    ]);
  });

  it("creates the tables fresh when there is no legacy one", async () => {
    db = await createTestDb(pluginDir);

    expect(tableExists("proxmox_node_history")).toBe(false);
    expect(tableExists("p_proxmox_node_history")).toBe(true);
    expect(tableExists("p_proxmox_stats_preferences")).toBe(true);
    expect(
      db.sqlite.prepare("SELECT * FROM p_proxmox_node_history").all(),
    ).toEqual([]);
  });
});
