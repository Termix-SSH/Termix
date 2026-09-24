import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./server";

// The four tables as core's SQLite bootstrap created them before 2.9.0.
const LEGACY_DDL = `
  CREATE TABLE host_metrics_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    host_id INTEGER NOT NULL,
    layout TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX idx_host_metrics_prefs_user_host
    ON host_metrics_preferences (user_id, host_id);

  CREATE TABLE host_health_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    host_id INTEGER NOT NULL,
    checks TEXT NOT NULL,
    interval_seconds INTEGER NOT NULL DEFAULT 300,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX idx_host_health_checks_user_host
    ON host_health_checks (user_id, host_id);

  CREATE TABLE host_health_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    host_id INTEGER NOT NULL,
    check_id TEXT NOT NULL,
    ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ok INTEGER NOT NULL,
    latency_ms INTEGER,
    detail TEXT,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
  );
  CREATE INDEX idx_host_health_history_lookup
    ON host_health_history (user_id, host_id, check_id, ts);

  CREATE TABLE host_metrics_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id INTEGER NOT NULL REFERENCES ssh_data(id) ON DELETE CASCADE,
    ts TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cpu_percent REAL,
    mem_percent REAL,
    disk_percent REAL,
    net_rx_bytes INTEGER,
    net_tx_bytes INTEGER
  );
  CREATE INDEX idx_host_metrics_history_host_ts
    ON host_metrics_history (host_id, ts DESC);
`;

const LEGACY = [
  "host_metrics_preferences",
  "host_health_checks",
  "host_health_history",
  "host_metrics_history",
];

let db: TestDb | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

const tableExists = (name: string) =>
  !!db!.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);

const indexNames = (table: string) =>
  (
    db!.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'",
      )
      .all(table) as Array<{ name: string }>
  )
    .map((row) => row.name)
    .sort();

const seedLegacy = (sqlite: TestDb["sqlite"]) => {
  sqlite.exec("INSERT INTO users (id) VALUES ('user-1')");
  sqlite.exec("INSERT INTO ssh_data (id) VALUES (7)");
  sqlite.exec(LEGACY_DDL);
  sqlite.exec(`
    INSERT INTO host_metrics_preferences (user_id, host_id, layout)
      VALUES ('user-1', 7, '{"slots":[],"columns":3}');
    INSERT INTO host_health_checks (user_id, host_id, checks, interval_seconds)
      VALUES ('user-1', 7, '[]', 600);
    INSERT INTO host_health_history (user_id, host_id, check_id, ts, ok, latency_ms, detail)
      VALUES ('user-1', 7, 'web', '2026-09-01 10:00:00', 1, 12, 'HTTP 200');
    INSERT INTO host_metrics_history (host_id, ts, cpu_percent, mem_percent, disk_percent, net_rx_bytes, net_tx_bytes)
      VALUES (7, '2026-09-01 10:00:00', 12.5, 40, 70, 100, 200);
  `);
};

describe("adopting the host metrics tables", () => {
  it("keeps every row and index when the legacy tables are there", async () => {
    db = await createTestDb(pluginDir, { before: seedLegacy });

    expect(db.applied).toEqual(["0001_adopt_host_metrics_tables"]);
    for (const table of LEGACY) {
      expect(tableExists(table)).toBe(false);
      expect(tableExists(`p_host_metrics_${table}`)).toBe(true);
    }

    expect(
      db.sqlite
        .prepare(
          "SELECT user_id, host_id, layout FROM p_host_metrics_host_metrics_preferences",
        )
        .all(),
    ).toEqual([
      { user_id: "user-1", host_id: 7, layout: '{"slots":[],"columns":3}' },
    ]);
    expect(
      db.sqlite
        .prepare(
          "SELECT checks, interval_seconds FROM p_host_metrics_host_health_checks",
        )
        .all(),
    ).toEqual([{ checks: "[]", interval_seconds: 600 }]);
    expect(
      db.sqlite
        .prepare(
          "SELECT check_id, ok, latency_ms, detail FROM p_host_metrics_host_health_history",
        )
        .all(),
    ).toEqual([{ check_id: "web", ok: 1, latency_ms: 12, detail: "HTTP 200" }]);
    expect(
      db.sqlite
        .prepare(
          "SELECT ts, cpu_percent, net_tx_bytes FROM p_host_metrics_host_metrics_history",
        )
        .all(),
    ).toEqual([
      { ts: "2026-09-01 10:00:00", cpu_percent: 12.5, net_tx_bytes: 200 },
    ]);

    expect(indexNames("p_host_metrics_host_metrics_preferences")).toEqual([
      "idx_host_metrics_prefs_user_host",
    ]);
    expect(indexNames("p_host_metrics_host_health_checks")).toEqual([
      "idx_host_health_checks_user_host",
    ]);
    expect(indexNames("p_host_metrics_host_health_history")).toEqual([
      "idx_host_health_history_lookup",
    ]);
    expect(indexNames("p_host_metrics_host_metrics_history")).toEqual([
      "idx_host_metrics_history_host_ts",
    ]);
  });

  it("creates the tables fresh when there are no legacy ones", async () => {
    db = await createTestDb(pluginDir);
    for (const table of LEGACY) {
      expect(tableExists(table)).toBe(false);
      expect(
        db.sqlite.prepare(`SELECT * FROM p_host_metrics_${table}`).all(),
      ).toEqual([]);
    }
  });

  it("cascades every table on host delete, and the user tables on user delete", async () => {
    db = await createTestDb(pluginDir, { before: seedLegacy });

    db.sqlite.exec("DELETE FROM users WHERE id = 'user-1'");
    for (const table of LEGACY.slice(0, 3)) {
      expect(
        db.sqlite.prepare(`SELECT * FROM p_host_metrics_${table}`).all(),
      ).toEqual([]);
    }

    db.sqlite.exec("DELETE FROM ssh_data WHERE id = 7");
    expect(
      db.sqlite
        .prepare("SELECT * FROM p_host_metrics_host_metrics_history")
        .all(),
    ).toEqual([]);
  });
});
