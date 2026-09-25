/**
 * A user's rows in plugin tables travel with their export and come back on
 * import, found through the table definitions plugins registered rather than
 * any table name core knows.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defineTable,
  encryptedText,
  id,
  refUser,
  text,
  varchar,
} from "@termix/plugin-sdk/db";

let sqlite: Database.Database;

vi.mock("../../database/db/index.js", () => ({
  getDb: () => drizzle(sqlite),
}));
vi.mock("../../utils/logger.js", () => ({
  pluginLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { registerTable, resetPluginData } =
  await import("../../plugins/data.js");
const {
  importUserPluginRows,
  listUserOwnedTables,
  readUserPluginRows,
  writeUserPluginTables,
} = await import("../../plugins/user-data.js");
const { createTableSql } = await import("../../plugins/table-builder.js");

// Stands for an adopted table; adoptLegacyTable only accepts real core names.
const bookmarks = {
  ...defineTable("bookmark", {
    id: id(),
    userId: refUser(),
    path: varchar(200).notNull(),
    note: text(),
    token: encryptedText(),
  }),
  adopts: "bookmarks_legacy",
};
const shared = defineTable("shared_thing", { id: id(), label: text() });

function createTables(target: Database.Database) {
  target.exec("CREATE TABLE users (id TEXT PRIMARY KEY)");
  target.exec("CREATE TABLE ssh_data (id INTEGER PRIMARY KEY)");
  for (const definition of [bookmarks, shared]) {
    for (const statement of createTableSql("sqlite", "fixture", definition)) {
      target.exec(statement);
    }
  }
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  createTables(sqlite);
  sqlite.exec("INSERT INTO users (id) VALUES ('u1'), ('u2')");
  sqlite.exec(`INSERT INTO p_fixture_bookmark (user_id, path, note, token)
    VALUES ('u1', '/etc', 'config', 'sealed'), ('u2', '/var', null, null)`);
  registerTable("fixture", bookmarks);
  registerTable("fixture", shared);
});

afterEach(() => {
  resetPluginData();
  sqlite.close();
});

describe("plugin user data", () => {
  it("lists only tables with a user column, without keys or secrets", () => {
    const [owned] = listUserOwnedTables();
    expect(listUserOwnedTables()).toHaveLength(1);
    expect(owned).toMatchObject({
      pluginId: "fixture",
      table: "p_fixture_bookmark",
      legacyName: "bookmarks_legacy",
      userColumn: "user_id",
      columns: ["user_id", "path", "note"],
    });
  });

  it("reads one user's rows", async () => {
    expect(await readUserPluginRows("u1")).toEqual({
      p_fixture_bookmark: [{ user_id: "u1", path: "/etc", note: "config" }],
    });
  });

  it("round-trips through an export file into another user", async () => {
    // The export file has the user row, as database.ts writes it first.
    const file = new Database(":memory:");
    file.exec("CREATE TABLE users (id TEXT PRIMARY KEY)");
    file.exec("CREATE TABLE ssh_data (id INTEGER PRIMARY KEY)");
    file.exec("INSERT INTO users (id) VALUES ('u1')");
    expect(await writeUserPluginTables(file, "u1")).toBe(1);

    sqlite.exec("DELETE FROM p_fixture_bookmark");
    const result = await importUserPluginRows(file, "u2");
    expect(result).toEqual({ imported: 1, skipped: 0, errors: [] });
    expect(
      sqlite.prepare("SELECT user_id, path FROM p_fixture_bookmark").all(),
    ).toEqual([{ user_id: "u2", path: "/etc" }]);

    const again = await importUserPluginRows(file, "u2");
    expect(again).toMatchObject({ imported: 0, skipped: 1 });
  });

  it("reads a pre-2.9 export by the legacy table name", async () => {
    const file = new Database(":memory:");
    file.exec(
      "CREATE TABLE bookmarks_legacy (id INTEGER PRIMARY KEY, user_id TEXT, path TEXT, note TEXT)",
    );
    file.exec(
      "INSERT INTO bookmarks_legacy (user_id, path, note) VALUES ('old', '/srv', 'x')",
    );
    const result = await importUserPluginRows(file, "u1");
    expect(result.imported).toBe(1);
    expect(
      sqlite
        .prepare(
          "SELECT user_id, note FROM p_fixture_bookmark WHERE path = '/srv'",
        )
        .get(),
    ).toEqual({ user_id: "u1", note: "x" });
  });
});
