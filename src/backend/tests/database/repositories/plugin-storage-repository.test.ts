import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { PluginStorageRepository } from "../../../database/repositories/plugin-storage-repository.js";

describe("PluginStorageRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<PluginStorageRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO plugins (id, name, version, manifest_json)
      VALUES ('plugin-a', 'Plugin A', '1.0.0', '{}');
      INSERT INTO plugins (id, name, version, manifest_json)
      VALUES ('plugin-b', 'Plugin B', '1.0.0', '{}');
    `);

    return new PluginStorageRepository(context, onWrite);
  }

  it("round-trips a value", async () => {
    const repo = await createRepository();

    expect(await repo.get("plugin-a", "missing")).toBeNull();

    await repo.set("plugin-a", "token", '{"v":1}');
    expect(await repo.get("plugin-a", "token")).toBe('{"v":1}');
  });

  it("overwrites rather than duplicating an existing key", async () => {
    const repo = await createRepository();

    await repo.set("plugin-a", "counter", "1");
    await repo.set("plugin-a", "counter", "2");

    expect(await repo.get("plugin-a", "counter")).toBe("2");
    expect(await repo.listKeys("plugin-a")).toEqual(["counter"]);
  });

  it("keeps each plugin's keys separate", async () => {
    const repo = await createRepository();

    await repo.set("plugin-a", "shared-key", "from-a");
    await repo.set("plugin-b", "shared-key", "from-b");

    expect(await repo.get("plugin-a", "shared-key")).toBe("from-a");
    expect(await repo.get("plugin-b", "shared-key")).toBe("from-b");
  });

  it("deletes a key and reports whether a row changed", async () => {
    let writes = 0;
    const repo = await createRepository(() => {
      writes += 1;
    });

    await repo.set("plugin-a", "k", "v");
    expect(writes).toBe(1);

    expect(await repo.delete("plugin-a", "nope")).toBe(false);
    expect(writes).toBe(1);

    expect(await repo.delete("plugin-a", "k")).toBe(true);
    expect(writes).toBe(2);
    expect(await repo.get("plugin-a", "k")).toBeNull();
  });

  it("deletes everything belonging to one plugin", async () => {
    const repo = await createRepository();

    await repo.set("plugin-a", "one", "1");
    await repo.set("plugin-a", "two", "2");
    await repo.set("plugin-b", "keep", "3");

    expect(await repo.deleteByPlugin("plugin-a")).toBe(2);
    expect(await repo.listKeys("plugin-a")).toEqual([]);
    expect(await repo.listKeys("plugin-b")).toEqual(["keep"]);
  });

  it("drops rows when the owning plugin is removed", async () => {
    const repo = await createRepository();
    await repo.set("plugin-a", "k", "v");

    await adapter!.exec(`DELETE FROM plugins WHERE id = 'plugin-a';`);

    expect(await repo.listKeys("plugin-a")).toEqual([]);
  });
});
