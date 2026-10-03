import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repairSnippetsNoteColumn } from "../../upgrade/snippets-schema-migration.js";

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = new Database(":memory:");
});
afterEach(() => {
  sqlite.close();
});

describe("snippet note column upgrade", () => {
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
      repairSnippetsNoteColumn(sqlite);
      if (table === "snippets") {
        sqlite.exec(
          readFileSync(
            "plugins/snippets/migrations/sqlite/0001_adopt_snippets_tables.sql",
            "utf8",
          ),
        );
      }
      expect(
        sqlite
          .prepare("SELECT id, content, is_note FROM p_snippets_snippets")
          .get(),
      ).toEqual({ id: 7, content: "echo hello", is_note: 0 });
      sqlite.exec("UPDATE p_snippets_snippets SET is_note = 1");
      repairSnippetsNoteColumn(sqlite);
      expect(
        sqlite.prepare("SELECT is_note FROM p_snippets_snippets").get(),
      ).toEqual({ is_note: 1 });
    },
  );

  it("does not create tables on a fresh install", () => {
    repairSnippetsNoteColumn(sqlite);
    expect(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all(),
    ).toEqual([]);
  });
});
