import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { SettingsRepository } from "./settings-repository.js";

describe("SettingsRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(): Promise<SettingsRepository> {
    adapter = new SqliteDatabaseAdapter({
      dialect: "sqlite",
      url: ":memory:",
      sqlitePath: ":memory:",
    });
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
});
