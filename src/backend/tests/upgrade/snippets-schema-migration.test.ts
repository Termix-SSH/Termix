import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repairSnippetsColumns } from "../../upgrade/snippets-schema-migration.js";

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = new Database(":memory:");
});
afterEach(() => {
  sqlite.close();
});

describe("snippet column upgrade", () => {
  it.each(["snippets", "p_snippets_snippets"])(
    "repairs %s without losing rows",
    (table) => {
      sqlite.exec(
        `CREATE TABLE "${table}" (id INTEGER PRIMARY KEY, user_id TEXT, content TEXT)`,
      );
      sqlite
        .prepare(`INSERT INTO "${table}" VALUES (7, 'user', 'echo hello')`)
        .run();
      expect(() => sqlite.prepare(`SELECT "is_note" FROM "${table}"`)).toThrow(
        /is_note/,
      );
      repairSnippetsColumns(sqlite);
      if (table === "snippets") {
        // What the plugin migration does to the legacy table.
        sqlite.exec(`ALTER TABLE "snippets" RENAME TO "p_snippets_snippets"`);
      }
      expect(
        sqlite
          .prepare("SELECT id, content, is_note FROM p_snippets_snippets")
          .get(),
      ).toEqual({ id: 7, content: "echo hello", is_note: 0 });
      sqlite.exec("UPDATE p_snippets_snippets SET is_note = 1");
      repairSnippetsColumns(sqlite);
      expect(
        sqlite.prepare("SELECT is_note FROM p_snippets_snippets").get(),
      ).toEqual({ is_note: 1 });
    },
  );

  it("does not create tables on a fresh install", () => {
    repairSnippetsColumns(sqlite);
    expect(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all(),
    ).toEqual([]);
  });

  it("adds and fills sync ids on old snippet and folder tables", () => {
    sqlite.exec(
      `CREATE TABLE "p_snippets_snippets" (id INTEGER PRIMARY KEY, user_id TEXT, name TEXT, content TEXT)`,
    );
    sqlite.exec(
      `CREATE TABLE "snippet_folders" (id INTEGER PRIMARY KEY, user_id TEXT, name TEXT)`,
    );
    sqlite.exec(
      `INSERT INTO "p_snippets_snippets" VALUES (1, 'u', 'a', 'ls'), (2, 'u', 'b', 'pwd')`,
    );
    sqlite.exec(`INSERT INTO "snippet_folders" VALUES (1, 'u', 'ops')`);
    repairSnippetsColumns(sqlite);

    const snippets = sqlite
      .prepare(
        `SELECT "sync_id", "folder", "order", "host_filter" FROM "p_snippets_snippets"`,
      )
      .all() as Array<{ sync_id: string; order: number }>;
    expect(snippets).toHaveLength(2);
    expect(snippets[0].sync_id).toMatch(/^[0-9a-f]{32}$/);
    expect(snippets[0].sync_id).not.toBe(snippets[1].sync_id);
    expect(snippets[0].order).toBe(0);
    expect(
      sqlite
        .prepare(`SELECT "sync_id", "color", "icon" FROM "snippet_folders"`)
        .get(),
    ).toMatchObject({ color: null, icon: null });
    expect(() =>
      sqlite.exec(`UPDATE "p_snippets_snippets" SET "sync_id" = 'same'`),
    ).toThrow(/UNIQUE/);

    const before = sqlite
      .prepare(`SELECT "sync_id" FROM "p_snippets_snippets" ORDER BY id`)
      .all();
    repairSnippetsColumns(sqlite);
    expect(
      sqlite
        .prepare(`SELECT "sync_id" FROM "p_snippets_snippets" ORDER BY id`)
        .all(),
    ).toEqual(before);
  });
});
