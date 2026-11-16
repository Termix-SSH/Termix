import crypto from "crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  drizzle: null as unknown,
  key: null as Buffer | null,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentRepositoryContext: () => ({ drizzle: state.drizzle }),
}));
vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: { getUserDataKey: () => state.key },
}));
vi.mock("../../utils/system-crypto.js", () => ({
  SystemCrypto: { getInstance: () => ({ getEncryptionKey: async () => "k" }) },
}));
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { triggerSave: vi.fn() },
}));
vi.mock("../../utils/logger.js", () => ({
  syncLogger: { warn: vi.fn(), error: vi.fn() },
}));

import { writeWireRow } from "../../sync/store.js";
import { decryptFields } from "../../sync/wire.js";
import { FieldCrypto } from "../../utils/field-crypto.js";
import type { RegisteredSyncEntity } from "../../plugins/sync-registry.js";

const vaults = sqliteTable("vaults", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  token: text("token").notNull(),
  syncId: text("sync_id"),
});

const entity: RegisteredSyncEntity = {
  type: "vaults",
  table: vaults,
  owner: "test",
  order: 70,
  userColumn: "userId",
  readOnlyFields: [],
  encryptedFields: ["token"],
};
const resolvers = {
  resolveSyncId: async () => null,
  resolveId: async () => null,
};

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE vaults (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token TEXT NOT NULL,
    sync_id TEXT
  )`);
  state.drizzle = drizzle(sqlite);
  state.key = crypto.randomBytes(32);
});

type Row = { id: number; token: string; sync_id: string };
const rows = () => sqlite.prepare("SELECT * FROM vaults").all() as Row[];

describe("synced secret fields", () => {
  it("seals a new row's secrets for the row id it gets", async () => {
    await writeWireRow(
      entity,
      "u1",
      { syncId: "s1", name: "a", token: "t-1" },
      resolvers,
    );
    const [row] = rows();
    expect(FieldCrypto.sealedRecordId(row.token)).toBe(String(row.id));
    expect(
      decryptFields(entity, { ...row, syncId: row.sync_id }, state.key).token,
    ).toBe("t-1");
  });

  it("still opens a row sealed for its sync id, but nowhere else", async () => {
    const old = FieldCrypto.encryptField(
      "t-old",
      state.key!,
      "sync-s9",
      "token",
    );
    expect(
      decryptFields(entity, { id: 4, syncId: "s9", token: old }, state.key)
        .token,
    ).toBe("t-old");
    expect(() =>
      decryptFields(entity, { id: 5, syncId: "s10", token: old }, state.key),
    ).toThrow(/different record/);
  });
});
