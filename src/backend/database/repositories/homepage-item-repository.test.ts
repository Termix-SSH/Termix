import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { HomepageItemRepository } from "./homepage-item-repository.js";

describe("HomepageItemRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<HomepageItemRepository> {
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

      CREATE TABLE homepage_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        type_id TEXT NOT NULL,
        title TEXT,
        config TEXT NOT NULL DEFAULT '{}',
        folder_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
    `);

    return new HomepageItemRepository(context, onWrite);
  }

  it("creates and lists homepage items by id", async () => {
    const repo = await createRepository();

    const first = await repo.createForUser(
      "user-1",
      { typeId: "clock", title: "Clock", config: "{}" },
      "2026-06-27T00:00:00.000Z",
    );
    const second = await repo.createForUser("user-1", {
      typeId: "terminal",
      title: null,
      config: '{"hostId":1}',
    });
    await repo.createForUser("user-2", {
      typeId: "other",
      title: "Other",
      config: "{}",
    });

    expect(first).toMatchObject({
      userId: "user-1",
      typeId: "clock",
      title: "Clock",
      config: "{}",
      createdAt: "2026-06-27T00:00:00.000Z",
    });
    expect((await repo.listByUserId("user-1")).map((item) => item.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("finds, updates, and deletes user-owned homepage items", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const item = await repo.createForUser("user-1", {
      typeId: "clock",
      title: "Clock",
      config: "{}",
    });
    expect(writeCount).toBe(1);

    expect(await repo.findByIdForUser("user-2", item.id)).toBeNull();
    const updated = await repo.updateForUser(
      "user-1",
      item.id,
      { title: "Clock renamed", config: '{"timezone":"UTC"}' },
      "2026-06-27T01:00:00.000Z",
    );
    expect(updated).toMatchObject({
      id: item.id,
      title: "Clock renamed",
      config: '{"timezone":"UTC"}',
      updatedAt: "2026-06-27T01:00:00.000Z",
    });
    expect(writeCount).toBe(2);

    expect(
      await repo.updateForUser("user-2", item.id, { title: "Nope" }),
    ).toBeNull();
    expect(writeCount).toBe(2);

    expect(await repo.deleteForUser("user-2", item.id)).toBe(false);
    expect(await repo.deleteForUser("user-1", item.id)).toBe(true);
    expect(writeCount).toBe(3);
  });

  it("deletes all homepage items for a user", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.createForUser("user-1", {
      typeId: "clock",
      title: "Clock",
      config: "{}",
    });
    await repo.createForUser("user-1", {
      typeId: "terminal",
      title: "Terminal",
      config: "{}",
    });
    await repo.createForUser("user-2", {
      typeId: "other",
      title: "Other",
      config: "{}",
    });

    await expect(repo.deleteByUserId("user-1")).resolves.toBe(2);
    await expect(repo.deleteByUserId("missing")).resolves.toBe(0);

    expect(await repo.listByUserId("user-1")).toEqual([]);
    expect(
      (await repo.listByUserId("user-2")).map((item) => item.title),
    ).toEqual(["Other"]);
    expect(writeCount).toBe(4);
  });
});
