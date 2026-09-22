/**
 * Plugin-owned data against a real engine.
 *
 * The DDL snapshots in table-ddl.test.ts prove what the emitter writes; this
 * proves an engine accepts it, that adoption moves real rows, and that
 * removing a plugin's data removes exactly its own.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defineTable,
  id,
  refUser,
  text,
  timestamp,
  varchar,
} from "@termix/plugin-sdk/db";
import { createTableSql, dropTableSql } from "../../plugins/table-builder.js";
import {
  adoptLegacyTableSql,
  applyPluginMigrations,
  checksum,
  PluginMigrationChecksumError,
  tableExistsSql,
  type MigrationRunner,
} from "../../plugins/migrations.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;
let root: string;

const notes = defineTable(
  "note",
  {
    id: id(),
    userId: refUser(),
    title: varchar(200).notNull(),
    body: text(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  { indexes: [{ name: "idx_note_user", columns: ["userId"] }] },
);

/** The ledger, kept in the same database so a rollback would take it too. */
function createRunner(): MigrationRunner {
  return {
    dialect: "sqlite",
    listApplied: async (pluginId) =>
      sqlite
        .prepare(
          "SELECT migration_id as migrationId, checksum FROM plugin_migrations WHERE plugin_id = ?",
        )
        .all(pluginId) as { migrationId: string; checksum: string }[],
    execute: async (statements) => {
      for (const statement of statements) sqlite.exec(statement);
    },
    record: async (pluginId, migration) => {
      sqlite
        .prepare(
          "INSERT INTO plugin_migrations (plugin_id, migration_id, checksum, applied_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          pluginId,
          migration.id,
          migration.checksum,
          new Date().toISOString(),
        );
    },
  };
}

function writeMigration(dialect: string, file: string, body: string): void {
  const dir = path.join(root, "migrations", dialect);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), body);
}

