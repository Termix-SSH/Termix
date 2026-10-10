import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A database 2.9 left behind still has the 2.8 columns it kept for a
 * downgrade. Opening it in 26.10.0 drops them, keeps what still matters
 * (a sudo password kept in terminal_config, an SSO sign-in, the hosts and
 * folders themselves) and removes the settings rows the plugins copied.
 */
describe("dropping the columns 2.9.0 kept", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-retire-"));
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

  function write29Database(): void {
    const seed = new Database(":memory:");
    seed.exec(`
      CREATE TABLE plugins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'available',
        source TEXT NOT NULL DEFAULT 'community',
        registry_id TEXT,
        state TEXT NOT NULL DEFAULT 'disabled',
        last_error TEXT,
        installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        auto_update INTEGER NOT NULL DEFAULT 0,
        manifest_json TEXT NOT NULL
      );
      CREATE TABLE plugin_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plugin_id TEXT NOT NULL,
        migration_id TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (plugin_id, migration_id),
        FOREIGN KEY (plugin_id) REFERENCES plugins (id) ON DELETE CASCADE
      );

      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_oidc INTEGER NOT NULL DEFAULT 0,
        oidc_identifier TEXT,
        client_secret TEXT
      );

      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

      CREATE TABLE ssh_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        auth_type TEXT NOT NULL,
        username TEXT
      );

      CREATE TABLE ssh_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT,
        ip TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'password',
        sudo_password TEXT,
        terminal_config TEXT,
        quick_actions TEXT,
        tunnel_connections TEXT,
        enable_docker INTEGER NOT NULL DEFAULT 0,
        stats_config TEXT,
        rdp_user TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE ssh_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        credential_id INTEGER REFERENCES ssh_credentials(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE TABLE user_preferences (
        user_id TEXT PRIMARY KEY,
        theme TEXT,
        terminal_defaults TEXT,
        rdp_defaults TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash, is_oidc, oidc_identifier)
        VALUES ('u1', 'alice', 'hash', 1, 'sub-1');
      INSERT INTO ssh_credentials (id, user_id, name, auth_type)
        VALUES (5, 'u1', 'cred', 'password');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username,
          terminal_config, tunnel_connections, enable_docker, rdp_user)
        VALUES
          (1, 'u1', 'web', '10.0.0.1', 22, '$oidc.preferred_username',
           '{"sudoPassword":"s3cret","theme":"nord"}', '[]', 1, 'admin'),
          (2, 'u1', 'db', '10.0.0.2', 22, 'root', NULL, NULL, 0, NULL);
      INSERT INTO ssh_folders (id, user_id, name, color, credential_id)
        VALUES (3, 'u1', 'prod', '#fff', 5);
      INSERT INTO user_preferences (user_id, theme, terminal_defaults, rdp_defaults)
        VALUES ('u1', 'dark', '{}', '{}');
      INSERT INTO settings (key, value) VALUES
        ('guac_url', 'guacd:4822'),
        ('analytics_enabled', 'true'),
        ('allow_registration', 'false');
    `);
    fs.writeFileSync(path.join(dataDir, "db.sqlite"), seed.serialize());
    seed.close();
  }

  const columns = (sqlite: Database.Database, table: string) =>
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>).map((col) => col.name);

  it("drops the columns and rows and keeps the data that still matters", async () => {
    write29Database();
    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();
    const sqlite = db.getSqlite();

    expect(columns(sqlite, "users")).not.toContain("oidc_identifier");
    expect(columns(sqlite, "users")).not.toContain("is_oidc");
    expect(columns(sqlite, "ssh_data")).not.toEqual(
      expect.arrayContaining(["terminal_config"]),
    );
    for (const gone of [
      "terminal_config",
      "quick_actions",
      "tunnel_connections",
      "enable_docker",
      "stats_config",
    ]) {
      expect(columns(sqlite, "ssh_data")).not.toContain(gone);
    }
    // A login moved only once its owner signs in stays until then.
    expect(columns(sqlite, "ssh_data")).toContain("rdp_user");
    expect(columns(sqlite, "ssh_folders")).not.toContain("credential_id");
    expect(columns(sqlite, "user_preferences")).not.toContain("rdp_defaults");
    expect(columns(sqlite, "user_preferences")).not.toContain(
      "terminal_defaults",
    );

    const hosts = sqlite
      .prepare("SELECT id, username, sudo_password FROM ssh_data ORDER BY id")
      .all();
    expect(hosts).toEqual([
      { id: 1, username: "$external.username", sudo_password: "s3cret" },
      { id: 2, username: "root", sudo_password: null },
    ]);
    expect(
      sqlite.prepare("SELECT name, color FROM ssh_folders").all(),
    ).toEqual([{ name: "prod", color: "#fff" }]);
    expect(
      sqlite.prepare("SELECT theme FROM user_preferences").get(),
    ).toEqual({ theme: "dark" });

    const keys = (
      sqlite.prepare("SELECT key FROM settings").all() as Array<{
        key: string;
      }>
    ).map((row) => row.key);
    expect(keys).toContain("allow_registration");
    expect(keys).not.toContain("guac_url");
    expect(keys).not.toContain("analytics_enabled");
  });

  it("refuses a 2.8 database", async () => {
    const seed = new Database(":memory:");
    seed.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL,
        password_hash TEXT NOT NULL);
      CREATE TABLE ssh_data (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL);
    `);
    fs.writeFileSync(path.join(dataDir, "db.sqlite"), seed.serialize());
    seed.close();

    const db = await import("../../../database/db/index.js");
    await expect(db.initializeDatabase()).rejects.toThrow(/2\.8 or older/);
  });
});
