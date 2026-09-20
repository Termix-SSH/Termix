import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { PluginRepository } from "../../../database/repositories/plugin-repository.js";

describe("PluginRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<PluginRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    return new PluginRepository(context, onWrite);
  }

  it("creates, finds, and lists plugins", async () => {
    const repo = await createRepository();

    await repo.create({
      id: "plugin-a",
      name: "Plugin A",
      version: "1.0.0",
      manifestJson: "{}",
    });
    await repo.create({
      id: "plugin-b",
      name: "Plugin B",
      version: "2.0.0",
      tier: "bundled",
      source: "official",
      state: "enabled",
      manifestJson: "{}",
    });

    const found = await repo.findById("plugin-a");
    expect(found).toMatchObject({
      id: "plugin-a",
      name: "Plugin A",
      version: "1.0.0",
      tier: "available",
      source: "community",
      state: "disabled",
      autoUpdate: false,
    });

    const all = await repo.listAll();
    expect(all.map((p) => p.id).sort()).toEqual(["plugin-a", "plugin-b"]);
    expect(await repo.findById("missing")).toBeNull();
  });

  it("updates only the provided fields", async () => {
    let writes = 0;
    const repo = await createRepository(() => {
      writes += 1;
    });

    await repo.create({
      id: "plugin-a",
      name: "Plugin A",
      version: "1.0.0",
      manifestJson: "{}",
    });
    expect(writes).toBe(1);

    const updated = await repo.update("plugin-a", {
      version: "1.1.0",
      state: "enabled",
    });

    expect(updated).toMatchObject({
      id: "plugin-a",
      name: "Plugin A",
      version: "1.1.0",
      state: "enabled",
    });
    expect(writes).toBe(2);

    expect(await repo.update("missing", { state: "enabled" })).toBeNull();
    expect(writes).toBe(2);
  });

  it("deletes a plugin and reports whether a row was removed", async () => {
    let writes = 0;
    const repo = await createRepository(() => {
      writes += 1;
    });

    await repo.create({
      id: "plugin-a",
      name: "Plugin A",
      version: "1.0.0",
      manifestJson: "{}",
    });
    expect(writes).toBe(1);

    expect(await repo.delete("missing")).toBe(false);
    expect(writes).toBe(1);

    expect(await repo.delete("plugin-a")).toBe(true);
    expect(writes).toBe(2);
    expect(await repo.findById("plugin-a")).toBeNull();
  });

  it("deletes all plugins and returns the count removed", async () => {
    const repo = await createRepository();

    await repo.create({
      id: "plugin-a",
      name: "Plugin A",
      version: "1.0.0",
      manifestJson: "{}",
    });
    await repo.create({
      id: "plugin-b",
      name: "Plugin B",
      version: "1.0.0",
      manifestJson: "{}",
    });

    expect(await repo.deleteAll()).toBe(2);
    expect(await repo.listAll()).toEqual([]);
    expect(await repo.deleteAll()).toBe(0);
  });
});
