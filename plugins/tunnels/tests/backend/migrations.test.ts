import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./helpers";

// c2s_tunnel_presets as core's SQLite bootstrap created it before 2.9.0.
// Core never indexed it.
const LEGACY_DDL = `
  CREATE TABLE c2s_tunnel_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    platform TEXT,
    computer_name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
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

describe("adopting c2s_tunnel_presets", () => {
  it("keeps every existing row when the legacy table is there", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
        sqlite.exec(LEGACY_DDL);
        sqlite
          .prepare(
            "INSERT INTO c2s_tunnel_presets (user_id, name, config, platform, computer_name) VALUES (?, ?, ?, ?, ?)",
          )
          .run("user-1", "Laptop", '[{"scope":"c2s"}]', "win32", "laptop");
        sqlite
          .prepare(
            "INSERT INTO c2s_tunnel_presets (user_id, name, config) VALUES (?, ?, ?)",
          )
          .run("user-2", "Desk", "[]");
      },
    });

    expect(db.applied).toEqual(["0001_adopt_c2s_tunnel_presets"]);
    expect(tableExists("c2s_tunnel_presets")).toBe(false);
    expect(tableExists("p_tunnels_presets")).toBe(true);

    expect(
      db.sqlite
        .prepare(
          "SELECT user_id, name, config, platform, computer_name FROM p_tunnels_presets ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        user_id: "user-1",
        name: "Laptop",
        config: '[{"scope":"c2s"}]',
        platform: "win32",
        computer_name: "laptop",
      },
      {
        user_id: "user-2",
        name: "Desk",
        config: "[]",
        platform: null,
        computer_name: null,
      },
    ]);
  });

  it("creates the table fresh when there is no legacy one", async () => {
    db = await createTestDb(pluginDir);

    expect(tableExists("c2s_tunnel_presets")).toBe(false);
    expect(tableExists("p_tunnels_presets")).toBe(true);
    expect(db.sqlite.prepare("SELECT * FROM p_tunnels_presets").all()).toEqual(
      [],
    );
  });

  it("removes a user's presets when the user is deleted", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
      },
    });
    const insert = db.sqlite.prepare(
      "INSERT INTO p_tunnels_presets (user_id, name, config) VALUES (?, ?, '[]')",
    );
    insert.run("user-1", "Mine");
    insert.run("user-2", "Theirs");

    db.sqlite.exec("DELETE FROM users WHERE id = 'user-1'");

    expect(
      (
        db.sqlite.prepare("SELECT name FROM p_tunnels_presets").all() as {
          name: string;
        }[]
      ).map((row) => row.name),
    ).toEqual(["Theirs"]);
  });
});
