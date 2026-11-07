import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ drizzle: null as unknown }));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentRepositoryContext: () => ({ drizzle: state.drizzle }),
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

const layouts = sqliteTable("layouts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  hostId: integer("host_id").notNull(),
  layout: text("layout").notNull(),
  syncId: text("sync_id"),
});

let sqlite: Database.Database;

function entity(matchOn?: string[]): RegisteredSyncEntity {
  return {
    type: "layouts",
    table: layouts,
    owner: "test",
    order: 70,
    userColumn: "userId",
    readOnlyFields: [],
    encryptedFields: [],
    matchOn,
  };
}

const resolvers = {
  resolveSyncId: async () => null,
  resolveId: async () => null,
};

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE layouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    host_id INTEGER NOT NULL,
    layout TEXT NOT NULL,
    sync_id TEXT,
    UNIQUE (user_id, host_id)
  )`);
  sqlite
    .prepare(
      "INSERT INTO layouts (user_id, host_id, layout, sync_id) VALUES (?, ?, ?, ?)",
    )
    .run("u1", 7, "local", "local-sync");
  state.drizzle = drizzle(sqlite);
});

describe("writeWireRow matchOn", () => {
  it("takes over the row with the same key instead of inserting", async () => {
    const result = await writeWireRow(
      entity(["hostId"]),
      "u1",
      { syncId: "remote-sync", hostId: 7, layout: "remote" },
      resolvers,
    );

    expect(result.created).toBe(false);
    expect(sqlite.prepare("SELECT * FROM layouts").all()).toEqual([
      {
        id: 1,
        user_id: "u1",
        host_id: 7,
        layout: "remote",
        sync_id: "remote-sync",
      },
    ]);
  });

  it("only matches rows of the same user", async () => {
    const result = await writeWireRow(
      entity(["hostId"]),
      "u2",
      { syncId: "remote-sync", hostId: 7, layout: "remote" },
      resolvers,
    );
    expect(result.created).toBe(true);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM layouts").get()).toEqual({
      n: 2,
    });
  });

  it("still fails on the unique key without matchOn", async () => {
    await expect(
      writeWireRow(
        entity(),
        "u1",
        { syncId: "remote-sync", hostId: 7, layout: "remote" },
        resolvers,
      ),
    ).rejects.toThrow();
  });
});
