/**
 * The 2.8 to 2.9 Termix ID CA move. A CA private key encrypted with the
 * owner's data key must end up sealed with the installation key in the
 * plugin's adopted table, readable, and a second run changes nothing.
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
  isSystemEncrypted: (value: string) => value.startsWith("sysenc:v1:"),
  encryptSystemSecret: async (value: string) => `sysenc:v1:${value}`,
}));
vi.mock("../../utils/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { databaseLogger: log };
});

const { runTermixIdentityCaMigration } =
  await import("../../utils/crypto-migration/termix-identity-ca-migration.js");

const PEM = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n";

let sqlite: Database.Database;

function setup({ pluginTable }: { pluginTable: boolean }) {
  sqlite = new Database(":memory:");
  if (pluginTable) {
    sqlite.exec(`
      CREATE TABLE p_termix_identity_ca (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identity_id INTEGER NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        private_key TEXT NOT NULL,
        validity_days INTEGER NOT NULL DEFAULT 90
      );
    `);
  }
  h.db = drizzle(sqlite);
}

function addCa(id: number, userId: string, withKey = true) {
  const dek = crypto.randomBytes(32);
  if (withKey) h.deks.set(userId, dek);
  sqlite
    .prepare(
      "INSERT INTO p_termix_identity_ca (id, identity_id, user_id, public_key, private_key) VALUES (?, ?, ?, 'ssh-ed25519 AAAA', ?)",
    )
    .run(
      id,
      id,
      userId,
      FieldCrypto.encryptField(PEM, dek, String(id), "privateKey"),
    );
}

const keyOf = (id: number) =>
  (
    sqlite
      .prepare("SELECT private_key FROM p_termix_identity_ca WHERE id = ?")
      .get(id) as { private_key: string }
  ).private_key;

beforeEach(() => {
  h.deks.clear();
});

describe("runTermixIdentityCaMigration", () => {
  it("does nothing before the plugin adopted the table", async () => {
    setup({ pluginTable: false });
    expect(await runTermixIdentityCaMigration()).toBe(0);
  });

  it("reseals a data-key CA with the installation key", async () => {
    setup({ pluginTable: true });
    addCa(1, "alice");

    expect(await runTermixIdentityCaMigration()).toBe(1);
    expect(keyOf(1)).toBe(`sysenc:v1:${PEM}`);
  });

  it("changes nothing on a second run", async () => {
    setup({ pluginTable: true });
    addCa(1, "alice");
    await runTermixIdentityCaMigration();
    const first = keyOf(1);

    expect(await runTermixIdentityCaMigration()).toBe(0);
    expect(keyOf(1)).toBe(first);
  });

  it("leaves a row whose owner's key is not open for the next run", async () => {
    setup({ pluginTable: true });
    addCa(1, "alice");
    addCa(2, "bob", false);
    const locked = keyOf(2);

    expect(await runTermixIdentityCaMigration()).toBe(1);
    expect(keyOf(2)).toBe(locked);
  });
});
