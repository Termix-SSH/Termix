/**
 * Data: a plugin migration can only write tables under its own prefix, the
 * CLI and the runtime share one checker, a symlink cannot feed in SQL from
 * elsewhere, and removing a plugin's data drops only that plugin's tables.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findUnownedTableWrites } from "@termix/plugin-sdk/ddl";
import { LEGACY_TABLE_OWNERS } from "@termix/plugin-sdk/db";

const state = vi.hoisted(() => ({
  db: null as unknown,
  deleted: [] as string[],
}));

vi.mock("../../../utils/logger.js", () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { pluginLogger: log };
});
vi.mock("../../../database/db/index.js", () => ({
  getDb: () => state.db,
}));
vi.mock("../../../database/db/dialect.js", () => ({
  resolveDatabaseDialect: () => "sqlite",
}));
vi.mock("../../../database/repositories/factory.js", () => {
  const remove = (what: string) => ({
    deleteByPlugin: async (pluginId: string) => {
      state.deleted.push(`${what}:${pluginId}`);
      return 0;
    },
  });
  return {
    createCurrentPluginStorageRepository: () => remove("kv"),
    createCurrentPluginMigrationRepository: () => remove("migrations"),
    createCurrentPluginPermissionGrantRepository: () => remove("grants"),
    createCurrentPluginSettingsRepository: () => remove("settings"),
  };
});

const { assertOwnedTables, readMigrations } =
  await import("../../../plugins/migrations.js");
const { removePluginData, ownedTableNames } =
  await import("../../../plugins/data.js");

describe("the migration checker", () => {
  it.each([
    ["a comment between keyword and name", "DROP TABLE/**/users"],
    ["a comment with spaces", "DROP TABLE /* x */ users"],
    ["bracket quoting", "DROP TABLE [users]"],
    ["double quoting", 'DROP TABLE "users"'],
    ["back quoting", "DROP TABLE `users`"],
    ["a second name in a list", "DROP TABLE p_foo_a, users"],
    ["a rename out of the namespace", "ALTER TABLE p_foo_a RENAME TO users"],
    ["a MySQL rename in", "RENAME TABLE users TO p_foo_users"],
    ["an insert", "INSERT INTO users (id) VALUES ('x')"],
    ["an update", "UPDATE users SET is_admin = 1"],
    ["a delete", "DELETE FROM sessions"],
    ["a schema name", "DELETE FROM main.users"],
    ["an index on a core table", "CREATE INDEX i ON users (id)"],
    [
      "a trigger",
      "CREATE TRIGGER t AFTER INSERT ON p_foo_a BEGIN SELECT 1; END",
    ],
    ["a view", "CREATE VIEW users_copy AS SELECT * FROM users"],
    ["attaching a database", "ATTACH DATABASE 'x.db' AS other"],
    ["a pragma", "PRAGMA writable_schema = 1"],
    ["a truncate", "TRUNCATE TABLE users"],
    ["an unlogged table", "CREATE UNLOGGED TABLE users (id int)"],
    ["a CTE write", "WITH x AS (SELECT 1) DELETE FROM users"],
  ])("refuses %s", (_label, sql) => {
    expect(findUnownedTableWrites("foo", sql)).not.toEqual([]);
  });

  it.each([
    ["its own table", "CREATE TABLE IF NOT EXISTS p_foo_a (id int)"],
    [
      "a reference to a core table",
      "CREATE TABLE p_foo_a (u text REFERENCES users(id))",
    ],
    ["copying from a core table", "INSERT INTO p_foo_a SELECT id FROM users"],
    ["a column rename", "ALTER TABLE p_foo_a RENAME COLUMN a TO b"],
    [
      "a quoted name in a string",
      "INSERT INTO p_foo_a (x) VALUES ('DROP TABLE users')",
    ],
  ])("allows %s", (_label, sql) => {
    expect(findUnownedTableWrites("foo", sql)).toEqual([]);
  });

  it("passes every migration a bundled plugin ships", () => {
    const plugins = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../plugins",
    );
    for (const id of fs.readdirSync(plugins)) {
      const legacy = new Set(
        Object.entries(LEGACY_TABLE_OWNERS)
          .filter(([, owner]) => owner === id)
          .map(([table]) => table),
      );
      for (const dialect of ["sqlite", "postgres", "mysql"]) {
        const dir = path.join(plugins, id, "migrations", dialect);
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir)) {
          if (!file.endsWith(".sql")) continue;
          const sql = fs.readFileSync(path.join(dir, file), "utf8");
          expect(
            findUnownedTableWrites(id, sql, legacy),
            `${id}/${dialect}/${file}`,
          ).toEqual([]);
        }
      }
    }
  });

  it("gives a user plugin no legacy exemption at runtime", () => {
    const adopt = 'ALTER TABLE "fleets" RENAME TO "p_fleets_fleets"';
    expect(() =>
      assertOwnedTables("fleets", adopt, { bundled: true }),
    ).not.toThrow();
    expect(() => assertOwnedTables("fleets", adopt)).toThrow(/fleets/);
  });
});

describe("reading migrations", () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length) {
      fs.rmSync(roots.pop()!, { recursive: true, force: true });
    }
  });

  it("refuses a migration that is a symlink to a file outside the plugin", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-mig-link-"));
    roots.push(root);
    const outside = path.join(root, "evil.sql");
    fs.writeFileSync(outside, "DROP TABLE users;");
    const dir = path.join(root, "plugin", "migrations", "sqlite");
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.symlinkSync(outside, path.join(dir, "0001_init.sql"), "file");
    } catch {
      return;
    }
    expect(() => readMigrations(path.join(root, "plugin"), "sqlite")).toThrow(
      /outside the plugin/,
    );
  });
});

describe("removePluginData", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    for (const table of [
      "users",
      "p_foo_notes",
      "p_foo_items",
      "p_foo_bar_x",
      "p_other_notes",
    ]) {
      sqlite.exec(`CREATE TABLE "${table}" (id INTEGER PRIMARY KEY)`);
    }
    state.db = drizzle(sqlite);
    state.deleted = [];
  });

  afterEach(() => sqlite.close());

  const tables = () =>
    (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>
    )
      .map((row) => row.name)
      .sort();

  it("drops only the plugin's own tables, found in the catalog", async () => {
    const removed = await removePluginData("foo", {
      knownPluginIds: ["foo", "foo-bar", "other"],
    });
    expect(removed.tables.sort()).toEqual(["p_foo_items", "p_foo_notes"]);
    expect(tables()).toEqual(["p_foo_bar_x", "p_other_notes", "users"]);
  });

  it("takes its settings and secrets with it", async () => {
    await removePluginData("foo", { knownPluginIds: ["foo"] });
    expect(state.deleted).toContain("settings:foo");
    expect(state.deleted).toContain("kv:foo");
    expect(state.deleted).toContain("grants:foo");
  });

  it("leaves a longer prefix another plugin owns", () => {
    expect(
      ownedTableNames(
        "foo",
        ["p_foo_a", "p_foo_bar_b", "p_food_c"],
        ["foo-bar"],
      ),
    ).toEqual(["p_foo_a"]);
  });
});
