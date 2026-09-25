import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./helpers";

// vault_profiles and vault_tokens as core's SQLite bootstrap created them
// before 2.9.0, including the sync_id column added later.
const LEGACY_DDL = `
  CREATE TABLE vault_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    folder TEXT,
    tags TEXT,
    vault_addr TEXT NOT NULL,
    vault_namespace TEXT,
    oidc_mount TEXT,
    oidc_role TEXT,
    ssh_mount TEXT,
    ssh_role TEXT NOT NULL,
    valid_principals TEXT,
    key_type TEXT,
    shared INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sync_id TEXT,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
  CREATE TABLE vault_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    profile_id INTEGER NOT NULL,
    ssh_cert TEXT NOT NULL,
    private_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    last_used TEXT,
    UNIQUE(user_id, profile_id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (profile_id) REFERENCES vault_profiles (id) ON DELETE CASCADE
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

describe("adopting vault_profiles and vault_tokens", () => {
  it("keeps every existing row when the legacy tables are there", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
        sqlite.exec(LEGACY_DDL);
        sqlite
          .prepare(
            "INSERT INTO vault_profiles (id, user_id, name, vault_addr, ssh_role, shared, sync_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(4, "user-1", "Prod", "https://vault:8200", "ops", 1, "sync-a");
        sqlite
          .prepare(
            "INSERT INTO vault_tokens (user_id, profile_id, ssh_cert, private_key, expires_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run("user-2", 4, "cert", "key", "2999-01-01T00:00:00.000Z");
      },
    });

    expect(tableExists("vault_profiles")).toBe(false);
    expect(tableExists("vault_tokens")).toBe(false);
    expect(db.sqlite.prepare("SELECT * FROM p_vault_profiles").all()).toEqual([
      expect.objectContaining({
        id: 4,
        user_id: "user-1",
        name: "Prod",
        shared: 1,
        sync_id: "sync-a",
      }),
    ]);
    expect(db.sqlite.prepare("SELECT * FROM p_vault_tokens").all()).toEqual([
      expect.objectContaining({ user_id: "user-2", profile_id: 4 }),
    ]);

    // The 2.8 foreign key follows the rename, so deleting a profile still
    // takes its cached certificates with it.
    db.sqlite.exec("PRAGMA foreign_keys = ON");
    db.sqlite.prepare("DELETE FROM p_vault_profiles WHERE id = 4").run();
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM p_vault_tokens").get(),
    ).toEqual({ n: 0 });
  });

  it("creates both tables on a fresh install", async () => {
    db = await createTestDb(pluginDir);
    expect(tableExists("p_vault_profiles")).toBe(true);
    expect(tableExists("p_vault_tokens")).toBe(true);
    expect(
      db.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_vault_tokens_user_profile'",
        )
        .get(),
    ).toBeTruthy();
  });

  it("keeps one certificate per user and profile", async () => {
    db = await createTestDb(pluginDir);
    db.sqlite.exec("INSERT INTO users (id) VALUES ('user-1')");
    const insert = db.sqlite.prepare(
      "INSERT INTO p_vault_tokens (user_id, profile_id, ssh_cert, private_key, expires_at) VALUES ('user-1', 1, 'c', 'k', 'x')",
    );
    insert.run();
    expect(() => insert.run()).toThrow(/UNIQUE/);
  });
});
