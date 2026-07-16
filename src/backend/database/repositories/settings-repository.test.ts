import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { SettingsRepository } from "./settings-repository.js";

describe("SettingsRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(): Promise<SettingsRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    return new SettingsRepository(context);
  }

  it("creates and updates settings", async () => {
    const repo = await createRepository();

    await repo.set("allow_registration", "true");
    expect(await repo.get("allow_registration")).toBe("true");

    await repo.set("allow_registration", "false");
    expect(await repo.get("allow_registration")).toBe("false");
  });

  it("lists and upserts settings", async () => {
    const repo = await createRepository();

    await repo.upsert("theme", "dark");
    await repo.upsert("allow_registration", "true");
    await repo.upsert("theme", "light");

    expect(await repo.get("theme")).toBe("light");
    expect(await repo.listAll()).toEqual(
      expect.arrayContaining([
        { key: "theme", value: "light" },
        { key: "allow_registration", value: "true" },
      ]),
    );
  });

  it("returns null or fallback when setting is missing", async () => {
    const repo = await createRepository();

    expect(await repo.get("missing")).toBeNull();
    expect(await repo.getBoolean("missing", true)).toBe(true);
  });

  it("reads boolean settings", async () => {
    const repo = await createRepository();

    await repo.set("enabled", "1");
    await repo.set("disabled", "false");

    expect(await repo.getBoolean("enabled")).toBe(true);
    expect(await repo.getBoolean("disabled", true)).toBe(false);
  });

  it("deletes settings", async () => {
    const repo = await createRepository();

    await repo.set("theme", "dark");
    await repo.delete("theme");

    expect(await repo.get("theme")).toBeNull();
  });

  it("deletes settings by SQL LIKE pattern", async () => {
    const repo = await createRepository();

    await repo.set("user_kek_salt_user-1", "salt");
    await repo.set("user_encrypted_dek_user-1", "dek");
    await repo.set("user_kek_salt_user-2", "other");

    expect(await repo.deleteLike("user_%_user-1")).toBe(2);
    expect(await repo.get("user_kek_salt_user-1")).toBeNull();
    expect(await repo.get("user_encrypted_dek_user-1")).toBeNull();
    expect(await repo.get("user_kek_salt_user-2")).toBe("other");
  });
});
