import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, eq } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { locateSyncRow } from "../../../database/routes/sync.js";
import { hosts, userPreferences } from "../../../database/db/schema.js";

/**
 * A sync push locates the stored row twice: once to see whether it exists,
 * once to write it. Those lookups used to be spelled out separately, and only
 * the read knew about singleton entities — the write always keyed on
 * `table.id`.
 *
 * `user_preferences` is the only singleton, and the one synced table whose
 * primary key is `user_id` with no `id` column at all. `table.id` was
 * therefore `undefined` and drizzle emitted a comparison with nothing on its
 * left: `( = ? and "user_preferences"."user_id" = ?)`. The insert branch was
 * fine, so the first push of preferences succeeded and every push after it —
 * the steady state — failed with `SqliteError: near "=": syntax error`.
 */
describe("locateSyncRow", () => {
  const dialect = new SQLiteSyncDialect();

  const toSql = (condition: Parameters<typeof dialect.sqlToQuery>[0]): string =>
    dialect.sqlToQuery(condition).sql;

  /** `= ?` with no operand to its left — what used to reach SQLite. */
  const EMPTY_LEFT_OPERAND = /(^|\(|\band\b|\bor\b)\s*=\s*\?/;

  it("keys a singleton entity on its owner", () => {
    const sql = toSql(locateSyncRow("userPreferences", "user-1", "ignored"));

    expect(sql).toContain('"user_id"');
    expect(sql).not.toContain('"sync_id"');
    expect(sql).not.toMatch(EMPTY_LEFT_OPERAND);
  });

  it("keys a regular entity on its sync id and owner", () => {
    const sql = toSql(locateSyncRow("hosts", "user-1", "sync-abc"));

    expect(sql).toContain('"sync_id"');
    expect(sql).toContain('"user_id"');
    expect(sql).not.toMatch(EMPTY_LEFT_OPERAND);
  });

  it("is the shape the id-keyed lookup could not produce", () => {
    // Guards the assertions above: the pattern really does catch the old SQL.
    const previous = and(
      eq((userPreferences as unknown as typeof hosts).id, 1),
      eq(userPreferences.userId, "user-1"),
    )!;

    expect(toSql(previous)).toMatch(EMPTY_LEFT_OPERAND);
  });

  it("updates a preferences row that already exists", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE user_preferences (
        user_id TEXT PRIMARY KEY,
        theme TEXT
      );
    `);
    const db = drizzle(sqlite, { schema: { userPreferences } });

    // The steady state: a row exists, so the push takes the update path.
    sqlite
      .prepare("INSERT INTO user_preferences (user_id, theme) VALUES (?, ?)")
      .run("user-1", "dark");

    const updated = db
      .update(userPreferences)
      .set({ theme: "light" })
      .where(locateSyncRow("userPreferences", "user-1", "ignored"))
      .returning({ theme: userPreferences.theme })
      .all();

    expect(updated).toEqual([{ theme: "light" }]);

    sqlite.close();
  });
});
