import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { SyncTombstoneRepository } from "../../../database/repositories/sync-tombstone-repository.js";

describe("SyncTombstoneRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<SyncTombstoneRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );

      CREATE TABLE sync_tombstones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        sync_id TEXT NOT NULL,
        deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
    `);

    return new SyncTombstoneRepository(context, onWrite);
  }

  it("records a tombstone and lists it back for the owning user", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.record("user-1", "hosts", "sync-abc");
    expect(writeCount).toBe(1);

    const rows = await repo.listSince("user-1", "hosts", null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "user-1",
      entityType: "hosts",
      syncId: "sync-abc",
    });
  });

  it("does not record a tombstone for an empty syncId", async () => {
    const repo = await createRepository();
    await repo.record("user-1", "hosts", "");
    const rows = await repo.listSince("user-1", "hosts", null);
    expect(rows).toHaveLength(0);
  });

  it("recordMany writes multiple tombstones and filters out falsy ids", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.recordMany("user-1", "hosts", ["a", "", "b", "c"]);
    expect(writeCount).toBe(1);

    const rows = await repo.listSince("user-1", "hosts", null);
    expect(rows.map((r) => r.syncId).sort()).toEqual(["a", "b", "c"]);
  });

  it("recordMany is a no-op when given no syncIds", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.recordMany("user-1", "hosts", []);
    expect(writeCount).toBe(0);
  });

  it("scopes listSince by userId and entityType", async () => {
    const repo = await createRepository();
    await repo.record("user-1", "hosts", "sync-1");
    await repo.record("user-1", "snippets", "sync-2");
    await repo.record("user-2", "hosts", "sync-3");

    const rows = await repo.listSince("user-1", "hosts", null);
    expect(rows).toHaveLength(1);
    expect(rows[0].syncId).toBe("sync-1");
  });

  it("filters listSince by the since timestamp", async () => {
    const adapterLocal = new TestSqliteDatabase();
    adapter = adapterLocal;
    const context = await adapterLocal.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );

      CREATE TABLE sync_tombstones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        sync_id TEXT NOT NULL,
        deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash');

      INSERT INTO sync_tombstones (user_id, entity_type, sync_id, deleted_at)
      VALUES
        ('user-1', 'hosts', 'old', '2026-01-01T00:00:00.000Z'),
        ('user-1', 'hosts', 'new', '2026-06-01T00:00:00.000Z');
    `);
    const repo = new SyncTombstoneRepository(context);

    const rows = await repo.listSince(
      "user-1",
      "hosts",
      "2026-03-01T00:00:00.000Z",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].syncId).toBe("new");
  });
});
