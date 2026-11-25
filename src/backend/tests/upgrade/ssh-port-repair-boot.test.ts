import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * The SSH port repair on a real 2.8 database file, run by the core boot: the
 * repair is saved, survives a reopen, and a second boot has nothing left to
 * write.
 */

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-ssh-port-"));
  vi.resetModules();
  vi.stubEnv("DATA_DIR", dataDir);
  vi.stubEnv("DB_FILE_ENCRYPTION", "false");
  vi.stubEnv("ALLOW_EMPTY_DATA_DIR", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function boot() {
  vi.resetModules();
  const db = await import("../../database/db/index.js");
  await db.initializeDatabase();
  // The core boot itself, so the repair has to be registered there.
  const { runCoreBootMigrations } = await import("../../boot.js");
  return { db, repair: runCoreBootMigrations };
}

it("repairs 2.8 and classified rows once, across reopened boots", async () => {
  const seed = new Database(":memory:");
  seed.exec(
    fs.readFileSync(
      new URL("../fixtures/sqlite-2.8-schema.sql", import.meta.url),
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
    INSERT INTO users (id, username, password_hash) VALUES ('owner', 'alice', 'hash');
    INSERT INTO ssh_data (id, user_id, ip, port, ssh_port, username, auth_type, connection_type)
    VALUES
      (1, 'owner', '192.0.2.1', 2222, 22, 'root', 'password', 'ssh'),
      (2, 'owner', '192.0.2.2', 3389, 22, '', 'password', 'rdp'),
      (3, 'owner', '192.0.2.3', 2223, 2223, 'root', 'password', 'ssh');
  `);
  fs.writeFileSync(path.join(dataDir, "db.sqlite"), seed.serialize());
  seed.close();

  const first = await boot();
  // A host 2.9 already classified as inheriting the default.
  first.db
    .getSqlite()
    .prepare(
      `INSERT INTO ssh_data (id, user_id, ip, port, ssh_port, username, auth_type, default_overrides)
       VALUES (4, 'owner', '192.0.2.4', 2224, 22, 'root', 'password', '{"core":[]}')`,
    )
    .run();
  await first.repair();

  const read = (db: typeof first.db) =>
    db
      .getSqlite()
      .prepare(
        "SELECT id, port, ssh_port, default_overrides, updated_at FROM ssh_data ORDER BY id",
      )
      .all() as Array<Record<string, unknown>>;

  const second = await boot();
  const reopened = read(second.db);
  expect(reopened.map(({ updated_at: _updatedAt, ...row }) => row)).toEqual([
    { id: 1, port: 2222, ssh_port: 2222, default_overrides: null },
    { id: 2, port: 3389, ssh_port: 22, default_overrides: null },
    { id: 3, port: 2223, ssh_port: 2223, default_overrides: null },
    {
      id: 4,
      port: 2224,
      ssh_port: 2224,
      default_overrides: '{"core":["sshPort"]}',
    },
  ]);

  await second.repair();
  expect(read(second.db)).toEqual(reopened);
});
