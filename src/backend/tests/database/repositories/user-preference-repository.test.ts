import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { UserPreferenceRepository } from "../../../database/repositories/user-preference-repository.js";

describe("UserPreferenceRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<UserPreferenceRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash');
    `);

    return new UserPreferenceRepository(context, onWrite);
  }

  it("finds, creates, and updates preferences by user id", async () => {
    const repo = await createRepository();

    expect(await repo.findByUserId("user-1")).toBeNull();

    const created = await repo.upsert("user-1", {
      reopenTabsOnLogin: true,
      theme: "dark",
      storageMode: "local",
      commandAutocomplete: true,
    });
    expect(created).toMatchObject({
      userId: "user-1",
      reopenTabsOnLogin: true,
      theme: "dark",
      storageMode: "local",
      commandAutocomplete: true,
    });

    const updated = await repo.upsert("user-1", {
      theme: "light",
      commandAutocomplete: false,
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
    expect(updated).toMatchObject({
      userId: "user-1",
      reopenTabsOnLogin: true,
      theme: "light",
      storageMode: "local",
      commandAutocomplete: false,
    });
  });

  it("deletes preferences by user id only when rows exist", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.upsert("user-1", { theme: "dark" });
    expect(writeCount).toBe(1);

    expect(await repo.deleteByUserId("missing")).toBe(0);
    expect(writeCount).toBe(1);

    expect(await repo.deleteByUserId("user-1")).toBe(1);
    expect(writeCount).toBe(2);
    expect(await repo.findByUserId("user-1")).toBeNull();
  });
});
