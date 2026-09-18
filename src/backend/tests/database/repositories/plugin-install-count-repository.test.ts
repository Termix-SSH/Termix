import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { PluginInstallCountRepository } from "../../../database/repositories/plugin-install-count-repository.js";

describe("PluginInstallCountRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<PluginInstallCountRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    return new PluginInstallCountRepository(context, onWrite);
  }

  it("inserts a count on first upsert", async () => {
    let writes = 0;
    const repo = await createRepository(() => {
      writes += 1;
    });

    const created = await repo.upsert({
      pluginId: "plugin-a",
      registryId: "registry-official",
      count: 42,
      source: "github-releases",
    });

    expect(created).toMatchObject({
      pluginId: "plugin-a",
      registryId: "registry-official",
      count: 42,
      source: "github-releases",
    });
    expect(writes).toBe(1);
  });

  it("updates the existing row on a repeat upsert for the same plugin/registry pair", async () => {
    let writes = 0;
    const repo = await createRepository(() => {
      writes += 1;
    });

    const first = await repo.upsert({
      pluginId: "plugin-a",
      registryId: "registry-official",
      count: 10,
    });

    const second = await repo.upsert({
      pluginId: "plugin-a",
      registryId: "registry-official",
      count: 25,
    });

    expect(second.id).toBe(first.id);
    expect(second.count).toBe(25);
    expect(writes).toBe(2);

    const rows = await repo.listByPlugin("plugin-a");
    expect(rows).toHaveLength(1);
  });

  it("keeps counts from different registries for the same plugin separate", async () => {
    const repo = await createRepository();

    await repo.upsert({
      pluginId: "plugin-a",
      registryId: "registry-official",
      count: 10,
    });
    await repo.upsert({
      pluginId: "plugin-a",
      registryId: "registry-community",
      count: 5,
    });

    const rows = await repo.listByPlugin("plugin-a");
    expect(rows.map((r) => r.registryId).sort()).toEqual([
      "registry-community",
      "registry-official",
    ]);

    expect(
      await repo.findByPluginAndRegistry("plugin-a", "registry-official"),
    ).toMatchObject({ count: 10 });
    expect(
      await repo.findByPluginAndRegistry("plugin-a", "missing-registry"),
    ).toBeNull();
  });

  it("deletes all counts for a plugin", async () => {
    const repo = await createRepository();

    await repo.upsert({
      pluginId: "plugin-a",
      registryId: "registry-official",
      count: 10,
    });
    await repo.upsert({
      pluginId: "plugin-a",
      registryId: "registry-community",
      count: 5,
    });

    expect(await repo.deleteByPlugin("plugin-a")).toBe(2);
    expect(await repo.listByPlugin("plugin-a")).toEqual([]);
    expect(await repo.deleteByPlugin("plugin-a")).toBe(0);
  });
});
