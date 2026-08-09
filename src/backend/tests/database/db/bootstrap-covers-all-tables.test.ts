import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `migrateSchema()` carried a `SELECT id FROM <table> LIMIT 1` probe for a
 * number of tables that the primary bootstrap already creates. The probe never
 * threw, so the `CREATE TABLE IF NOT EXISTS` in its catch never ran — and two
 * of those unreachable copies had drifted away from the real definition
 * (`sessions` had lost `ON DELETE CASCADE`; `session_recordings` still had the
 * pre-#1128 `user_id NOT NULL` with `ON DELETE CASCADE` and no `username`).
 *
 * They are gone now. What has to stay true is that the bootstrap alone
 * produces every one of those tables, from an empty database and from a
 * database that predates them.
 */
describe("bootstrap creates the tables the removed probes covered", () => {
  let dataDir: string;

  // Exactly the tables whose unreachable re-creation was deleted.
  const TABLES = [
    "c2s_tunnel_presets",
    "sessions",
    "trusted_devices",
    "host_access",
    "roles",
    "user_roles",
    "audit_logs",
    "session_recordings",
    "api_keys",
    "session_shares",
    "session_share_participants",
  ];

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-bootstrap-"));
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

  function tablesIn(sqlite: Database.Database): Set<string> {
    const rows = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .pluck()
      .all() as string[];
    return new Set(rows);
  }

  it("creates them all on a fresh database", async () => {
    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();

    const present = tablesIn(db.getSqlite());
    expect([...TABLES].filter((t) => !present.has(t))).toEqual([]);
  });

  it("creates them on a database old enough to predate them", async () => {
    // A database with users and hosts but none of the tables above — the
    // upgrade path the deleted probes appeared to be protecting.
    const seed = new Database(":memory:");
    seed.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );
      INSERT INTO users (id, username, password_hash)
        VALUES ('user-1', 'alice', 'hash');
    `);
    fs.writeFileSync(path.join(dataDir, "db.sqlite"), seed.serialize());
    seed.close();

    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();
    const sqlite = db.getSqlite();

    const present = tablesIn(sqlite);
    expect([...TABLES].filter((t) => !present.has(t))).toEqual([]);

    // The row that was already there is still there: this is an upgrade, not
    // a rebuild.
    const count = sqlite
      .prepare("SELECT COUNT(*) FROM users")
      .pluck()
      .get() as number;
    expect(count).toBe(1);
  });

  it("keeps the definitions the stale copies disagreed with", async () => {
    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();
    const sqlite = db.getSqlite();

    // session_recordings: nullable user_id with the attribution kept, per
    // "audit trails survive the account" — not the NOT NULL + CASCADE the
    // dead copy still carried.
    const columns = sqlite
      .prepare("PRAGMA table_info(session_recordings)")
      .all() as Array<{ name: string; notnull: number }>;
    const userId = columns.find((c) => c.name === "user_id");
    expect(userId?.notnull).toBe(0);
    expect(columns.some((c) => c.name === "username")).toBe(true);

    // sessions: the dead copy had dropped ON DELETE CASCADE.
    const sql = sqlite
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sessions'",
      )
      .pluck()
      .get() as string;
    expect(sql.replace(/\s+/g, " ")).toContain("ON DELETE CASCADE");
  });
});
