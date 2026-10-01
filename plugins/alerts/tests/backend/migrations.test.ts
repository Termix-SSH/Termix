import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./helpers";

// dismissed_alerts as core's SQLite bootstrap created it before 2.9.0, with
// the index performance-indexes.ts added.
const LEGACY_DDL = `
  CREATE TABLE dismissed_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    alert_id TEXT NOT NULL,
    dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
  CREATE INDEX idx_dismissed_alerts_user_id ON dismissed_alerts(user_id);
  INSERT INTO users (id, username) VALUES ('alice', 'alice');
  INSERT INTO dismissed_alerts (id, user_id, alert_id) VALUES (3, 'alice', 'old-news');
`;

const OWN = ["p_alerts_channels", "p_alerts_items", "p_alerts_rules"];

let db: TestDb | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

function tables(target: TestDb): string[] {
  return (
    target.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function indexes(target: TestDb, table: string): string[] {
  return (
    target.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'",
      )
      .all(table) as Array<{ name: string }>
  )
    .map((row) => row.name)
    .sort();
}

describe("the alerts tables", () => {
  it("adopts dismissed_alerts with its rows and its one index", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => sqlite.exec(LEGACY_DDL),
    });

    const names = tables(db);
    expect(names).toContain("p_alerts_dismissed");
    expect(names).not.toContain("dismissed_alerts");
    for (const table of OWN) expect(names).toContain(table);
    expect(
      db.sqlite
        .prepare("SELECT id, user_id, alert_id FROM p_alerts_dismissed")
        .all(),
    ).toEqual([{ id: 3, user_id: "alice", alert_id: "old-news" }]);
    expect(indexes(db, "p_alerts_dismissed")).toEqual([
      "idx_dismissed_alerts_user_id",
    ]);

    // Deleting the user still takes their rows with them.
    db.sqlite.prepare("DELETE FROM users WHERE id = 'alice'").run();
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM p_alerts_dismissed").get(),
    ).toEqual({ n: 0 });
  });

  it("creates the same tables on a fresh install", async () => {
    db = await createTestDb(pluginDir);
    const names = tables(db);
    for (const table of [...OWN, "p_alerts_dismissed"]) {
      expect(names).toContain(table);
    }
    expect(indexes(db, "p_alerts_items")).toEqual([
      "idx_alerts_items_dedupe",
      "idx_alerts_items_unread",
      "idx_alerts_items_user",
    ]);
  });
});
