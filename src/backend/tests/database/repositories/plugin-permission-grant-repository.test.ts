import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { PluginPermissionGrantRepository } from "../../../database/repositories/plugin-permission-grant-repository.js";

describe("PluginPermissionGrantRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<PluginPermissionGrantRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash');
      INSERT INTO plugins (id, name, version, manifest_json)
      VALUES ('plugin-a', 'Plugin A', '1.0.0', '{}');
    `);

    return new PluginPermissionGrantRepository(context, onWrite);
  }

  it("grants and lists capabilities for a plugin", async () => {
    const repo = await createRepository();

    await repo.grant({
      pluginId: "plugin-a",
      capability: "filesystem:read",
      grantedBy: "user-1",
    });
    await repo.grant({
      pluginId: "plugin-a",
      capability: "network:fetch",
      grantedBy: "user-1",
    });

    const grants = await repo.listByPlugin("plugin-a");
    expect(grants.map((g) => g.capability).sort()).toEqual([
      "filesystem:read",
      "network:fetch",
    ]);

    const found = await repo.findGrant("plugin-a", "filesystem:read");
    expect(found).toMatchObject({
      pluginId: "plugin-a",
      capability: "filesystem:read",
      grantedBy: "user-1",
    });
    expect(await repo.findGrant("plugin-a", "missing:cap")).toBeNull();
  });

  it("revokes a capability and only writes when a row changed", async () => {
    let writes = 0;
    const repo = await createRepository(() => {
      writes += 1;
    });

    await repo.grant({
      pluginId: "plugin-a",
      capability: "filesystem:read",
      grantedBy: "user-1",
    });
    expect(writes).toBe(1);

    expect(await repo.revoke("plugin-a", "missing:cap")).toBe(false);
    expect(writes).toBe(1);

    expect(await repo.revoke("plugin-a", "filesystem:read")).toBe(true);
    expect(writes).toBe(2);
    expect(await repo.listByPlugin("plugin-a")).toEqual([]);
  });

  it("deletes all grants for a plugin", async () => {
    const repo = await createRepository();

    await repo.grant({
      pluginId: "plugin-a",
      capability: "filesystem:read",
      grantedBy: "user-1",
    });
    await repo.grant({
      pluginId: "plugin-a",
      capability: "network:fetch",
      grantedBy: "user-1",
    });

    expect(await repo.deleteByPlugin("plugin-a")).toBe(2);
    expect(await repo.listByPlugin("plugin-a")).toEqual([]);
    expect(await repo.deleteByPlugin("plugin-a")).toBe(0);
  });
});
