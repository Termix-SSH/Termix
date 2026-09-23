import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./helpers";

// user_workspaces as core's SQLite bootstrap created it before 2.9.0, plus the
// index performance-indexes.ts added.
const LEGACY_DDL = `
  CREATE TABLE user_workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    icon TEXT,
    kind TEXT NOT NULL DEFAULT 'manual',
    is_default INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL DEFAULT '{}',
    sync_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT
  );
  CREATE INDEX idx_user_workspaces_user_id ON user_workspaces (user_id);
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

describe("adopting user_workspaces", () => {
  it("keeps every existing row when the legacy table is there", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
        sqlite.exec(LEGACY_DDL);
        sqlite
          .prepare(
            "INSERT INTO user_workspaces (user_id, name, kind, is_default, payload, sync_id, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            "user-1",
            "Prod",
            "manual",
            1,
            '{"version":1,"tabs":[{"type":"terminal"}]}',
            "sync-a",
            "2026-01-01T00:00:00.000Z",
          );
        sqlite
          .prepare(
            "INSERT INTO user_workspaces (user_id, name, kind, payload, sync_id) VALUES (?, ?, ?, ?, ?)",
          )
          .run("user-2", "Last Session", "last_session", "{}", "sync-b");
      },
    });

    expect(db.applied).toEqual(["0001_adopt_user_workspaces"]);
    expect(tableExists("user_workspaces")).toBe(false);
    expect(tableExists("p_workspaces_workspaces")).toBe(true);

    const rows = db.sqlite
      .prepare(
        "SELECT user_id, name, kind, is_default, payload, sync_id, last_used_at FROM p_workspaces_workspaces ORDER BY id",
      )
      .all();
    expect(rows).toEqual([
      {
        user_id: "user-1",
        name: "Prod",
        kind: "manual",
        is_default: 1,
        payload: '{"version":1,"tabs":[{"type":"terminal"}]}',
        sync_id: "sync-a",
        last_used_at: "2026-01-01T00:00:00.000Z",
      },
      {
        user_id: "user-2",
        name: "Last Session",
        kind: "last_session",
        is_default: 0,
        payload: "{}",
        sync_id: "sync-b",
        last_used_at: null,
      },
    ]);
    expect(indexOn("p_workspaces_workspaces")).toEqual([
      "idx_user_workspaces_user_id",
    ]);
  });

  it("creates the table fresh when there is no legacy one", async () => {
    db = await createTestDb(pluginDir);

    expect(tableExists("user_workspaces")).toBe(false);
    expect(tableExists("p_workspaces_workspaces")).toBe(true);
    expect(indexOn("p_workspaces_workspaces")).toEqual([
      "idx_user_workspaces_user_id",
    ]);
    expect(
      db.sqlite.prepare("SELECT * FROM p_workspaces_workspaces").all(),
    ).toEqual([]);
  });

  it("removes a user's workspaces when the user is deleted", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
      },
    });
    const insert = db.sqlite.prepare(
      "INSERT INTO p_workspaces_workspaces (user_id, name) VALUES (?, ?)",
    );
    insert.run("user-1", "Mine");
    insert.run("user-2", "Theirs");

    db.sqlite.exec("DELETE FROM users WHERE id = 'user-1'");

    const names = (
      db.sqlite.prepare("SELECT name FROM p_workspaces_workspaces").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(names).toEqual(["Theirs"]);
  });
});
