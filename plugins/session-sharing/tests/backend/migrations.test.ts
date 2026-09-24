import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./helpers";

// The four tables as core's SQLite bootstrap created them before 2.9.0,
// including the guest token column and its index added later.
const LEGACY_DDL = `
  CREATE TABLE session_shares (
    id TEXT PRIMARY KEY,
    host_id INTEGER NOT NULL,
    owner_user_id TEXT NOT NULL,
    protocol TEXT NOT NULL,
    session_id TEXT NOT NULL,
    tab_instance_id TEXT,
    share_type TEXT NOT NULL,
    target_user_id TEXT,
    link_token TEXT UNIQUE,
    permission_level TEXT NOT NULL DEFAULT 'read-only',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    last_joined_at TEXT,
    join_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (host_id) REFERENCES ssh_data (id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE CASCADE
  );
  CREATE TABLE session_share_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id TEXT NOT NULL,
    user_id TEXT,
    guest_label TEXT,
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at TEXT,
    FOREIGN KEY (share_id) REFERENCES session_shares (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
  CREATE TABLE collab_rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    persistent INTEGER NOT NULL DEFAULT 0,
    presenter_user_id TEXT,
    stage_protocol TEXT,
    stage_host_id INTEGER,
    stage_share_id TEXT,
    guest_link_token TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT,
    FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (presenter_user_id) REFERENCES users (id) ON DELETE SET NULL,
    FOREIGN KEY (stage_host_id) REFERENCES ssh_data (id) ON DELETE SET NULL,
    FOREIGN KEY (stage_share_id) REFERENCES session_shares (id) ON DELETE SET NULL
  );
  CREATE TABLE collab_room_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    room_role TEXT NOT NULL DEFAULT 'member',
    added_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES collab_rooms (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (added_by) REFERENCES users (id) ON DELETE SET NULL
  );
  CREATE INDEX idx_session_shares_session_id ON session_shares (session_id);
  CREATE INDEX idx_session_shares_host_id ON session_shares (host_id);
  CREATE UNIQUE INDEX idx_collab_rooms_guest_token ON collab_rooms (guest_link_token);
`;

const TABLES = {
  session_shares: "p_session_sharing_shares",
  session_share_participants: "p_session_sharing_share_participants",
  collab_rooms: "p_session_sharing_rooms",
  collab_room_members: "p_session_sharing_room_members",
};

let db: TestDb | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

const exists = (type: "table" | "index", name: string) =>
  !!db!.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?")
    .get(type, name);

function seedUsersAndHost(sqlite: TestDb["sqlite"]) {
  sqlite.exec(
    "INSERT INTO users (id, username) VALUES ('alice', 'alice'), ('bob', 'bob')",
  );
  sqlite.exec("INSERT INTO ssh_data (id) VALUES (7)");
}

describe("adopting the session sharing tables", () => {
  it("keeps every row and index when the legacy tables are there", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        seedUsersAndHost(sqlite);
        sqlite.exec(LEGACY_DDL);
        sqlite.exec(`
          INSERT INTO session_shares (id, host_id, owner_user_id, protocol, session_id, share_type, link_token, permission_level, expires_at, join_count)
          VALUES ('share-1', 7, 'alice', 'ssh', 'sess-1', 'link', 'tok-1', 'read-write', '2999-01-01T00:00:00.000Z', 3);
          INSERT INTO session_share_participants (share_id, user_id, guest_label) VALUES ('share-1', NULL, 'Guest');
          INSERT INTO collab_rooms (id, name, owner_user_id, persistent, stage_share_id, stage_host_id, guest_link_token)
          VALUES ('room-1', 'Standup', 'alice', 1, 'share-1', 7, 'guest-tok');
          INSERT INTO collab_room_members (room_id, user_id, room_role) VALUES ('room-1', 'alice', 'host'), ('room-1', 'bob', 'member');
        `);
      },
    });

    expect(db.applied).toEqual(["0001_adopt_session_sharing"]);
    for (const [legacy, adopted] of Object.entries(TABLES)) {
      expect(exists("table", legacy)).toBe(false);
      expect(exists("table", adopted)).toBe(true);
    }

    expect(
      db.sqlite
        .prepare(
          "SELECT id, link_token, permission_level, join_count FROM p_session_sharing_shares",
        )
        .all(),
    ).toEqual([
      {
        id: "share-1",
        link_token: "tok-1",
        permission_level: "read-write",
        join_count: 3,
      },
    ]);
    expect(
      db.sqlite
        .prepare(
          "SELECT name, persistent, stage_share_id, guest_link_token FROM p_session_sharing_rooms",
        )
        .get(),
    ).toEqual({
      name: "Standup",
      persistent: 1,
      stage_share_id: "share-1",
      guest_link_token: "guest-tok",
    });
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS n FROM p_session_sharing_room_members")
        .get(),
    ).toEqual({ n: 2 });
    expect(
      db.sqlite
        .prepare("SELECT guest_label FROM p_session_sharing_share_participants")
        .get(),
    ).toEqual({ guest_label: "Guest" });

    for (const index of [
      "idx_session_shares_session_id",
      "idx_session_shares_host_id",
      "idx_collab_rooms_guest_token",
      "idx_collab_rooms_owner",
      "idx_collab_room_members_user",
    ]) {
      expect(exists("index", index)).toBe(true);
    }
  });

  it("follows the rename in the links between the tables", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        seedUsersAndHost(sqlite);
        sqlite.exec(LEGACY_DDL);
      },
    });
    const ddl = (name: string) =>
      (
        db!.sqlite
          .prepare("SELECT sql FROM sqlite_master WHERE name = ?")
          .get(name) as { sql: string }
      ).sql;

    expect(ddl("p_session_sharing_rooms")).toContain(
      '"p_session_sharing_shares"',
    );
    expect(ddl("p_session_sharing_room_members")).toContain(
      '"p_session_sharing_rooms"',
    );
  });

  it("creates the tables fresh when there are no legacy ones", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => seedUsersAndHost(sqlite),
    });

    for (const [legacy, adopted] of Object.entries(TABLES)) {
      expect(exists("table", legacy)).toBe(false);
      expect(exists("table", adopted)).toBe(true);
    }

    db.sqlite.exec(`
      INSERT INTO p_session_sharing_shares (id, host_id, owner_user_id, protocol, session_id, share_type, expires_at)
      VALUES ('s', 7, 'alice', 'ssh', 'x', 'room', '2999-01-01');
      INSERT INTO p_session_sharing_rooms (id, name, owner_user_id, stage_share_id) VALUES ('r', 'R', 'alice', 's');
      INSERT INTO p_session_sharing_room_members (room_id, user_id) VALUES ('r', 'bob');
    `);
    // The hand-kept set-null link: deleting the share clears the stage.
    db.sqlite.exec("DELETE FROM p_session_sharing_shares WHERE id = 's'");
    expect(
      db.sqlite
        .prepare("SELECT stage_share_id FROM p_session_sharing_rooms")
        .get(),
    ).toEqual({ stage_share_id: null });
    // And deleting a user cascades to their memberships.
    db.sqlite.exec("DELETE FROM users WHERE id = 'bob'");
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS n FROM p_session_sharing_room_members")
        .get(),
    ).toEqual({ n: 0 });
  });
});
