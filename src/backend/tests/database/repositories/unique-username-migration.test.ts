import fs from "node:fs";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { TestSqliteDatabase, testDialect } from "./test-support.js";

it("migrates duplicate usernames without colliding with occupied recovery names", async () => {
  const adapter = new TestSqliteDatabase();
  await adapter.connect();
  try {
    await adapter.exec(`CREATE TABLE username_migration_fixture (
      id varchar(255) PRIMARY KEY, username TEXT NOT NULL, registered_at varchar(255) NOT NULL
    );
    INSERT INTO username_migration_fixture VALUES
      ('first', 'alice', '2025-01-01'),
      ('late', 'alice', '2025-02-01'),
      ('other', 'alice-late', '2025-01-01'),
      ('occupied', 'termix-recovered-0-1', '2025-01-01');`);
    const dialect = testDialect();
    const number = dialect === "sqlite" ? "0067" : "0072";
    const migration = fs
      .readFileSync(`drizzle/${dialect}/${number}_unique_username.sql`, "utf8")
      .replace(/\busers\b/g, "username_migration_fixture")
      .replaceAll("idx_users_username", "idx_fixture_username");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await adapter.run(sql.raw(statement));
    }
    const rows = await adapter.query<{ username: string }>(
      sql`SELECT username FROM username_migration_fixture`,
    );
    const names = rows.map((row) => row.username);
    expect(new Set(names).size).toBe(4);
    expect(names).toEqual(
      expect.arrayContaining(["alice", "alice-late", "termix-recovered-0-1"]),
    );
    await expect(async () => {
      await adapter.run(
        sql`INSERT INTO username_migration_fixture VALUES ('new', 'alice', '2026-01-01')`,
      );
    }).rejects.toThrow();
  } finally {
    await adapter.exec("DROP TABLE IF EXISTS username_migration_fixture");
    await adapter.close();
  }
});
