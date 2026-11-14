import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repairSessionRecordingColumns } from "../../upgrade/session-recording-schema-migration.js";

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = new Database(":memory:");
});
afterEach(() => {
  sqlite.close();
});

describe("session recording column upgrade", () => {
  it.each(["session_recordings", "p_session_recording_session_recordings"])(
    "adds username to %s without losing rows",
    (table) => {
      sqlite.exec(
        `CREATE TABLE "${table}" (id INTEGER PRIMARY KEY, host_id INTEGER, recording_path TEXT)`,
      );
      sqlite.prepare(`INSERT INTO "${table}" VALUES (1, 7, '/old.cast')`).run();
      repairSessionRecordingColumns(sqlite);
      repairSessionRecordingColumns(sqlite);
      expect(
        sqlite
          .prepare(`SELECT id, recording_path, username FROM "${table}"`)
          .all(),
      ).toEqual([{ id: 1, recording_path: "/old.cast", username: null }]);
    },
  );

  it("keeps usernames on a current table", () => {
    sqlite.exec(
      `CREATE TABLE "p_session_recording_session_recordings" (id INTEGER PRIMARY KEY, username TEXT)`,
    );
    sqlite
      .prepare(
        `INSERT INTO "p_session_recording_session_recordings" VALUES (1, 'alice')`,
      )
      .run();
    repairSessionRecordingColumns(sqlite);
    expect(
      sqlite
        .prepare("SELECT username FROM p_session_recording_session_recordings")
        .get(),
    ).toEqual({ username: "alice" });
  });

  it("does not create tables on a fresh install", () => {
    repairSessionRecordingColumns(sqlite);
    expect(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all(),
    ).toEqual([]);
  });
});
