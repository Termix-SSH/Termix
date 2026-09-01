import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { UiPreferenceRepository } from "../../../database/repositories/ui-preference-repository.js";

describe("UiPreferenceRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<UiPreferenceRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ui_preferences (user_id, data, updated_at)
      VALUES (
        'user-1',
        '{"version":1,"preset":"balanced","overrides":{}}',
        '2026-01-01T00:00:00.000Z'
      );
    `);
    return new UiPreferenceRepository(context, onWrite);
  }

  it("finds saved UI preferences by user id", async () => {
    const repository = await createRepository();

    const existing = await repository.findByUserId("user-1");
    expect(existing?.data).toBe(
      '{"version":1,"preset":"balanced","overrides":{}}',
    );

    expect(await repository.findByUserId("user-2")).toBeNull();
  });

  it("updates and inserts preferences with write notifications", async () => {
    let writeCount = 0;
    const repository = await createRepository(() => {
      writeCount += 1;
    });

    const updated = await repository.upsert(
      "user-1",
      '{"version":1,"preset":"simple","overrides":{}}',
      "2026-02-01T00:00:00.000Z",
    );
    expect(updated).toMatchObject({
      userId: "user-1",
      data: '{"version":1,"preset":"simple","overrides":{}}',
      updatedAt: "2026-02-01T00:00:00.000Z",
    });

    const created = await repository.upsert(
      "user-2",
      '{"version":1,"preset":"advanced","overrides":{}}',
      "2026-03-01T00:00:00.000Z",
    );
    expect(created).toMatchObject({
      userId: "user-2",
      data: '{"version":1,"preset":"advanced","overrides":{}}',
      updatedAt: "2026-03-01T00:00:00.000Z",
    });

    expect(writeCount).toBe(2);
  });

  it("deletes preferences for a user", async () => {
    let writeCount = 0;
    const repository = await createRepository(() => {
      writeCount += 1;
    });

    await repository.upsert("user-2", '{"version":1,"preset":"simple"}');

    await expect(repository.deleteByUserId("user-1")).resolves.toBe(1);
    await expect(repository.deleteByUserId("missing")).resolves.toBe(0);

    expect(await repository.findByUserId("user-1")).toBeNull();
    expect((await repository.findByUserId("user-2"))?.data).toBe(
      '{"version":1,"preset":"simple"}',
    );
    expect(writeCount).toBe(2);
  });
});
