import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  drizzle: null as unknown,
  recorded: new Set<string>(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentRepositoryContext: () => ({ drizzle: state.drizzle }),
}));
vi.mock("../../sync/records.js", () => ({
  getRecord: async (_userId: string, _type: string, syncId: string) =>
    state.recorded.has(syncId) ? { syncId } : null,
}));
vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: { getUserDataKey: () => null },
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
import type { RegisteredSyncEntity } from "../../plugins/sync-registry.js";

const machines = sqliteTable("machines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  ip: text("ip"),
  note: text("note"),
  localOnly: integer("local_only", { mode: "boolean" })
    .notNull()
    .default(false),
  syncId: text("sync_id"),
});

let sqlite: Database.Database;

const entity: RegisteredSyncEntity = {
  type: "machines",
  table: machines,
  owner: "test",
  order: 50,
  userColumn: "userId",
  readOnlyFields: ["localOnly"],
  encryptedFields: [],
  shouldSync: (row) => !row.localOnly,
  matchUnsynced: ["name", "ip"],
};

const resolvers = {
  resolveSyncId: async () => null,
  resolveId: async () => null,
};

function insert(name: string, syncId: string, localOnly = 0): void {
  sqlite
    .prepare(
      "INSERT INTO machines (user_id, name, ip, note, local_only, sync_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run("u1", name, "10.0.0.1", "local", localOnly, syncId);
}

function rows(): unknown[] {
  return sqlite
    .prepare("SELECT name, note, sync_id AS syncId FROM machines ORDER BY id")
    .all();
}

const inbound = (syncId: string) => ({
  syncId,
  name: "web",
  ip: "10.0.0.1",
  note: "server",
});

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE machines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    ip TEXT,
    note TEXT,
    local_only INTEGER NOT NULL DEFAULT 0,
    sync_id TEXT
  )`);
  state.drizzle = drizzle(sqlite);
  state.recorded.clear();
});

describe("writeWireRow matchUnsynced", () => {
  it("takes over a local row that never synced", async () => {
    insert("web", "local-1");
    const result = await writeWireRow(
      entity,
      "u1",
      inbound("server-1"),
      resolvers,
    );
    expect(result.created).toBe(false);
    expect(rows()).toEqual([
      { name: "web", note: "server", syncId: "server-1" },
    ]);
  });

  it("adds a row beside one that already synced", async () => {
    insert("web", "local-1");
    state.recorded.add("local-1");
    await writeWireRow(entity, "u1", inbound("server-1"), resolvers);
    expect(rows()).toHaveLength(2);
  });

  it("never takes over a row kept on this device only", async () => {
    insert("web", "local-1", 1);
    await writeWireRow(entity, "u1", inbound("server-1"), resolvers);
    expect(rows()).toEqual([
      { name: "web", note: "local", syncId: "local-1" },
      { name: "web", note: "server", syncId: "server-1" },
    ]);
  });

  it("pairs each of two same rows from the server with its own local row", async () => {
    insert("web", "local-1");
    insert("web", "local-2");
    await writeWireRow(entity, "u1", inbound("server-1"), resolvers);
    state.recorded.add("server-1");
    await writeWireRow(entity, "u1", inbound("server-2"), resolvers);
    expect(rows()).toEqual([
      { name: "web", note: "server", syncId: "server-1" },
      { name: "web", note: "server", syncId: "server-2" },
    ]);
  });
});
