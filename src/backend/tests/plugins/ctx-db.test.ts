/**
 * ctx.db and the kv caps.
 *
 * db:own was in the catalog from A1 but nothing checked it, which ARCHITECTURE
 * calls the anti-pattern outright. These assert that it is checked where the
 * privileged thing happens, and audited either way.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const grants = new Map<string, string[]>();
const auditEntries: Array<Record<string, unknown>> = [];
const kvStore = new Map<string, string>();

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async (pluginId: string) =>
      (grants.get(pluginId) ?? []).map((capability) => ({
        pluginId,
        capability,
      })),
  }),
  createCurrentPluginStorageRepository: () => ({
    get: async (pluginId: string, key: string) =>
      kvStore.get(`${pluginId}:${key}`) ?? null,
    set: async (pluginId: string, key: string, value: string) => {
      kvStore.set(`${pluginId}:${key}`, value);
    },
    delete: async (pluginId: string, key: string) =>
      kvStore.delete(`${pluginId}:${key}`),
    listKeys: async (pluginId: string) =>
      [...kvStore.keys()]
        .filter((key) => key.startsWith(`${pluginId}:`))
        .map((key) => key.slice(pluginId.length + 1)),
    countKeys: async (pluginId: string) =>
      [...kvStore.keys()].filter((key) => key.startsWith(`${pluginId}:`))
        .length,
  }),
}));

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    auditEntries.push(entry);
  },
}));

vi.mock("../../database/db/index.js", () => ({
  getDb: () => ({ marker: "db-handle" }),
}));

const saves: string[] = [];
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    forceSave: async (reason: string) => {
      saves.push(reason);
    },
  },
}));

vi.mock("../../database/db/schema.js", () => ({
  users: { marker: "users" },
  hosts: { marker: "hosts" },
}));

import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";
import { resetPluginData } from "../../plugins/data.js";
import {
  resetSyncRegistry,
  listEntityTypes,
} from "../../plugins/sync-registry.js";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

function manifestFor(pluginId: string, capabilities: string[]): PluginManifest {
  return {
    id: pluginId,
    name: pluginId,
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities,
  } as PluginManifest;
}

function contextFor(pluginId: string, capabilities: string[]) {
  const manifest = manifestFor(pluginId, capabilities);
  const handle = createPluginHandle(pluginId, { activate: () => {} });
  return { ctx: createPluginContext(manifest, handle), handle };
}

beforeEach(() => {
  grants.clear();
  auditEntries.length = 0;
  kvStore.clear();
  resetPluginData();
  resetSyncRegistry();
  invalidatePluginPermissionCache();
  delete process.env.PLUGIN_MAX_KV_KEYS;
  delete process.env.DATABASE_DIALECT;
  saves.length = 0;
});

describe("ctx.db.persist", () => {
  it("flushes SQLite to disk under the plugin's name", async () => {
    grants.set("demo", ["db:own"]);
    const { ctx } = contextFor("demo", ["db:own"]);

    await ctx.db.persist();

    expect(saves).toEqual(["plugin_demo_write"]);
    expect(ctx.db.dialect).toBe("sqlite");
  });

  it("does nothing on an engine that is already durable", async () => {
    process.env.DATABASE_DIALECT = "postgres";
    grants.set("demo", ["db:own"]);
    const { ctx } = contextFor("demo", ["db:own"]);

    await ctx.db.persist();

    expect(saves).toEqual([]);
    expect(ctx.db.dialect).toBe("postgres");
  });

  it("refuses without db:own", async () => {
    grants.set("demo", []);
    const { ctx } = contextFor("demo", []);

    await expect(ctx.db.persist()).rejects.toThrow(/db:own/);
    expect(saves).toEqual([]);
  });
});

describe("ctx.db capability", () => {
  it("refuses define without db:own", async () => {
    grants.set("demo", []);
    const { ctx } = contextFor("demo", []);

    await expect(
      ctx.db.define({ name: "thing", columns: {}, indexes: [] }),
    ).rejects.toThrow(/db:own/);
  });

  it("refuses define when granted but not declared", async () => {
    // A grant for something the manifest never declared is ignored, so
    // widening a plugin's reach always needs a manifest the user can see.
    grants.set("demo", ["db:own"]);
    const { ctx } = contextFor("demo", []);

    await expect(
      ctx.db.define({ name: "thing", columns: {}, indexes: [] }),
    ).rejects.toThrow(/db:own/);
  });

  it("refuses the client handle without db:own", async () => {
    grants.set("demo", []);
    const { ctx } = contextFor("demo", []);

    await expect(ctx.db.client()).rejects.toThrow(/db:own/);
  });

  it("allows define when declared and granted", async () => {
    grants.set("demo", ["db:own"]);
    const { ctx } = contextFor("demo", ["db:own"]);

    const table = await ctx.db.define({
      name: "thing",
      columns: { id: { type: "id", primaryKey: true, notNull: true } },
      indexes: [],
    });

    expect(table).toBeTruthy();
  });

  it("audits a refused call as well as an allowed one", async () => {
    grants.set("demo", []);
    const { ctx } = contextFor("demo", []);

    await expect(ctx.db.client()).rejects.toThrow();

    const entry = auditEntries.find((row) => row.action === "plugin_db_client");
    expect(entry).toMatchObject({
      success: false,
      username: "plugin:demo",
      resourceId: "demo",
    });
  });

  it("hands back read-only refs to the core tables a plugin may join", async () => {
    grants.set("demo", ["db:own"]);
    const { ctx } = contextFor("demo", ["db:own"]);

    const refs = (await ctx.db.refs()) as Record<string, unknown>;

    expect(Object.keys(refs).sort()).toEqual(["hosts", "users"]);
  });
});

describe("ctx.kv limits", () => {
  it("refuses a key over the length cap", async () => {
    grants.set("demo", ["kv:own"]);
    const { ctx } = contextFor("demo", ["kv:own"]);

    await expect(ctx.kv.set("k".repeat(129), 1)).rejects.toThrow(
      /at most 128 characters/,
    );
  });

  it("refuses a value over the size cap", async () => {
    grants.set("demo", ["kv:own"]);
    const { ctx } = contextFor("demo", ["kv:own"]);

    await expect(ctx.kv.set("big", "x".repeat(300_000))).rejects.toThrow(
      /byte limit/,
    );
  });

  it("refuses a new key past the key-count cap", async () => {
    process.env.PLUGIN_MAX_KV_KEYS = "2";
    grants.set("demo", ["kv:own"]);
    const { ctx } = contextFor("demo", ["kv:own"]);

    await ctx.kv.set("a", 1);
    await ctx.kv.set("b", 2);

    await expect(ctx.kv.set("c", 3)).rejects.toThrow(/key limit/);
  });

  it("still allows overwriting an existing key when full", async () => {
    // Only a new key grows the table, so a full store is not read-only.
    process.env.PLUGIN_MAX_KV_KEYS = "2";
    grants.set("demo", ["kv:own"]);
    const { ctx } = contextFor("demo", ["kv:own"]);
    await ctx.kv.set("a", 1);
    await ctx.kv.set("b", 2);

    await expect(ctx.kv.set("a", 99)).resolves.toBeUndefined();
    expect(await ctx.kv.get("a")).toBe(99);
  });

  it("counts each plugin's keys separately", async () => {
    process.env.PLUGIN_MAX_KV_KEYS = "1";
    grants.set("one", ["kv:own"]);
    grants.set("two", ["kv:own"]);

    await contextFor("one", ["kv:own"]).ctx.kv.set("a", 1);

    await expect(
      contextFor("two", ["kv:own"]).ctx.kv.set("a", 1),
    ).resolves.toBeUndefined();
  });
});

describe("ctx.sync", () => {
  it("registers an entity a plugin owns", () => {
    grants.set("demo", []);
    const { ctx } = contextFor("demo", []);

    ctx.sync.registerEntity({ type: "demoThings", table: {}, order: 200 });

    expect(listEntityTypes()).toContain("demoThings");
  });

  it("drops the registration when the plugin is disposed", async () => {
    grants.set("demo", []);
    const { ctx, handle } = contextFor("demo", []);
    ctx.sync.registerEntity({ type: "demoThings", table: {} });

    await handle.bag.disposeAll();

    expect(listEntityTypes()).not.toContain("demoThings");
  });
});
