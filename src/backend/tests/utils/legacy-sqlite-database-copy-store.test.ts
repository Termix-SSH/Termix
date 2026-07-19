import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { LegacySqliteDatabaseCopyStore } from "../../utils/legacy-sqlite-database-copy-store.js";

describe("LegacySqliteDatabaseCopyStore", () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  function createLegacyDatabase(): string {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-legacy-copy-"));
    const dbPath = path.join(tempDir, "db.sqlite");
    const db = new Database(dbPath);

    try {
      db.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL
        );
        CREATE TABLE ssh_data (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );
        INSERT INTO users (id, username) VALUES ('user-1', 'alice');
        INSERT INTO ssh_data (user_id, name) VALUES ('user-1', 'host-1');
      `);
    } finally {
      db.close();
    }

    return dbPath;
  }

  it("copies legacy SQLite schema and rows into a serialized memory buffer", () => {
    const dbPath = createLegacyDatabase();

    const result =
      new LegacySqliteDatabaseCopyStore().copyDatabaseToMemoryBuffer(dbPath);

    expect(result.migratedTables).toBe(2);
    expect(result.migratedRows).toBe(2);
    expect(result.buffer.length).toBeGreaterThan(0);

    const copied = new Database(result.buffer);
    try {
      expect(
        copied.prepare("SELECT username FROM users WHERE id = ?").get("user-1"),
      ).toEqual({ username: "alice" });
      expect(
        copied
          .prepare("SELECT name FROM ssh_data WHERE user_id = ?")
          .get("user-1"),
      ).toEqual({ name: "host-1" });
      expect(copied.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      copied.close();
    }
  });
});
