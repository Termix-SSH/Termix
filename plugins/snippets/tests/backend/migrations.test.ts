import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./helpers";

// snippets / snippet_folders / snippet_access as core's schema.ts declared
// them before 2.9.0, plus the indexes performance-indexes.ts added.
const LEGACY_DDL = `
  CREATE TABLE snippets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    description TEXT,
    folder TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    sync_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    host_filter TEXT,
    is_note INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_snippets_user_id ON snippets (user_id);

  CREATE TABLE snippet_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    icon TEXT,
    sync_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE snippet_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snippet_id INTEGER NOT NULL REFERENCES snippets(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    granted_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_level TEXT NOT NULL DEFAULT 'view',
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_snippet_access_user_id ON snippet_access (user_id);
  CREATE INDEX idx_snippet_access_snippet_id ON snippet_access (snippet_id);
  CREATE INDEX idx_snippet_access_role_id ON snippet_access (role_id);
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

describe("adopting snippets, snippet_folders and snippet_access", () => {
  it("keeps every existing row when the legacy tables are there", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
        sqlite.exec(
          "INSERT INTO roles (id, name, display_name) VALUES (7, 'ops', 'Operations')",
        );
        sqlite.exec(LEGACY_DDL);
        sqlite
          .prepare(
            "INSERT INTO snippets (id, user_id, name, content, folder, sync_id) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(99, "user-1", "Deploy", "echo deploy", "prod", "sync-snippet-a");
        sqlite
          .prepare(
            "INSERT INTO snippet_folders (user_id, name, sync_id) VALUES (?, ?, ?)",
          )
          .run("user-1", "prod", "sync-folder-a");
        sqlite
          .prepare(
            "INSERT INTO snippet_access (snippet_id, user_id, granted_by) VALUES (?, ?, ?)",
          )
          .run(99, "user-2", "user-1");
      },
    });

    expect(db.applied).toEqual(["0001_adopt_snippets_tables"]);
    expect(tableExists("snippets")).toBe(false);
    expect(tableExists("snippet_folders")).toBe(false);
    expect(tableExists("snippet_access")).toBe(false);
    expect(tableExists("p_snippets_snippets")).toBe(true);
    expect(tableExists("p_snippets_snippet_folders")).toBe(true);
    expect(tableExists("p_snippets_snippet_access")).toBe(true);

    const snippetRows = db.sqlite
      .prepare(
        "SELECT user_id, name, content, folder, sync_id FROM p_snippets_snippets",
      )
      .all();
    expect(snippetRows).toEqual([
      {
        user_id: "user-1",
        name: "Deploy",
        content: "echo deploy",
        folder: "prod",
        sync_id: "sync-snippet-a",
      },
    ]);

    const folderRows = db.sqlite
      .prepare("SELECT user_id, name, sync_id FROM p_snippets_snippet_folders")
      .all();
    expect(folderRows).toEqual([
      { user_id: "user-1", name: "prod", sync_id: "sync-folder-a" },
    ]);

    const accessRows = db.sqlite
      .prepare(
        "SELECT snippet_id, user_id, granted_by FROM p_snippets_snippet_access",
      )
      .all();
    expect(accessRows).toEqual([
      { snippet_id: 99, user_id: "user-2", granted_by: "user-1" },
    ]);

    expect(indexOn("p_snippets_snippets")).toEqual(["idx_snippets_user_id"]);
    expect(indexOn("p_snippets_snippet_access").sort()).toEqual(
      [
        "idx_snippet_access_user_id",
        "idx_snippet_access_snippet_id",
        "idx_snippet_access_role_id",
      ].sort(),
    );
  });

  it("creates the tables fresh when there is no legacy one", async () => {
    db = await createTestDb(pluginDir);

    expect(tableExists("snippets")).toBe(false);
    expect(tableExists("p_snippets_snippets")).toBe(true);
    expect(tableExists("p_snippets_snippet_folders")).toBe(true);
    expect(tableExists("p_snippets_snippet_access")).toBe(true);
    expect(indexOn("p_snippets_snippets")).toEqual(["idx_snippets_user_id"]);
    expect(
      db.sqlite.prepare("SELECT * FROM p_snippets_snippets").all(),
    ).toEqual([]);
  });

  it("cascades deletes when the owning user is removed", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
      },
    });
    db.sqlite
      .prepare(
        "INSERT INTO p_snippets_snippets (user_id, name, content) VALUES (?, ?, ?)",
      )
      .run("user-1", "Mine", "echo mine");
    db.sqlite
      .prepare(
        "INSERT INTO p_snippets_snippets (user_id, name, content) VALUES (?, ?, ?)",
      )
      .run("user-2", "Theirs", "echo theirs");

    db.sqlite.exec("DELETE FROM users WHERE id = 'user-1'");

    const names = (
      db.sqlite.prepare("SELECT name FROM p_snippets_snippets").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(names).toEqual(["Theirs"]);
  });
});
