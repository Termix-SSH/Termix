import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sharing a host used to hand the owner's SSH authentication to the recipient
 * unconditionally. 2.6.1 put that behind `ssh_data.share_ssh_auth`, added as
 * `NOT NULL DEFAULT 0` — so every host shared before the upgrade silently
 * stopped supplying credentials, and recipients hit "No valid authentication
 * method provided" on hosts that had worked the day before.
 *
 * Hosts that are already shared get the flag turned on, because that is where
 * the old behaviour was in effect. Hosts nobody has shared keep the new
 * default: their owner decides when they share one.
 */
describe("share_ssh_auth backfill", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-share-auth-"));
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

  /** A 2.6.0 database: hosts and shares exist, the column does not. */
  function writePreUpgradeDatabase(): void {
    const seed = new Database(":memory:");
    seed.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );

      CREATE TABLE ssh_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT,
        ip TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT NOT NULL,
        folder TEXT,
        tags TEXT,
        pin INTEGER NOT NULL DEFAULT 0,
        auth_type TEXT NOT NULL DEFAULT 'password',
        enable_terminal INTEGER NOT NULL DEFAULT 1,
        enable_tunnel INTEGER NOT NULL DEFAULT 0,
        enable_file_manager INTEGER NOT NULL DEFAULT 1,
        default_path TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE host_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL,
        user_id TEXT,
        role_id INTEGER,
        granted_by TEXT NOT NULL,
        permission_level TEXT NOT NULL DEFAULT 'use',
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
        VALUES ('owner', 'alice', 'hash'), ('recipient', 'bob', 'hash');

      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type)
        VALUES (1, 'owner', 'shared box', '10.0.0.7', 22, 'root', 'credential'),
               (2, 'owner', 'private box', '10.0.0.8', 22, 'root', 'credential');

      INSERT INTO host_access (host_id, user_id, granted_by, permission_level)
        VALUES (1, 'recipient', 'owner', 'use');
    `);
    fs.writeFileSync(path.join(dataDir, "db.sqlite"), seed.serialize());
    seed.close();
  }

  function shareFlags(
    sqlite: Database.Database,
  ): Record<number, number> {
    const rows = sqlite
      .prepare("SELECT id, share_ssh_auth FROM ssh_data ORDER BY id")
      .all() as Array<{ id: number; share_ssh_auth: number }>;
    return Object.fromEntries(rows.map((r) => [r.id, r.share_ssh_auth]));
  }

  it("keeps already-shared hosts sharing their authentication", async () => {
    writePreUpgradeDatabase();

    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();

    const flags = shareFlags(db.getSqlite());
    expect(flags[1]).toBe(1); // shared before the upgrade
    expect(flags[2]).toBe(0); // never shared, new default stands
  });

  it("does not undo an owner who later turns it back off", async () => {
    writePreUpgradeDatabase();

    const first = await import("../../../database/db/index.js");
    await first.initializeDatabase();
    first
      .getSqlite()
      .prepare("UPDATE ssh_data SET share_ssh_auth = 0 WHERE id = 1")
      .run();
    await first.saveMemoryDatabaseToFile?.();

    // Second startup: the backfill is recorded as done and must not re-run.
    vi.resetModules();
    const second = await import("../../../database/db/index.js");
    await second.initializeDatabase();

    expect(shareFlags(second.getSqlite())[1]).toBe(0);
  });
});
