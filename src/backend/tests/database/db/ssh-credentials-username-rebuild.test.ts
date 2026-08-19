import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `ssh_credentials.username` became nullable when key-only credentials landed,
 * and databases created before that are rebuilt on startup to drop the
 * constraint — SQLite cannot ALTER a column.
 *
 * The rebuild restated the table's columns as a literal, then copied rows with
 * `INSERT INTO temp SELECT <every live column>`. The table has gained columns
 * since (cert_public_key, pin, sort_order, sync_id), so the literal was
 * narrower than the source: the INSERT failed on a column count mismatch, the
 * error was swallowed as a warning, and the constraint survived every restart.
 *
 * Deriving the replacement table from `sqlite_master` keeps the two in step by
 * construction. DROP TABLE also discards the table's indexes, so those are
 * replayed rather than left to whatever runs later.
 */
describe("ssh_credentials username rebuild", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-cred-rebuild-"));
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

  /**
   * A database as a 2.6.x run leaves it: the old NOT NULL constraint is still
   * there, but the columns added since are present, as is the sync_id index.
   */
  function writeDatabaseNeedingRebuild(): void {
    const seed = new Database(":memory:");
    seed.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );

      INSERT INTO users (id, username, password_hash) VALUES ('user-1', 'alice', 'hash');

      CREATE TABLE ssh_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        folder TEXT,
        tags TEXT,
        auth_type TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT,
        key TEXT,
        key_password TEXT,
        key_type TEXT,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        private_key TEXT,
        public_key TEXT,
        detected_key_type TEXT,
        cert_public_key TEXT,
        pin INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER,
        sync_id TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX idx_ssh_credentials_sync_id ON ssh_credentials(sync_id);
    `);
    seed
      .prepare(
        `INSERT INTO ssh_credentials (user_id, name, auth_type, username, pin, sort_order, sync_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("user-1", "prod box", "password", "root", 1, 3, "sync-abc");
    fs.writeFileSync(path.join(dataDir, "db.sqlite"), seed.serialize());
    seed.close();
  }

  async function bootAndGetSqlite(): Promise<Database.Database> {
    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();
    return db.getSqlite();
  }

  function usernameIsNotNull(sqlite: Database.Database): boolean {
    const columns = sqlite.prepare("PRAGMA table_info(ssh_credentials)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    return columns.find((col) => col.name === "username")?.notnull === 1;
  }

  it("drops the constraint even though the table outgrew the old column list", async () => {
    writeDatabaseNeedingRebuild();

    const sqlite = await bootAndGetSqlite();

    expect(usernameIsNotNull(sqlite)).toBe(false);

    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO ssh_credentials (user_id, name, auth_type, key)
           VALUES (?, ?, ?, ?)`,
        )
        .run("user-1", "key only", "key", "PRIVATE KEY"),
    ).not.toThrow();
  });

  it("carries every column across, including the ones added after the rebuild was written", async () => {
    writeDatabaseNeedingRebuild();

    const sqlite = await bootAndGetSqlite();

    const row = sqlite.prepare("SELECT * FROM ssh_credentials WHERE name = ?").get("prod box") as {
      user_id: string;
      username: string;
      auth_type: string;
      pin: number;
      sort_order: number;
      sync_id: string;
    };

    expect(row.user_id).toBe("user-1");
    expect(row.username).toBe("root");
    expect(row.auth_type).toBe("password");
    expect(row.pin).toBe(1);
    expect(row.sort_order).toBe(3);
    // sync_id identifies the row to remote sync; losing it re-keys the record.
    expect(row.sync_id).toBe("sync-abc");
  });

  it("keeps the sync_id uniqueness that DROP TABLE would otherwise discard", async () => {
    writeDatabaseNeedingRebuild();

    const sqlite = await bootAndGetSqlite();

    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ssh_credentials'")
      .pluck()
      .all() as string[];
    expect(indexes).toContain("idx_ssh_credentials_sync_id");

    sqlite
      .prepare("INSERT INTO ssh_credentials (user_id, name, auth_type, sync_id) VALUES (?, ?, ?, ?)")
      .run("user-1", "other box", "key", "sync-xyz");

    expect(() =>
      sqlite.prepare("UPDATE ssh_credentials SET sync_id = ? WHERE name = ?").run("sync-abc", "other box"),
    ).toThrow(/UNIQUE/i);
  });
});
