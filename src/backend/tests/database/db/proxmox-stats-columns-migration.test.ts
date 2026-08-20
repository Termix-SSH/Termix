import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Proxmox Stats feature adds `enable_proxmox_stats` and
 * `proxmox_stats_config` to `ssh_data`, backfilled via `addColumnIfNotExists`
 * next to the existing `enable_proxmox`/`proxmox_config` columns. Verify the
 * migration adds both columns, with the right default, on a database that
 * predates them.
 */
describe("proxmox stats columns migration", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-proxmox-stats-"));
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
        auth_type TEXT NOT NULL DEFAULT 'password',
        enable_proxmox INTEGER NOT NULL DEFAULT 0,
        proxmox_config TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
        VALUES ('owner', 'alice', 'hash');

      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type, enable_proxmox)
        VALUES (1, 'owner', 'pve node', '10.0.0.9', 22, 'root', 'password', 1);
    `);
    fs.writeFileSync(path.join(dataDir, "db.sqlite"), seed.serialize());
    seed.close();
  }

  it("adds enable_proxmox_stats (default 0) and proxmox_stats_config (nullable) columns", async () => {
    writePreUpgradeDatabase();

    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();
    const sqlite = db.getSqlite();

    const columns = sqlite
      .prepare("PRAGMA table_info(ssh_data)")
      .all() as Array<{ name: string; notnull: number; dflt_value: string | null }>;

    const enableCol = columns.find((c) => c.name === "enable_proxmox_stats");
    expect(enableCol).toBeDefined();
    expect(enableCol?.notnull).toBe(1);

    const configCol = columns.find((c) => c.name === "proxmox_stats_config");
    expect(configCol).toBeDefined();
    expect(configCol?.notnull).toBe(0);

    const row = sqlite
      .prepare(
        "SELECT enable_proxmox_stats, proxmox_stats_config FROM ssh_data WHERE id = 1",
      )
      .get() as { enable_proxmox_stats: number; proxmox_stats_config: string | null };

    // Pre-existing rows default to disabled, independent of enable_proxmox.
    expect(row.enable_proxmox_stats).toBe(0);
    expect(row.proxmox_stats_config).toBeNull();
  });

  it("creates the proxmox_node_history and proxmox_stats_preferences tables", async () => {
    writePreUpgradeDatabase();

    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();
    const sqlite = db.getSqlite();

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .pluck()
      .all() as string[];

    expect(tables).toContain("proxmox_node_history");
    expect(tables).toContain("proxmox_stats_preferences");
  });
});
