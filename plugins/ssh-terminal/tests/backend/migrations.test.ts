import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./helpers";

// command_history as core's SQLite bootstrap created it before 2.9.0, plus the
// index performance-indexes.ts added.
const LEGACY_DDL = `
  CREATE TABLE command_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    host_id INTEGER NOT NULL,
    command TEXT NOT NULL,
    executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE
  );
  CREATE INDEX idx_command_history_user_host ON command_history (user_id, host_id);
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

const indexesOn = (table: string) =>
  (
    db!.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'",
      )
      .all(table) as { name: string }[]
  ).map((row) => row.name);

describe("adopting command_history", () => {
  it("keeps every existing row and its index when the legacy table is there", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
        sqlite.exec("INSERT INTO ssh_data (id) VALUES (1), (2)");
        sqlite.exec(LEGACY_DDL);
        sqlite.exec(`
          INSERT INTO command_history (user_id, host_id, command, executed_at)
          VALUES ('user-1', 1, 'ls -la', '2026-01-01T00:00:00.000Z'),
                 ('user-2', 2, 'uptime', '2026-01-02T00:00:00.000Z');
        `);
      },
    });

    expect(db.applied).toEqual(["0001_adopt_command_history"]);
    expect(tableExists("command_history")).toBe(false);
    expect(
      db.sqlite
        .prepare(
          "SELECT user_id, host_id, command, executed_at FROM p_ssh_terminal_command_history ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        user_id: "user-1",
        host_id: 1,
        command: "ls -la",
        executed_at: "2026-01-01T00:00:00.000Z",
      },
      {
        user_id: "user-2",
        host_id: 2,
        command: "uptime",
        executed_at: "2026-01-02T00:00:00.000Z",
      },
    ]);
    expect(indexesOn("p_ssh_terminal_command_history")).toEqual([
      "idx_command_history_user_host",
    ]);
  });

  it("creates a fresh table when there is no legacy one", async () => {
    db = await createTestDb(pluginDir);
    expect(tableExists("p_ssh_terminal_command_history")).toBe(true);
    expect(indexesOn("p_ssh_terminal_command_history")).toEqual([
      "idx_command_history_user_host",
    ]);
  });

  it("cascades when the user or the host is deleted", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
        sqlite.exec("INSERT INTO ssh_data (id) VALUES (1), (2)");
      },
    });
    db.sqlite.exec(`
      INSERT INTO p_ssh_terminal_command_history (user_id, host_id, command)
      VALUES ('user-1', 1, 'a'), ('user-2', 1, 'b'), ('user-2', 2, 'c');
    `);
    db.sqlite.exec("DELETE FROM users WHERE id = 'user-1'");
    db.sqlite.exec("DELETE FROM ssh_data WHERE id = 2");
    expect(
      db.sqlite
        .prepare("SELECT command FROM p_ssh_terminal_command_history")
        .all(),
    ).toEqual([{ command: "b" }]);
  });
});
