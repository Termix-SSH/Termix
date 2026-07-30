import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureSharedHostAuthOverrideProtocolSchema,
  migrateLegacySharedHostAuthOverrides,
} from "../../utils/shared-host-auth-override-migration.js";

describe("migrateLegacySharedHostAuthOverrides", () => {
  let sqlite: Database.Database | null = null;

  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it("creates protocol-aware storage with SSH as the default", () => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE ssh_data (id INTEGER PRIMARY KEY);
      CREATE TABLE ssh_credentials (id INTEGER PRIMARY KEY);
      INSERT INTO users (id) VALUES ('recipient');
      INSERT INTO ssh_data (id) VALUES (42);
      INSERT INTO ssh_credentials (id) VALUES (7);
    `);

    expect(ensureSharedHostAuthOverrideProtocolSchema(sqlite)).toBe("created");
    sqlite
      .prepare(
        "INSERT INTO shared_host_auth_overrides (host_id, user_id, credential_id) VALUES (?, ?, ?)",
      )
      .run(42, "recipient", 7);
    expect(
      sqlite
        .prepare(
          "SELECT protocol, credential_id FROM shared_host_auth_overrides",
        )
        .get(),
    ).toEqual({ protocol: "ssh", credential_id: 7 });
    expect(ensureSharedHostAuthOverrideProtocolSchema(sqlite)).toBe("current");
  });

  it("moves direct-share overrides once and clears the legacy column", () => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE host_access (
        id INTEGER PRIMARY KEY,
        host_id INTEGER NOT NULL,
        user_id TEXT,
        role_id INTEGER,
        override_credential_id INTEGER
      );
      CREATE TABLE shared_host_auth_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        protocol TEXT NOT NULL DEFAULT 'ssh',
        credential_id INTEGER NOT NULL,
        UNIQUE(host_id, user_id, protocol)
      );
      INSERT INTO host_access
        (id, host_id, user_id, role_id, override_credential_id)
      VALUES
        (1, 42, 'direct-user', NULL, 7),
        (2, 42, NULL, 3, 8),
        (3, 43, 'no-override', NULL, NULL);
    `);
    const settings = new Map<string, string>();

    expect(
      migrateLegacySharedHostAuthOverrides(
        sqlite,
        (key) => settings.get(key) ?? null,
        (key, value) => settings.set(key, value),
      ),
    ).toBe(true);

    expect(
      sqlite
        .prepare(
          "SELECT host_id, user_id, protocol, credential_id FROM shared_host_auth_overrides",
        )
        .all(),
    ).toEqual([
      {
        host_id: 42,
        user_id: "direct-user",
        protocol: "ssh",
        credential_id: 7,
      },
    ]);
    expect(
      sqlite
        .prepare("SELECT override_credential_id FROM host_access WHERE id = 1")
        .get(),
    ).toEqual({ override_credential_id: null });

    sqlite
      .prepare("UPDATE host_access SET override_credential_id = 9 WHERE id = 1")
      .run();
    expect(
      migrateLegacySharedHostAuthOverrides(
        sqlite,
        (key) => settings.get(key) ?? null,
        (key, value) => settings.set(key, value),
      ),
    ).toBe(false);
    expect(
      sqlite
        .prepare(
          "SELECT credential_id FROM shared_host_auth_overrides WHERE host_id = 42",
        )
        .get(),
    ).toEqual({ credential_id: 7 });
  });

  it("preserves pre-protocol rows as SSH and permits protocol isolation", () => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE ssh_data (id INTEGER PRIMARY KEY);
      CREATE TABLE ssh_credentials (id INTEGER PRIMARY KEY);
      CREATE TABLE shared_host_auth_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        credential_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(host_id, user_id)
      );
      INSERT INTO users (id) VALUES ('recipient');
      INSERT INTO ssh_data (id) VALUES (42);
      INSERT INTO ssh_credentials (id) VALUES (7), (8);
      INSERT INTO shared_host_auth_overrides
        (host_id, user_id, credential_id)
      VALUES (42, 'recipient', 7);
    `);

    expect(ensureSharedHostAuthOverrideProtocolSchema(sqlite)).toBe("migrated");
    expect(
      sqlite
        .prepare(
          "SELECT protocol, credential_id FROM shared_host_auth_overrides WHERE host_id = 42",
        )
        .all(),
    ).toEqual([{ protocol: "ssh", credential_id: 7 }]);

    sqlite
      .prepare(
        "INSERT INTO shared_host_auth_overrides (host_id, user_id, protocol, credential_id) VALUES (?, ?, ?, ?)",
      )
      .run(42, "recipient", "rdp", 8);
    expect(
      sqlite
        .prepare(
          "SELECT protocol, credential_id FROM shared_host_auth_overrides ORDER BY protocol",
        )
        .all(),
    ).toEqual([
      { protocol: "rdp", credential_id: 8 },
      { protocol: "ssh", credential_id: 7 },
    ]);
    expect(ensureSharedHostAuthOverrideProtocolSchema(sqlite)).toBe("current");
  });
});
