import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { CREDENTIALS_DDL, pluginDir } from "./helpers";

// The three tables as core's SQLite bootstrap created them before 2.9.0.
const LEGACY_DDL = `
  CREATE TABLE termix_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE,
    handle TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX idx_termix_identities_user ON termix_identities(user_id);
  CREATE TABLE termix_identity_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identity_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    key_type TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    label TEXT,
    comment TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    credential_id INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (identity_id) REFERENCES termix_identities (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (credential_id) REFERENCES ssh_credentials (id) ON DELETE SET NULL
  );
  CREATE INDEX idx_termix_identity_keys_identity ON termix_identity_keys(identity_id);
  CREATE TABLE termix_identity_ca (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identity_id INTEGER NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    validity_days INTEGER NOT NULL DEFAULT 90,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (identity_id) REFERENCES termix_identities (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
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

const indexes = (table: string) =>
  (
    db!.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?",
      )
      .all(table) as Array<{ name: string }>
  ).map((row) => row.name);

const count = (table: string) =>
  (
    db!.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
      n: number;
    }
  ).n;

function seed() {
  db!.sqlite.exec(`
    INSERT INTO p_termix_identity_identities (id, user_id, handle) VALUES (1, 'user-1', 'alice');
    INSERT INTO p_termix_identity_keys (identity_id, user_id, public_key, key_type, algorithm, credential_id)
      VALUES (1, 'user-1', 'ssh-ed25519 AAAA', 'ssh-ed25519', 'ED25519', 3);
    INSERT INTO p_termix_identity_ca (identity_id, user_id, public_key, private_key)
      VALUES (1, 'user-1', 'ssh-ed25519 BBBB', 'sealed');
  `);
}

describe("adopting the termix identity tables", () => {
  it("keeps every existing row, index and link when the legacy tables are there", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec(CREDENTIALS_DDL);
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
        sqlite.exec("INSERT INTO ssh_credentials (id) VALUES (3)");
        sqlite.exec(LEGACY_DDL);
        sqlite.exec(`
          INSERT INTO termix_identities (id, user_id, handle, description) VALUES (1, 'user-1', 'alice', 'me');
          INSERT INTO termix_identity_keys (identity_id, user_id, public_key, key_type, algorithm, label, credential_id, enabled)
            VALUES (1, 'user-1', 'ssh-ed25519 AAAA', 'ssh-ed25519', 'ED25519', 'Laptop', 3, 0);
          INSERT INTO termix_identity_ca (identity_id, user_id, public_key, private_key, validity_days)
            VALUES (1, 'user-1', 'ssh-ed25519 BBBB', 'dek-encrypted', 30);
        `);
      },
    });

    expect(tableExists("termix_identities")).toBe(false);
    expect(tableExists("termix_identity_keys")).toBe(false);
    expect(tableExists("termix_identity_ca")).toBe(false);

    expect(
      db.sqlite
        .prepare("SELECT handle, description FROM p_termix_identity_identities")
        .get(),
    ).toEqual({ handle: "alice", description: "me" });
    expect(
      db.sqlite
        .prepare(
          "SELECT label, credential_id, enabled FROM p_termix_identity_keys",
        )
        .get(),
    ).toEqual({ label: "Laptop", credential_id: 3, enabled: 0 });
    expect(
      db.sqlite
        .prepare("SELECT private_key, validity_days FROM p_termix_identity_ca")
        .get(),
    ).toEqual({ private_key: "dek-encrypted", validity_days: 30 });

    expect(indexes("p_termix_identity_identities")).toContain(
      "idx_termix_identities_user",
    );
    expect(
      indexes("p_termix_identity_keys").filter(
        (name) => name === "idx_termix_identity_keys_identity",
      ),
    ).toHaveLength(1);

    // Links follow the rename.
    db.sqlite.exec("DELETE FROM ssh_credentials WHERE id = 3");
    expect(
      db.sqlite
        .prepare("SELECT credential_id FROM p_termix_identity_keys")
        .get(),
    ).toEqual({ credential_id: null });
    db.sqlite.exec("DELETE FROM p_termix_identity_identities WHERE id = 1");
    expect(count("p_termix_identity_keys")).toBe(0);
    expect(count("p_termix_identity_ca")).toBe(0);
  });

  it("creates fresh tables with the same links when there is nothing to adopt", async () => {
    db = await createTestDb(pluginDir, {
      before: (sqlite) => {
        sqlite.exec(CREDENTIALS_DDL);
        sqlite.exec("INSERT INTO users (id) VALUES ('user-1')");
        sqlite.exec("INSERT INTO ssh_credentials (id) VALUES (3)");
      },
    });

    expect(tableExists("termix_identities")).toBe(false);
    seed();
    expect(indexes("p_termix_identity_keys")).toContain(
      "idx_termix_identity_keys_identity",
    );

    db.sqlite.exec("DELETE FROM ssh_credentials WHERE id = 3");
    expect(
      db.sqlite
        .prepare("SELECT credential_id FROM p_termix_identity_keys")
        .get(),
    ).toEqual({ credential_id: null });

    db.sqlite.exec("DELETE FROM users WHERE id = 'user-1'");
    expect(count("p_termix_identity_identities")).toBe(0);
    expect(count("p_termix_identity_keys")).toBe(0);
    expect(count("p_termix_identity_ca")).toBe(0);
  });
});
