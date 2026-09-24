import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./helpers";

// session_recordings as core's SQLite bootstrap created it before 2.9.0.
const LEGACY_DDL = `
  CREATE TABLE session_recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id INTEGER NOT NULL,
    user_id TEXT,
    username TEXT,
    access_id INTEGER,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT,
    duration INTEGER,
    commands TEXT,
    dangerous_actions TEXT,
    recording_path TEXT,
    protocol TEXT NOT NULL DEFAULT 'ssh',
    format TEXT NOT NULL DEFAULT 'text',
    terminated_by_owner INTEGER DEFAULT 0,
    termination_reason TEXT,
    FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
  );
`;

let db: TestDb | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

const tableExists = (name: string) =>
  !!db!.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);

describe("adopting session_recordings", () => {
  it("keeps every existing row when the legacy table is there", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1')");
        sqlite.exec("INSERT INTO ssh_data (id) VALUES (7)");
        sqlite.exec(LEGACY_DDL);
        sqlite
          .prepare(
            "INSERT INTO session_recordings (host_id, user_id, username, recording_path, protocol, format) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            7,
            "user-1",
            "user-1",
            "/data/session_logs/user-1/a.cast",
            "ssh",
            "asciicast",
          );
      },
    });

    expect(db.applied).toEqual(["0001_adopt_session_recordings"]);
    expect(tableExists("session_recordings")).toBe(false);
    expect(tableExists("p_session_recording_session_recordings")).toBe(true);

    expect(
      db.sqlite
        .prepare(
          "SELECT host_id, user_id, recording_path, protocol, format FROM p_session_recording_session_recordings",
        )
        .all(),
    ).toEqual([
      {
        host_id: 7,
        user_id: "user-1",
        recording_path: "/data/session_logs/user-1/a.cast",
        protocol: "ssh",
        format: "asciicast",
      },
    ]);
  });

  it("creates the table fresh when there is no legacy one", async () => {
    db = await createTestDb(pluginDir);

    expect(tableExists("session_recordings")).toBe(false);
    expect(tableExists("p_session_recording_session_recordings")).toBe(true);
    expect(
      db.sqlite
        .prepare("SELECT * FROM p_session_recording_session_recordings")
        .all(),
    ).toEqual([]);
  });

  it("cascades on host delete", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1')");
        sqlite.exec("INSERT INTO ssh_data (id) VALUES (7)");
      },
    });
    db.sqlite
      .prepare(
        "INSERT INTO p_session_recording_session_recordings (host_id, user_id, protocol, format) VALUES (?, ?, ?, ?)",
      )
      .run(7, "user-1", "ssh", "asciicast");

    db.sqlite.exec("DELETE FROM ssh_data WHERE id = 7");

    expect(
      db.sqlite
        .prepare("SELECT * FROM p_session_recording_session_recordings")
        .all(),
    ).toEqual([]);
  });

  it("keeps a row whose user was deleted, with userId cleared", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1')");
        sqlite.exec("INSERT INTO ssh_data (id) VALUES (7)");
      },
    });
    db.sqlite
      .prepare(
        "INSERT INTO p_session_recording_session_recordings (host_id, user_id, protocol, format) VALUES (?, ?, ?, ?)",
      )
      .run(7, "user-1", "ssh", "asciicast");

    // userId is a plain column, not refUser(): deleting the user must not
    // cascade delete the row (the plugin clears userId itself on
    // user.deleted instead).
    db.sqlite.exec("DELETE FROM users WHERE id = 'user-1'");

    expect(
      db.sqlite
        .prepare("SELECT host_id FROM p_session_recording_session_recordings")
        .all(),
    ).toEqual([{ host_id: 7 }]);
  });
});
