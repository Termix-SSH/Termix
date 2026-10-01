import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./helpers";

// tmux_session_tags as core's SQLite bootstrap created it before 2.9.0.
// Core never indexed it.
const LEGACY_DDL = `
  CREATE TABLE tmux_session_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    host_id INTEGER NOT NULL,
    session_name TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
  );
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

describe("adopting tmux_session_tags", () => {
  it("keeps every existing row when the legacy table is there", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
        sqlite.exec("INSERT INTO ssh_data (id) VALUES (7)");
        sqlite.exec(LEGACY_DDL);
        sqlite
          .prepare(
            "INSERT INTO tmux_session_tags (user_id, host_id, session_name, tag) VALUES (?, ?, ?, ?)",
          )
          .run("user-1", 7, "work", "lab");
      },
    });

    expect(db.applied).toEqual(["0001_adopt_tmux_session_tags"]);
    expect(tableExists("tmux_session_tags")).toBe(false);
    expect(tableExists("p_tmux_monitor_session_tags")).toBe(true);

    expect(
      db.sqlite
        .prepare(
          "SELECT user_id, host_id, session_name, tag FROM p_tmux_monitor_session_tags",
        )
        .all(),
    ).toEqual([
      { user_id: "user-1", host_id: 7, session_name: "work", tag: "lab" },
    ]);
  });

  it("creates the table fresh when there is no legacy one", async () => {
    db = await createTestDb(pluginDir);

    expect(tableExists("tmux_session_tags")).toBe(false);
    expect(tableExists("p_tmux_monitor_session_tags")).toBe(true);
    expect(
      db.sqlite.prepare("SELECT * FROM p_tmux_monitor_session_tags").all(),
    ).toEqual([]);
  });

  it("cascades on host delete", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1')");
        sqlite.exec("INSERT INTO ssh_data (id) VALUES (7)");
      },
    });
    db.sqlite
      .prepare(
        "INSERT INTO p_tmux_monitor_session_tags (user_id, host_id, session_name, tag) VALUES (?, ?, ?, ?)",
      )
      .run("user-1", 7, "work", "lab");

    db.sqlite.exec("DELETE FROM ssh_data WHERE id = 7");

    expect(
      db.sqlite.prepare("SELECT * FROM p_tmux_monitor_session_tags").all(),
    ).toEqual([]);
  });
});
