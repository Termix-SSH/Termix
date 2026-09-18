import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { PluginRegistryRepository } from "../../../database/repositories/plugin-registry-repository.js";

describe("PluginRegistryRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<PluginRegistryRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    return new PluginRegistryRepository(context, onWrite);
  }

  it("creates, finds, and lists registries", async () => {
    const repo = await createRepository();

    await repo.create({
      id: "registry-official",
      name: "Official Registry",
      url: "https://plugins.termix.site/index.json",
      kind: "official",
    });
    await repo.create({
      id: "registry-custom",
      name: "Custom Registry",
      url: "https://example.com/index.json",
    });

    const found = await repo.findById("registry-official");
    expect(found).toMatchObject({
      id: "registry-official",
      name: "Official Registry",
      kind: "official",
      enabled: true,
    });

    const custom = await repo.findById("registry-custom");
    expect(custom).toMatchObject({ kind: "community", enabled: true });

    const all = await repo.listAll();
    expect(all.map((r) => r.id).sort()).toEqual([
      "registry-custom",
      "registry-official",
    ]);
    expect(await repo.findById("missing")).toBeNull();
  });

  it("updates only the provided fields", async () => {
    let writes = 0;
    const repo = await createRepository(() => {
      writes += 1;
    });

    await repo.create({
      id: "registry-custom",
      name: "Custom Registry",
      url: "https://example.com/index.json",
    });
    expect(writes).toBe(1);

    const updated = await repo.update("registry-custom", {
      enabled: false,
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
      lastIndexHash: "abc123",
    });

    expect(updated).toMatchObject({
      id: "registry-custom",
      name: "Custom Registry",
      enabled: false,
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
      lastIndexHash: "abc123",
    });
    expect(writes).toBe(2);

    expect(await repo.update("missing", { enabled: false })).toBeNull();
    expect(writes).toBe(2);
  });

  it("deletes a registry and reports whether a row was removed", async () => {
    let writes = 0;
    const repo = await createRepository(() => {
      writes += 1;
    });

    await repo.create({
      id: "registry-custom",
      name: "Custom Registry",
      url: "https://example.com/index.json",
    });
    expect(writes).toBe(1);

    expect(await repo.delete("missing")).toBe(false);
    expect(writes).toBe(1);

    expect(await repo.delete("registry-custom")).toBe(true);
    expect(writes).toBe(2);
    expect(await repo.findById("registry-custom")).toBeNull();
  });

  it("deletes all registries and returns the count removed", async () => {
    const repo = await createRepository();

    await repo.create({
      id: "registry-a",
      name: "A",
      url: "https://a.example.com/index.json",
    });
    await repo.create({
      id: "registry-b",
      name: "B",
      url: "https://b.example.com/index.json",
    });

    expect(await repo.deleteAll()).toBe(2);
    expect(await repo.listAll()).toEqual([]);
    expect(await repo.deleteAll()).toBe(0);
  });
});
