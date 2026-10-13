import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Registration checked for a taken username before inserting, with nothing in
 * the schema to back it up, so two concurrent sign-ups could both get the same
 * name. Startup renames the later duplicates instead of deleting anyone, then
 * makes the name unique.
 */
describe("users.username uniqueness", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-unique-user-"));
    vi.resetModules();
    process.env.DATA_DIR = dataDir;
    process.env.DB_FILE_ENCRYPTION = "false";
    process.env.ALLOW_EMPTY_DATA_DIR = "true";
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.DB_FILE_ENCRYPTION;
    delete process.env.ALLOW_EMPTY_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function writeDatabaseWithDuplicates(): void {
    const seed = new Database(":memory:");
    seed.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash, registered_at) VALUES
        ('late', 'alice', 'hash', '2025-03-01 00:00:00'),
        ('first', 'alice', 'hash', '2025-01-01 00:00:00'),
        ('tie-b', 'bob', 'hash', '2025-01-01 00:00:00'),
        ('tie-a', 'bob', 'hash', '2025-01-01 00:00:00'),
        ('only', 'Alice', 'hash', '2025-02-01 00:00:00');
    `);
    fs.writeFileSync(path.join(dataDir, "db.sqlite"), seed.serialize());
    seed.close();
  }

  async function bootAndGetSqlite(): Promise<Database.Database> {
    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();
    return db.getSqlite();
  }

  it("keeps the oldest holder of a name and renames the rest", async () => {
    writeDatabaseWithDuplicates();

    const sqlite = await bootAndGetSqlite();

    const names = Object.fromEntries(
      sqlite
        .prepare("SELECT id, username FROM users")
        .raw()
        .all() as [string, string][],
    );
    expect(names).toEqual({
      first: "alice",
      late: "alice-late",
      "tie-a": "bob",
      "tie-b": "bob-tie-b",
      only: "Alice",
    });
  });

  it("rejects a second user with a taken name", async () => {
    const sqlite = await bootAndGetSqlite();

    const insert = sqlite.prepare(
      "INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)",
    );
    insert.run("u1", "alice", "hash");

    expect(() => insert.run("u2", "alice", "hash")).toThrow(/UNIQUE/i);
  });
});