function tableExists(name: string): boolean {
  return (
    (
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .all(name) as unknown[]
    ).length > 0
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-plugin-data-"));
  sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL);
    CREATE TABLE ssh_data (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
    CREATE TABLE plugin_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plugin_id TEXT NOT NULL,
      migration_id TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      UNIQUE (plugin_id, migration_id)
    );
  `);
  sqlite
    .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
    .run("u1", "ada");
  db = drizzle(sqlite);
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("emitted DDL against a real engine", () => {
  it("creates the table and its indexes", () => {
    for (const statement of createTableSql("sqlite", "demo", notes)) {
      sqlite.exec(statement);
    }

    expect(tableExists("p_demo_note")).toBe(true);
  });

  it("enforces the foreign key to users", () => {
    for (const statement of createTableSql("sqlite", "demo", notes)) {
      sqlite.exec(statement);
    }

    expect(() =>
      sqlite
        .prepare("INSERT INTO p_demo_note (user_id, title) VALUES (?, ?)")
        .run("nobody", "orphan"),
    ).toThrow(/FOREIGN KEY/);
  });

  it("cascades a delete from the referenced user", () => {
    for (const statement of createTableSql("sqlite", "demo", notes)) {
      sqlite.exec(statement);
    }
    sqlite
      .prepare("INSERT INTO p_demo_note (user_id, title) VALUES (?, ?)")
      .run("u1", "mine");

    sqlite.prepare("DELETE FROM users WHERE id = ?").run("u1");

    const rows = sqlite.prepare("SELECT * FROM p_demo_note").all();
    expect(rows).toHaveLength(0);
  });

  it("fills the timestamp default the emitter wrote", () => {
    for (const statement of createTableSql("sqlite", "demo", notes)) {
      sqlite.exec(statement);
    }
    sqlite
      .prepare("INSERT INTO p_demo_note (user_id, title) VALUES (?, ?)")
      .run("u1", "mine");

    const [row] = sqlite
      .prepare("SELECT created_at FROM p_demo_note")
      .all() as {
      created_at: string;
    }[];
    expect(row.created_at).toBeTruthy();
  });

  it("answers the table-exists probe for the active dialect", async () => {
    for (const statement of createTableSql("sqlite", "demo", notes)) {
      sqlite.exec(statement);
    }

    const found = await db.all(tableExistsSql("sqlite", "p_demo_note"));
    const missing = await db.all(tableExistsSql("sqlite", "p_demo_nothing"));

    expect(found).toHaveLength(1);
    expect(missing).toHaveLength(0);
  });
});

describe("applying migrations for real", () => {
  it("creates the tables and records the ledger", async () => {
    writeMigration(
      "sqlite",
      "0001_init.sql",
      createTableSql("sqlite", "demo", notes).join("\n"),
    );

    const applied = await applyPluginMigrations("demo", root, createRunner());

    expect(applied).toEqual(["0001_init"]);
    expect(tableExists("p_demo_note")).toBe(true);
    expect(
      sqlite.prepare("SELECT * FROM plugin_migrations").all(),
    ).toHaveLength(1);
  });

  it("is a no-op the second time, so a restart does not re-run DDL", async () => {
    writeMigration(
      "sqlite",
      "0001_init.sql",
      createTableSql("sqlite", "demo", notes).join("\n"),
    );
    await applyPluginMigrations("demo", root, createRunner());

    const again = await applyPluginMigrations("demo", root, createRunner());

    expect(again).toEqual([]);
  });

  it("blocks the plugin when an applied migration was edited", async () => {
    writeMigration(
      "sqlite",
      "0001_init.sql",
      createTableSql("sqlite", "demo", notes).join("\n"),
    );
    await applyPluginMigrations("demo", root, createRunner());

    writeMigration(
      "sqlite",
      "0001_init.sql",
      `${createTableSql("sqlite", "demo", notes).join("\n")}\n-- edited`,
    );

    await expect(
      applyPluginMigrations("demo", root, createRunner()),
    ).rejects.toThrow(PluginMigrationChecksumError);
  });

  it("leaves one plugin's failure without touching another's tables", async () => {
    writeMigration(
      "sqlite",
      "0001_init.sql",
      createTableSql("sqlite", "good", notes).join("\n"),
    );
    await applyPluginMigrations("good", root, createRunner());

    const brokenRoot = fs.mkdtempSync(path.join(os.tmpdir(), "termix-broken-"));
    fs.mkdirSync(path.join(brokenRoot, "migrations", "sqlite"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(brokenRoot, "migrations", "sqlite", "0001_init.sql"),
      "CREATE TABLE p_broken_x (id integer); THIS IS NOT SQL;",
    );

    await expect(
      applyPluginMigrations("broken", brokenRoot, createRunner()),
    ).rejects.toThrow();

    // The good plugin is untouched, and core is still usable.
    expect(tableExists("p_good_note")).toBe(true);
    expect(sqlite.prepare("SELECT * FROM users").all()).toHaveLength(1);

    fs.rmSync(brokenRoot, { recursive: true, force: true });
  });
});

describe("adopting a legacy core table", () => {
  it("renames the table and keeps every row", async () => {
    sqlite.exec(
      "CREATE TABLE fleets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)",
    );
    sqlite.prepare("INSERT INTO fleets (name) VALUES (?)").run("production");
    sqlite.prepare("INSERT INTO fleets (name) VALUES (?)").run("staging");

    writeMigration(
      "sqlite",
      "0001_adopt.sql",
      adoptLegacyTableSql("sqlite", "fleets", "p_fleets_fleets"),
    );
    await applyPluginMigrations("fleets", root, createRunner());

    expect(tableExists("fleets")).toBe(false);
    const rows = sqlite
      .prepare("SELECT name FROM p_fleets_fleets ORDER BY id")
      .all() as { name: string }[];
    expect(rows.map((row) => row.name)).toEqual(["production", "staging"]);
  });

  it("creates the table fresh when there is no legacy one", async () => {
    const fresh = defineTable("fleets", { id: id(), name: varchar(100) });
    writeMigration(
      "sqlite",
      "0001_adopt.sql",
      createTableSql("sqlite", "fleets", fresh).join("\n"),
    );

    await applyPluginMigrations("fleets", root, createRunner());

    expect(tableExists("p_fleets_fleets")).toBe(true);
    expect(sqlite.prepare("SELECT * FROM p_fleets_fleets").all()).toHaveLength(
      0,
    );
  });

  it("refuses a plugin adopting a table that belongs to another", async () => {
    sqlite.exec("CREATE TABLE fleets (id INTEGER PRIMARY KEY)");
    writeMigration(
      "sqlite",
      "0001_steal.sql",
      adoptLegacyTableSql("sqlite", "fleets", "p_workspaces_fleets"),
    );

    await expect(
      applyPluginMigrations("workspaces", root, createRunner()),
    ).rejects.toThrow(/belongs to the "fleets" plugin/);

    // Refused before execution, so the legacy table is still there.
    expect(tableExists("fleets")).toBe(true);
  });
});

describe("removing a plugin's data", () => {
  it("drops the plugin's tables and leaves everything else", async () => {
    for (const statement of createTableSql("sqlite", "demo", notes)) {
      sqlite.exec(statement);
    }
    const other = defineTable("thing", { id: id(), name: varchar(50) });
    for (const statement of createTableSql("sqlite", "other", other)) {
      sqlite.exec(statement);
    }

    sqlite.exec(dropTableSql("sqlite", "demo", notes));

    expect(tableExists("p_demo_note")).toBe(false);
    expect(tableExists("p_other_thing")).toBe(true);
    expect(tableExists("users")).toBe(true);
  });

  it("clears only the removed plugin's ledger rows", () => {
    for (const pluginId of ["demo", "other"]) {
      sqlite
        .prepare(
          "INSERT INTO plugin_migrations (plugin_id, migration_id, checksum, applied_at) VALUES (?, ?, ?, ?)",
        )
        .run(pluginId, "0001_init", checksum("x"), new Date().toISOString());
    }

    sqlite
      .prepare("DELETE FROM plugin_migrations WHERE plugin_id = ?")
      .run("demo");

    const remaining = sqlite
      .prepare("SELECT plugin_id FROM plugin_migrations")
      .all() as { plugin_id: string }[];
    expect(remaining.map((row) => row.plugin_id)).toEqual(["other"]);
  });
});

describe("querying through the built table", () => {
  it("reads back a row written with raw SQL", async () => {
    for (const statement of createTableSql("sqlite", "demo", notes)) {
      sqlite.exec(statement);
    }
    sqlite
      .prepare("INSERT INTO p_demo_note (user_id, title) VALUES (?, ?)")
      .run("u1", "written");

    const rows = (await db.all(sql.raw("SELECT title FROM p_demo_note"))) as {
      title: string;
    }[];

    expect(rows[0].title).toBe("written");
  });
});
