/**
 * The 2.8 to 2.9 TOTP move. A user who had TOTP on must still be asked for it
 * after upgrading: their enrolment row points at the totp plugin, and their
 * secret and backup codes reach the plugin's table readable. Running it twice
 * changes nothing, and without the plugin's table the enrolment still moves
 * so the login fails closed.
 */

import crypto from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FieldCrypto } from "../../utils/field-crypto.js";

const h = vi.hoisted(() => ({
  db: null as unknown,
  deks: new Map<string, Buffer>(),
}));

vi.mock("../../database/db/index.js", () => ({ getDb: () => h.db }));
vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: { getUserDataKey: (userId: string) => h.deks.get(userId) },
}));
vi.mock("../../utils/system-secret-crypto.js", () => ({
  encryptSystemSecret: async (value: string) => `sysenc:${value}`,
}));
vi.mock("../../utils/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { databaseLogger: log };
});

const { runTotpMigration } =
  await import("../../utils/crypto-migration/totp-migration.js");

let sqlite: Database.Database;

function setup({ pluginTable }: { pluginTable: boolean }) {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      totp_backup_codes TEXT
    );
    CREATE TABLE user_second_factors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      plugin_id TEXT NOT NULL,
      factor_id TEXT NOT NULL,
      enrolled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, plugin_id, factor_id)
    );
  `);
  if (pluginTable) {
    sqlite.exec(`
      CREATE TABLE p_totp_enrollments (
        user_id TEXT PRIMARY KEY NOT NULL,
        secret TEXT,
        pending_secret TEXT,
        backup_codes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }
  h.db = drizzle(sqlite);
}

function addTotpUser(id: string, secret: string, codes: string[]) {
  const dek = crypto.randomBytes(32);
  h.deks.set(id, dek);
  sqlite
    .prepare(
      "INSERT INTO users (id, username, totp_secret, totp_enabled, totp_backup_codes) VALUES (?, ?, ?, 1, ?)",
    )
    .run(
      id,
      id,
      FieldCrypto.encryptField(secret, dek, id, "totpSecret"),
      FieldCrypto.encryptField(
        JSON.stringify(codes),
        dek,
        id,
        "totpBackupCodes",
      ),
    );
}

const factors = () =>
  sqlite
    .prepare(
      "SELECT user_id, plugin_id, factor_id FROM user_second_factors ORDER BY user_id",
    )
    .all();

beforeEach(() => {
  h.deks.clear();
});

describe("runTotpMigration", () => {
  it("keeps a 2.8 TOTP user behind their factor, with a readable secret", async () => {
    setup({ pluginTable: true });
    addTotpUser("alice", "JBSWY3DPEHPK3PXP", ["AAAA1111", "BBBB2222"]);
    addTotpUser("bob", "KRSXG5CTMVRXEZLU", []);
    sqlite.exec(`INSERT INTO users (id, username) VALUES ('carol', 'carol')`);
    // A8 recorded alice under core; bob only has the flag.
    sqlite.exec(
      `INSERT INTO user_second_factors (user_id, plugin_id, factor_id) VALUES ('alice', 'core', 'totp')`,
    );

    expect(await runTotpMigration()).toEqual({ factors: 2, secrets: 2 });

    expect(factors()).toEqual([
      { user_id: "alice", plugin_id: "totp", factor_id: "totp" },
      { user_id: "bob", plugin_id: "totp", factor_id: "totp" },
    ]);
    const alice = sqlite
      .prepare("SELECT * FROM p_totp_enrollments WHERE user_id = 'alice'")
      .get() as Record<string, string>;
    expect(alice.secret).toBe("sysenc:JBSWY3DPEHPK3PXP");
    expect(alice.backup_codes).toBe(
      `sysenc:${JSON.stringify(["AAAA1111", "BBBB2222"])}`,
    );
    expect(alice.pending_secret).toBeNull();
    expect(
      sqlite
        .prepare(
          "SELECT totp_enabled, totp_secret, totp_backup_codes FROM users WHERE id = 'alice'",
        )
        .get(),
    ).toEqual({ totp_enabled: 0, totp_secret: null, totp_backup_codes: null });

    // A second boot changes nothing.
    expect(await runTotpMigration()).toEqual({ factors: 0, secrets: 0 });
    expect(factors()).toHaveLength(2);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM p_totp_enrollments").get(),
    ).toEqual({ n: 2 });
  });

  it("moves the enrolment but keeps the columns while the plugin table is missing", async () => {
    setup({ pluginTable: false });
    addTotpUser("alice", "JBSWY3DPEHPK3PXP", ["AAAA1111"]);

    expect(await runTotpMigration()).toEqual({ factors: 1, secrets: 0 });
    expect(factors()).toEqual([
      { user_id: "alice", plugin_id: "totp", factor_id: "totp" },
    ]);
    const row = sqlite
      .prepare("SELECT totp_enabled, totp_secret FROM users WHERE id = 'alice'")
      .get() as { totp_enabled: number; totp_secret: string };
    expect(row.totp_enabled).toBe(1);
    expect(row.totp_secret).toBeTruthy();
    expect(await runTotpMigration()).toEqual({ factors: 0, secrets: 0 });
  });

  it("skips a user whose data key is unavailable and retries later", async () => {
    setup({ pluginTable: true });
    addTotpUser("alice", "JBSWY3DPEHPK3PXP", []);
    const dek = h.deks.get("alice")!;
    h.deks.delete("alice");

    expect(await runTotpMigration()).toEqual({ factors: 1, secrets: 0 });
    h.deks.set("alice", dek);
    expect(await runTotpMigration()).toEqual({ factors: 0, secrets: 1 });
  });

  it("drops a duplicate core row when the plugin row already exists", async () => {
    setup({ pluginTable: true });
    sqlite.exec(`
      INSERT INTO users (id, username) VALUES ('dave', 'dave');
      INSERT INTO user_second_factors (user_id, plugin_id, factor_id) VALUES ('dave', 'core', 'totp');
      INSERT INTO user_second_factors (user_id, plugin_id, factor_id) VALUES ('dave', 'totp', 'totp');
    `);
    await runTotpMigration();
    expect(factors()).toEqual([
      { user_id: "dave", plugin_id: "totp", factor_id: "totp" },
    ]);
  });

  it("does nothing on a fresh install without the legacy columns", async () => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL);
      CREATE TABLE user_second_factors (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL, factor_id TEXT NOT NULL,
        enrolled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    h.db = drizzle(sqlite);
    expect(await runTotpMigration()).toEqual({ factors: 0, secrets: 0 });
  });
});
