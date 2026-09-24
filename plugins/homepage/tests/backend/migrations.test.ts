import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./helpers";

// The three tables as core's SQLite bootstrap created them before 2.9.0,
// plus the homepage_items index performance-indexes.ts added.
const LEGACY_DDL = `
  CREATE TABLE homepage_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type_id TEXT NOT NULL,
    title TEXT,
    config TEXT NOT NULL DEFAULT '{}',
    folder_id INTEGER,
    sync_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_homepage_items_user_id ON homepage_items (user_id);

  CREATE TABLE homepage_layouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    layout TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE dashboard_service_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    url TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    sync_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

const indexOn = (table: string) =>
  (
    db!.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'",
      )
      .all(table) as { name: string }[]
  ).map((row) => row.name);

describe("adopting the homepage tables", () => {
  it("keeps every existing row when the legacy tables are there", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
        sqlite.exec(LEGACY_DDL);
        sqlite
          .prepare(
            "INSERT INTO homepage_items (user_id, type_id, title, config, sync_id) VALUES (?, ?, ?, ?, ?)",
          )
          .run("user-1", "clock", "My Clock", '{"format":"24h"}', "sync-item");
        sqlite
          .prepare(
            "INSERT INTO homepage_layouts (user_id, layout) VALUES (?, ?)",
          )
          .run("user-1", '{"entries":[],"pan":{"x":0,"y":0},"zoom":1}');
        sqlite
          .prepare(
            "INSERT INTO dashboard_service_links (user_id, label, url, sync_id) VALUES (?, ?, ?, ?)",
          )
          .run("user-1", "Grafana", "https://grafana.local", "sync-link");
      },
    });

    expect(db.applied).toEqual(["0001_adopt_homepage_tables"]);
    expect(tableExists("homepage_items")).toBe(false);
    expect(tableExists("homepage_layouts")).toBe(false);
    expect(tableExists("dashboard_service_links")).toBe(false);
    expect(tableExists("p_homepage_homepage_items")).toBe(true);
    expect(tableExists("p_homepage_homepage_layouts")).toBe(true);
    expect(tableExists("p_homepage_dashboard_service_links")).toBe(true);

    const items = db.sqlite
      .prepare(
        "SELECT user_id, type_id, title, sync_id FROM p_homepage_homepage_items",
      )
      .all();
    expect(items).toEqual([
      {
        user_id: "user-1",
        type_id: "clock",
        title: "My Clock",
        sync_id: "sync-item",
      },
    ]);

    const layouts = db.sqlite
      .prepare("SELECT user_id, layout FROM p_homepage_homepage_layouts")
      .all();
    expect(layouts).toEqual([
      {
        user_id: "user-1",
        layout: '{"entries":[],"pan":{"x":0,"y":0},"zoom":1}',
      },
    ]);

    const links = db.sqlite
      .prepare(
        "SELECT user_id, label, url, sync_id FROM p_homepage_dashboard_service_links",
      )
      .all();
    expect(links).toEqual([
      {
        user_id: "user-1",
        label: "Grafana",
        url: "https://grafana.local",
        sync_id: "sync-link",
      },
    ]);

    expect(indexOn("p_homepage_homepage_items")).toEqual([
      "idx_homepage_items_user_id",
    ]);
    expect(indexOn("p_homepage_dashboard_service_links")).toEqual([
      "idx_dashboard_service_links_user_id",
    ]);
  });

  it("creates the tables fresh when there are no legacy ones", async () => {
    db = await createTestDb(pluginDir);

    expect(tableExists("p_homepage_homepage_items")).toBe(true);
    expect(tableExists("p_homepage_homepage_layouts")).toBe(true);
    expect(tableExists("p_homepage_dashboard_service_links")).toBe(true);
    expect(
      db.sqlite.prepare("SELECT * FROM p_homepage_homepage_items").all(),
    ).toEqual([]);
  });

  it("removes a user's rows when the user is deleted", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
      },
    });
    db.sqlite
      .prepare(
        "INSERT INTO p_homepage_homepage_items (user_id, type_id) VALUES (?, ?)",
      )
      .run("user-1", "clock");
    db.sqlite
      .prepare(
        "INSERT INTO p_homepage_homepage_items (user_id, type_id) VALUES (?, ?)",
      )
      .run("user-2", "clock");

    db.sqlite.exec("DELETE FROM users WHERE id = 'user-1'");

    const remaining = (
      db.sqlite
        .prepare("SELECT user_id FROM p_homepage_homepage_items")
        .all() as { user_id: string }[]
    ).map((row) => row.user_id);
    expect(remaining).toEqual(["user-2"]);
  });
});
