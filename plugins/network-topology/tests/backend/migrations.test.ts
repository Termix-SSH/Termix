import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./helpers";

// network_topology as core's SQLite bootstrap created it before 2.9.0.
const LEGACY_DDL = `
  CREATE TABLE network_topology (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topology TEXT,
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

describe("adopting network_topology", () => {
  it("keeps every existing row when the legacy table is there", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
        sqlite.exec(LEGACY_DDL);
        sqlite
          .prepare(
            "INSERT INTO network_topology (user_id, topology, updated_at) VALUES (?, ?, ?)",
          )
          .run(
            "user-1",
            '{"nodes":[{"data":{"id":"1"}}],"edges":[]}',
            "2026-01-01T00:00:00.000Z",
          );
      },
    });

    expect(db.applied).toEqual(["0001_adopt_network_topology"]);
    expect(tableExists("network_topology")).toBe(false);
    expect(tableExists("p_network_topology_graphs")).toBe(true);

    const rows = db.sqlite
      .prepare(
        "SELECT user_id, topology, updated_at FROM p_network_topology_graphs ORDER BY id",
      )
      .all();
    expect(rows).toEqual([
      {
        user_id: "user-1",
        topology: '{"nodes":[{"data":{"id":"1"}}],"edges":[]}',
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("creates the table fresh when there is no legacy one", async () => {
    db = await createTestDb(pluginDir);

    expect(tableExists("network_topology")).toBe(false);
    expect(tableExists("p_network_topology_graphs")).toBe(true);
    expect(
      db.sqlite.prepare("SELECT * FROM p_network_topology_graphs").all(),
    ).toEqual([]);
  });

  it("removes a user's topology when the user is deleted", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
      },
    });
    const insert = db.sqlite.prepare(
      "INSERT INTO p_network_topology_graphs (user_id, topology) VALUES (?, ?)",
    );
    insert.run("user-1", "{}");
    insert.run("user-2", "{}");

    db.sqlite.exec("DELETE FROM users WHERE id = 'user-1'");

    const remaining = (
      db.sqlite
        .prepare("SELECT user_id FROM p_network_topology_graphs")
        .all() as { user_id: string }[]
    ).map((row) => row.user_id);
    expect(remaining).toEqual(["user-2"]);
  });
});
