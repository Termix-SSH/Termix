import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { TransferRecentRepository } from "./transfer-recent-repository.js";

describe("TransferRecentRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<TransferRecentRepository> {
    adapter = new SqliteDatabaseAdapter({
      dialect: "sqlite",
      url: ":memory:",
      sqlitePath: ":memory:",
    });
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );

      CREATE TABLE hosts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL
      );

      CREATE TABLE transfer_recent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        source_host_id INTEGER NOT NULL,
        dest_host_id INTEGER NOT NULL,
        dest_path TEXT NOT NULL,
        dest_path_label TEXT NOT NULL,
        last_used TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO hosts (id, user_id, name)
      VALUES (1, 'user-1', 'source'), (2, 'user-1', 'dest-a'), (3, 'user-1', 'dest-b'), (4, 'user-2', 'other');
    `);

    return new TransferRecentRepository(context, onWrite);
  }

  it("upserts, lists, and prunes recent transfer destinations", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.upsertForDestination(
      "user-1",
      { sourceHostId: 1, destHostId: 2, destPath: "/var/www" },
      "2026-01-01T00:00:00.000Z",
    );
    await repo.upsertForDestination(
      "user-1",
      {
        sourceHostId: 1,
        destHostId: 3,
        destPath: "/opt/app",
        destPathLabel: "App",
      },
      "2026-01-02T00:00:00.000Z",
    );
    await repo.upsertForDestination(
      "user-1",
      { sourceHostId: 1, destHostId: 2, destPath: "/var/www" },
      "2026-01-03T00:00:00.000Z",
    );

    const recent = await repo.listBySourceHost("user-1", 1);

    expect(recent).toHaveLength(2);
    expect(recent.map((entry) => entry.destPath)).toEqual([
      "/var/www",
      "/opt/app",
    ]);
    expect(recent[0].lastUsed).toBe("2026-01-03T00:00:00.000Z");
    expect(recent[0].destPathLabel).toBe("/var/www");
    expect(writeCount).toBe(3);

    expect(await repo.pruneSourceHost("user-1", 1, 1)).toBe(1);
    expect(await repo.pruneSourceHost("user-1", 1, 1)).toBe(0);
    expect(await repo.listBySourceHost("user-1", 1)).toHaveLength(1);
    expect(writeCount).toBe(4);
  });

  it("deletes recent transfer destinations by user and host references", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.upsertForDestination("user-1", {
      sourceHostId: 1,
      destHostId: 2,
      destPath: "/one",
    });
    await repo.upsertForDestination("user-1", {
      sourceHostId: 2,
      destHostId: 3,
      destPath: "/two",
    });
    await repo.upsertForDestination("user-2", {
      sourceHostId: 4,
      destHostId: 1,
      destPath: "/other",
    });
    expect(writeCount).toBe(3);

    expect(await repo.deleteByHostId(1)).toBe(2);
    expect(await repo.deleteByHostId(1)).toBe(0);
    expect(writeCount).toBe(4);

    await repo.upsertForDestination("user-1", {
      sourceHostId: 1,
      destHostId: 2,
      destPath: "/three",
    });
    expect(await repo.deleteByHostIds([])).toBe(0);
    expect(await repo.deleteByHostIds([2, 3])).toBe(2);
    expect(writeCount).toBe(6);

    await repo.upsertForDestination("user-2", {
      sourceHostId: 4,
      destHostId: 1,
      destPath: "/last",
    });
    expect(await repo.deleteByUserId("user-2")).toBe(1);
    expect(await repo.deleteByUserId("user-2")).toBe(0);
    expect(writeCount).toBe(8);
  });
});
