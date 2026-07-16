import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { HomepageLayoutRepository } from "./homepage-layout-repository.js";

describe("HomepageLayoutRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<HomepageLayoutRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_oidc INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE homepage_layouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL UNIQUE,
        layout TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
    `);

    return new HomepageLayoutRepository(context, onWrite);
  }

  it("finds, creates, and updates a layout by user id", async () => {
    const repo = await createRepository();

    expect(await repo.findByUserId("user-1")).toBeNull();

    const created = await repo.upsertForUser(
      "user-1",
      JSON.stringify({ entries: [{ id: "w1" }], zoom: 1 }),
      "2026-06-27T00:00:00.000Z",
    );
    expect(created).toMatchObject({
      userId: "user-1",
      layout: '{"entries":[{"id":"w1"}],"zoom":1}',
      updatedAt: "2026-06-27T00:00:00.000Z",
    });

    const updated = await repo.upsertForUser(
      "user-1",
      JSON.stringify({ entries: [], zoom: 1.25 }),
      "2026-06-27T01:00:00.000Z",
    );
    expect(updated).toMatchObject({
      id: created.id,
      userId: "user-1",
      layout: '{"entries":[],"zoom":1.25}',
      updatedAt: "2026-06-27T01:00:00.000Z",
    });
  });

  it("triggers writes after create and update", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.upsertForUser("user-1", "{}");
    await repo.upsertForUser("user-1", '{"zoom":2}');

    expect(writeCount).toBe(2);
  });

  it("deletes a layout for a user", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.upsertForUser("user-1", '{"zoom":1}');
    await repo.upsertForUser("user-2", '{"zoom":2}');

    await expect(repo.deleteByUserId("user-1")).resolves.toBe(1);
    await expect(repo.deleteByUserId("missing")).resolves.toBe(0);

    expect(await repo.findByUserId("user-1")).toBeNull();
    expect((await repo.findByUserId("user-2"))?.layout).toBe('{"zoom":2}');
    expect(writeCount).toBe(3);
  });
});
