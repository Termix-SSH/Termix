import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./helpers";

// fleets/fleet_members/fleet_inventory as core's SQLite bootstrap created
// them before 2.9.0, plus the indexes performance-indexes.ts added.
const LEGACY_DDL = `
  CREATE TABLE fleets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    icon TEXT,
    tag_rules TEXT,
    sync_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE fleet_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fleet_id INTEGER NOT NULL REFERENCES fleets(id) ON DELETE CASCADE,
    host_id INTEGER NOT NULL REFERENCES ssh_data(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX idx_fleet_members_fleet_host ON fleet_members(fleet_id, host_id);
  CREATE INDEX idx_fleet_members_host ON fleet_members(host_id);
  CREATE TABLE fleet_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id INTEGER NOT NULL REFERENCES ssh_data(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    os_pretty_name TEXT,
    kernel TEXT,
    architecture TEXT,
    hostname TEXT,
    uptime_seconds INTEGER,
    ip TEXT,
    package_manager TEXT,
    collected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX idx_fleet_inventory_host ON fleet_inventory(host_id, user_id);
  CREATE INDEX idx_fleet_inventory_user ON fleet_inventory(user_id);
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
  )
    .map((row) => row.name)
    .sort();

describe("adopting fleets, fleet_members, fleet_inventory", () => {
  it("keeps every existing row when the legacy tables are there", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
        sqlite.exec("INSERT INTO ssh_data (id) VALUES (1), (2)");
        sqlite.exec(LEGACY_DDL);
        sqlite
          .prepare(
            "INSERT INTO fleets (user_id, name, tag_rules, sync_id) VALUES (?, ?, ?, ?)",
          )
          .run("user-1", "Web fleet", '["prod-web"]', "sync-a");
        sqlite
          .prepare(
            "INSERT INTO fleet_members (fleet_id, host_id) VALUES (1, 1)",
          )
          .run();
        sqlite
          .prepare(
            "INSERT INTO fleet_inventory (host_id, user_id, os_pretty_name) VALUES (1, 'user-1', 'Debian')",
          )
          .run();
      },
    });

    expect(db.applied).toEqual(["0001_adopt_fleets"]);
    expect(tableExists("fleets")).toBe(false);
    expect(tableExists("fleet_members")).toBe(false);
    expect(tableExists("fleet_inventory")).toBe(false);
    expect(tableExists("p_fleets_fleets")).toBe(true);
    expect(tableExists("p_fleets_members")).toBe(true);
    expect(tableExists("p_fleets_inventory")).toBe(true);

    const fleetRows = db.sqlite
      .prepare("SELECT user_id, name, tag_rules, sync_id FROM p_fleets_fleets")
      .all();
    expect(fleetRows).toEqual([
      {
        user_id: "user-1",
        name: "Web fleet",
        tag_rules: '["prod-web"]',
        sync_id: "sync-a",
      },
    ]);

    const memberRows = db.sqlite
      .prepare("SELECT fleet_id, host_id FROM p_fleets_members")
      .all();
    expect(memberRows).toEqual([{ fleet_id: 1, host_id: 1 }]);

    const inventoryRows = db.sqlite
      .prepare(
        "SELECT host_id, user_id, os_pretty_name FROM p_fleets_inventory",
      )
      .all();
    expect(inventoryRows).toEqual([
      { host_id: 1, user_id: "user-1", os_pretty_name: "Debian" },
    ]);

    expect(indexOn("p_fleets_members")).toEqual(
      ["idx_fleet_members_fleet_host", "idx_fleet_members_host"].sort(),
    );
    expect(indexOn("p_fleets_inventory")).toEqual(
      ["idx_fleet_inventory_host", "idx_fleet_inventory_user"].sort(),
    );
  });

  it("creates the tables fresh when there are no legacy ones", async () => {
    db = await createTestDb(pluginDir);

    expect(tableExists("fleets")).toBe(false);
    expect(tableExists("p_fleets_fleets")).toBe(true);
    expect(tableExists("p_fleets_members")).toBe(true);
    expect(tableExists("p_fleets_inventory")).toBe(true);
    expect(db.sqlite.prepare("SELECT * FROM p_fleets_fleets").all()).toEqual(
      [],
    );
  });

  it("cascades a fleet delete onto its member rows via the fleet_id FK", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1')");
        sqlite.exec("INSERT INTO ssh_data (id) VALUES (1)");
      },
    });
    db.sqlite
      .prepare(
        "INSERT INTO p_fleets_fleets (id, user_id, name) VALUES (1, 'user-1', 'Fleet')",
      )
      .run();
    db.sqlite
      .prepare("INSERT INTO p_fleets_members (fleet_id, host_id) VALUES (1, 1)")
      .run();

    db.sqlite.exec("DELETE FROM p_fleets_fleets WHERE id = 1");

    expect(db.sqlite.prepare("SELECT * FROM p_fleets_members").all()).toEqual(
      [],
    );
  });

  it("removes a user's fleets when the user is deleted", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
      },
    });
    const insert = db.sqlite.prepare(
      "INSERT INTO p_fleets_fleets (user_id, name) VALUES (?, ?)",
    );
    insert.run("user-1", "Mine");
    insert.run("user-2", "Theirs");

    db.sqlite.exec("DELETE FROM users WHERE id = 'user-1'");

    const names = (
      db.sqlite.prepare("SELECT name FROM p_fleets_fleets").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(names).toEqual(["Theirs"]);
  });
});
