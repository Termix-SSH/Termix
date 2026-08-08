import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { HostSidebarPreferenceRepository } from "../../../database/repositories/host-sidebar-preference-repository.js";

describe("HostSidebarPreferenceRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<HostSidebarPreferenceRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO host_sidebar_preferences (user_id, data, updated_at)
      VALUES (
        'user-1',
        '{"version":1,"sort":{"key":"default","pinnedFirst":false}}',
        '2026-01-01T00:00:00.000Z'
      );
    `);

    return new HostSidebarPreferenceRepository(context, onWrite);
  }

  it("finds a saved preferences row by user id", async () => {
    const repo = await createRepository();

    const existing = await repo.findByUserId("user-1");
    expect(existing?.data).toBe(
      '{"version":1,"sort":{"key":"default","pinnedFirst":false}}',
    );
    expect(await repo.findByUserId("user-2")).toBeNull();
  });

  it("updates and inserts preferences with write notifications", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const updated = await repo.upsert(
      "user-1",
      '{"version":1,"groupKey":"tag"}',
      "2026-02-01T00:00:00.000Z",
    );
    expect(updated).toMatchObject({
      userId: "user-1",
      data: '{"version":1,"groupKey":"tag"}',
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    const created = await repo.upsert(
      "user-2",
      '{"version":1,"groupKey":"folder"}',
      "2026-03-01T00:00:00.000Z",
    );
    expect(created).toMatchObject({
      userId: "user-2",
      data: '{"version":1,"groupKey":"folder"}',
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(writeCount).toBe(2);
  });

  it("deletes preferences for a user", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.upsert("user-2", '{"version":1}');

    await expect(repo.deleteByUserId("user-1")).resolves.toBe(1);
    await expect(repo.deleteByUserId("missing")).resolves.toBe(0);

    expect(await repo.findByUserId("user-1")).toBeNull();
    expect((await repo.findByUserId("user-2"))?.data).toBe('{"version":1}');
    expect(writeCount).toBe(2);
  });
});
