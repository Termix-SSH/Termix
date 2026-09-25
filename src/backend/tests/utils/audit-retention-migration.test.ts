import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  migrateAuditRetention,
  userDeleteIsDestructive,
} from "../../utils/audit-retention-migration.js";

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

/** The pre-migration shape: both tables cascade from users. */
function legacyDatabase(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL
    );

    CREATE TABLE ssh_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
    );

    CREATE TABLE host_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT
    );

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
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    INSERT INTO users (id, username) VALUES ('u-1', 'alice'), ('u-2', 'bob');
    INSERT INTO ssh_data (id, name) VALUES (1, 'prod-db');

    INSERT INTO audit_logs
      (user_id, username, action, resource_type, resource_id, success, timestamp)
    VALUES
      ('u-1', 'alice', 'host.delete', 'host', '1', 1, '2026-07-01 10:00:00'),
      ('u-1', 'alice', 'credential.view', 'credential', '9', 1, '2026-07-02 11:00:00'),
      ('u-2', 'bob', 'host.create', 'host', '2', 1, '2026-07-03 12:00:00');
  `);
  return sqlite;
}

describe("audit retention migration", () => {
  it("detects the destructive shape and reports it fixed afterwards", () => {
    db = legacyDatabase();

    expect(userDeleteIsDestructive(db, "audit_logs")).toBe(true);

    expect(migrateAuditRetention(db)).toEqual(["audit_logs"]);

    expect(userDeleteIsDestructive(db, "audit_logs")).toBe(false);
  });

  it("keeps the audit trail when the user is deleted", () => {
    db = legacyDatabase();
    migrateAuditRetention(db);

    db.exec("DELETE FROM users WHERE id = 'u-1'");

    const rows = db
      .prepare(
        "SELECT user_id, username, action FROM audit_logs ORDER BY timestamp",
      )
      .all() as { user_id: string | null; username: string; action: string }[];

    expect(rows).toHaveLength(3);
    // The account is gone, but the record still names who acted.
    expect(rows[0]).toEqual({
      user_id: null,
      username: "alice",
      action: "host.delete",
    });
    expect(rows[2].user_id).toBe("u-2");
  });

  it("loses no data in the copy", () => {
    db = legacyDatabase();
    const before = db
      .prepare("SELECT * FROM audit_logs ORDER BY id")
      .all() as Record<string, unknown>[];

    migrateAuditRetention(db);

    const after = db
      .prepare("SELECT * FROM audit_logs ORDER BY id")
      .all() as Record<string, unknown>[];

    expect(after).toEqual(before);
  });

  it("is idempotent and leaves an already-migrated database alone", () => {
    db = legacyDatabase();
    migrateAuditRetention(db);

    const rowsAfterFirst = db.prepare("SELECT * FROM audit_logs").all();
    expect(migrateAuditRetention(db)).toEqual([]);
    expect(db.prepare("SELECT * FROM audit_logs").all()).toEqual(
      rowsAfterFirst,
    );
  });

  it("does nothing on a database without the tables", () => {
    db = new Database(":memory:");

    expect(() => migrateAuditRetention(db)).not.toThrow();
    expect(migrateAuditRetention(db)).toEqual([]);
  });
});
