import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ssh_data.vault_profile_id points at vault_profiles. The vault plugin renames
// that table to p_vault_profiles, which SQLite follows into ssh_data's foreign
// key, so uninstalling the plugin used to leave every host write failing with
// "no such table: main.p_vault_profiles".
describe("ssh_data and the vault plugin's tables", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-vault-fk-"));
    vi.resetModules();
    vi.stubEnv("DATA_DIR", dataDir);
    vi.stubEnv("DB_FILE_ENCRYPTION", "false");
    vi.stubEnv("ALLOW_EMPTY_DATA_DIR", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function seed(afterAdoption: string): void {
    const seed = new Database(":memory:");
    seed.exec(
      fs.readFileSync(
        new URL("../../fixtures/sqlite-2.8-schema.sql", import.meta.url),
        "utf8",
      ),
    );
    seed.exec(`
      CREATE TABLE plugin_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plugin_id TEXT NOT NULL,
        migration_id TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (plugin_id, migration_id),
        FOREIGN KEY (plugin_id) REFERENCES plugins (id) ON DELETE CASCADE
      );
      INSERT INTO users (id, username, password_hash)
        VALUES ('owner', 'alice', 'hash');
      INSERT INTO ssh_data (id, user_id, ip, port, username, auth_type)
        VALUES (1, 'owner', '192.0.2.1', 22, 'root', 'password');
      ALTER TABLE vault_profiles RENAME TO p_vault_profiles;
      ALTER TABLE vault_tokens RENAME TO p_vault_tokens;
      ${afterAdoption}
    `);
    fs.writeFileSync(path.join(dataDir, "db.sqlite"), seed.serialize());
    seed.close();
  }

  async function boot() {
    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();
    return db.getSqlite();
  }

  function writeHosts(sqlite: Database.Database): void {
    sqlite
      .prepare(
        "INSERT INTO ssh_data (user_id, ip, port, username, auth_type) VALUES ('owner', '192.0.2.2', 22, 'root', 'password')",
      )
      .run();
    sqlite.prepare("DELETE FROM ssh_data WHERE id = 1").run();
  }

  it("repairs a database the plugin was already uninstalled from", async () => {
    seed("DROP TABLE p_vault_tokens; DROP TABLE p_vault_profiles;");
    const sqlite = await boot();

    expect(() => writeHosts(sqlite)).not.toThrow();
  });

  it("leaves nothing in ssh_data pointing at the plugin", async () => {
    seed("");
    const sqlite = await boot();

    expect(
      sqlite.prepare("PRAGMA foreign_key_list(ssh_data)").all(),
    ).not.toContainEqual(expect.objectContaining({ table: "p_vault_profiles" }));
    sqlite.exec("DROP TABLE p_vault_tokens; DROP TABLE p_vault_profiles;");
    expect(() => writeHosts(sqlite)).not.toThrow();
  });
});
