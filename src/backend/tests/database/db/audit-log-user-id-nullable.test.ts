import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The audit trail outlives the account it belongs to: deleting a user
 * anonymises their entries by nulling `user_id` and leaving `username` behind.
 *
 * The Drizzle schema said so, the repository was written against it, but the
 * runtime bootstrap still created `user_id TEXT NOT NULL`. A second, corrected
 * `CREATE TABLE IF NOT EXISTS` further down was a no-op — the table already
 * existed — so every fresh install got the old constraint and every user
 * deletion (including the OIDC account-link cleanup) failed once the account
 * had logged in at least once.
 */
describe("audit_logs.user_id is nullable", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-audit-schema-"));
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

  function userIdIsNotNull(sqlite: Database.Database): boolean {
    const columns = sqlite.prepare("PRAGMA table_info(audit_logs)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    return columns.find((col) => col.name === "user_id")?.notnull === 1;
  }

  it("lets a fresh install outlive the account it logged", async () => {
    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();
    const sqlite = db.getSqlite();

    expect(userIdIsNotNull(sqlite)).toBe(false);

    sqlite
      .prepare("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)")
      .run("user-1", "alice", "hash");
    sqlite
      .prepare(
        `INSERT INTO audit_logs (user_id, username, action, resource_type, success)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("user-1", "alice", "login", "auth", 1);

    expect(() => sqlite.prepare("DELETE FROM users WHERE id = ?").run("user-1")).not.toThrow();

    const row = sqlite.prepare("SELECT user_id, username FROM audit_logs").get() as {
      user_id: string | null;
      username: string;
    };

    // The reference goes, the attribution stays.
    expect(row.user_id).toBeNull();
    expect(row.username).toBe("alice");
  });

  it("rebuilds an existing table that still has the constraint, keeping its rows", async () => {
    const seed = new Database(":memory:");
    seed.exec(`
      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        resource_name TEXT,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        success INTEGER NOT NULL,
        error_message TEXT,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    seed
      .prepare(
        `INSERT INTO audit_logs (user_id, username, action, resource_type, success)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("user-1", "alice", "login", "auth", 1);
    fs.writeFileSync(path.join(dataDir, "db.sqlite"), seed.serialize());
    seed.close();

    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();
    const sqlite = db.getSqlite();

    expect(userIdIsNotNull(sqlite)).toBe(false);

    const row = sqlite.prepare("SELECT user_id, username FROM audit_logs").get() as {
      user_id: string | null;
      username: string;
    };
    expect(row.user_id).toBe("user-1");
    expect(row.username).toBe("alice");
  });
});
