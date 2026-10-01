import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./helpers.js";

// file_manager_recent, file_manager_pinned, file_manager_shortcuts and
// transfer_recent as core's SQLite bootstrap created them before 2.9.0.
const LEGACY_DDL = `
  CREATE TABLE file_manager_recent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    host_id INTEGER NOT NULL REFERENCES ssh_data(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    last_opened TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_file_manager_recent_user ON file_manager_recent (user_id, host_id);

  CREATE TABLE file_manager_pinned (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    host_id INTEGER NOT NULL REFERENCES ssh_data(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    pinned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_file_manager_pinned_user ON file_manager_pinned (user_id, host_id);

  CREATE TABLE file_manager_shortcuts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    host_id INTEGER NOT NULL REFERENCES ssh_data(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_file_manager_shortcuts_user ON file_manager_shortcuts (user_id, host_id);

  CREATE TABLE transfer_recent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_host_id INTEGER NOT NULL REFERENCES ssh_data(id) ON DELETE CASCADE,
    dest_host_id INTEGER NOT NULL REFERENCES ssh_data(id) ON DELETE CASCADE,
    dest_path TEXT NOT NULL,
    dest_path_label TEXT NOT NULL,
    last_used TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_transfer_recent_user ON transfer_recent (user_id);
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

describe("adopting the four file-manager tables", () => {
  it("keeps every existing row when the legacy tables are there", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec(
          "INSERT INTO users (id, username) VALUES ('user-1', 'user-1')",
        );
        sqlite.exec("INSERT INTO ssh_data (id) VALUES (1), (2)");
        sqlite.exec(LEGACY_DDL);
        sqlite
          .prepare(
            "INSERT INTO file_manager_recent (user_id, host_id, name, path) VALUES (?, ?, ?, ?)",
          )
          .run("user-1", 1, "notes.txt", "/home/user/notes.txt");
        sqlite
          .prepare(
            "INSERT INTO file_manager_pinned (user_id, host_id, name, path) VALUES (?, ?, ?, ?)",
          )
          .run("user-1", 1, "logs", "/var/log");
        sqlite
          .prepare(
            "INSERT INTO file_manager_shortcuts (user_id, host_id, name, path) VALUES (?, ?, ?, ?)",
          )
          .run("user-1", 1, "Home", "/home/user");
        sqlite
          .prepare(
            "INSERT INTO transfer_recent (user_id, source_host_id, dest_host_id, dest_path, dest_path_label) VALUES (?, ?, ?, ?, ?)",
          )
          .run("user-1", 1, 2, "/backups", "Backups");
      },
    });

    expect(db.applied).toEqual(["0001_adopt_file_manager_tables"]);

    for (const legacy of [
      "file_manager_recent",
      "file_manager_pinned",
      "file_manager_shortcuts",
      "transfer_recent",
    ]) {
      expect(tableExists(legacy)).toBe(false);
    }
    for (const adopted of [
      "p_file_manager_recent",
      "p_file_manager_pinned",
      "p_file_manager_shortcuts",
      "p_file_manager_transfer_recent",
    ]) {
      expect(tableExists(adopted)).toBe(true);
    }

    expect(
      db.sqlite.prepare("SELECT name, path FROM p_file_manager_recent").all(),
    ).toEqual([{ name: "notes.txt", path: "/home/user/notes.txt" }]);
    expect(
      db.sqlite.prepare("SELECT name, path FROM p_file_manager_pinned").all(),
    ).toEqual([{ name: "logs", path: "/var/log" }]);
    expect(
      db.sqlite
        .prepare("SELECT name, path FROM p_file_manager_shortcuts")
        .all(),
    ).toEqual([{ name: "Home", path: "/home/user" }]);
    expect(
      db.sqlite
        .prepare(
          "SELECT dest_path, dest_path_label FROM p_file_manager_transfer_recent",
        )
        .all(),
    ).toEqual([{ dest_path: "/backups", dest_path_label: "Backups" }]);

    expect(indexOn("p_file_manager_recent")).toEqual([
      "idx_file_manager_recent_user",
    ]);
    expect(indexOn("p_file_manager_pinned")).toEqual([
      "idx_file_manager_pinned_user",
    ]);
    expect(indexOn("p_file_manager_shortcuts")).toEqual([
      "idx_file_manager_shortcuts_user",
    ]);
    expect(indexOn("p_file_manager_transfer_recent")).toEqual([
      "idx_transfer_recent_user",
    ]);
  });

  it("creates the tables fresh when there is no legacy one", async () => {
    db = await createTestDb(pluginDir);

    expect(tableExists("file_manager_recent")).toBe(false);
    expect(tableExists("p_file_manager_recent")).toBe(true);
    expect(tableExists("p_file_manager_pinned")).toBe(true);
    expect(tableExists("p_file_manager_shortcuts")).toBe(true);
    expect(tableExists("p_file_manager_transfer_recent")).toBe(true);
    expect(
      db.sqlite.prepare("SELECT * FROM p_file_manager_recent").all(),
    ).toEqual([]);
  });
});
