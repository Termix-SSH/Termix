/**
 * The capability gate.
 *
 * Two conditions, both required: the manifest declares it and it is granted.
 * Either missing is a refusal, and both the refusal and the allowed call are
 * audited with the plugin id and the acting user, because "who did this"
 * being answerable is the point of the gate.
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
    listKeys: async () => [...kvStore.keys()],
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

const { createPluginContext, createPluginHandle } =
  await import("../../plugins/ctx.js");
const { invalidatePluginPermissionCache } =
  await import("../../plugins/permissions.js");
const { runAsActor } = await import("../../plugins/actor.js");

function manifest(capabilities: string[]) {
  return {
    id: "sample-plugin",
    name: "Sample Plugin",
    version: "1.0.0",
    description: "",
    author: { name: "Termix Tests" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities,
  } as never;
}

function context(declared: string[]) {
  const value = manifest(declared);
  const handle = createPluginHandle("sample-plugin", {
    activate: () => {},
  });
  return createPluginContext(value, handle);
}

beforeEach(() => {
  grants.clear();
  auditEntries.length = 0;
  kvStore.clear();
  invalidatePluginPermissionCache();
});

describe("capability gate", () => {
  it("denies a capability the manifest never declared", async () => {
    // Granted in the database, but absent from the manifest. Widening a
    // plugin's reach must always require a new manifest the user can see.
    grants.set("sample-plugin", ["kv:own"]);
    const ctx = context([]);

    await expect(ctx.kv.get("anything")).rejects.toThrow(
      /not granted the "kv:own" capability/,
    );
  });

  it("denies a declared capability that has not been granted", async () => {
    const ctx = context(["kv:own"]);

    await expect(ctx.kv.get("anything")).rejects.toThrow(
      /not granted the "kv:own" capability/,
    );
  });

  it("allows a capability that is both declared and granted", async () => {
    grants.set("sample-plugin", ["kv:own"]);
    const ctx = context(["kv:own"]);

    await ctx.kv.set("colour", "blue");

    await expect(ctx.kv.get("colour")).resolves.toBe("blue");
  });

  it("audits an allowed call with the plugin id and the actor", async () => {
    grants.set("sample-plugin", ["kv:own"]);
    const ctx = context(["kv:own"]);

    await runAsActor("user-42", "request", () => ctx.kv.set("k", 1));

    const entry = auditEntries.find((e) => e.action === "plugin_kv_set");
    expect(entry).toMatchObject({
      userId: "user-42",
      username: "plugin:sample-plugin",
      resourceType: "plugin",
      resourceId: "sample-plugin",
      success: true,
    });
  });

  // A refused call is exactly the thing an operator wants to find later.
  it("audits a denied call as a failure", async () => {
    const ctx = context(["kv:own"]);

    await expect(
      runAsActor("user-42", "request", () => ctx.kv.get("k")),
    ).rejects.toThrow();

    const entry = auditEntries.find((e) => e.action === "plugin_kv_get");
    expect(entry).toMatchObject({ userId: "user-42", success: false });
    expect(String(entry?.errorMessage)).toMatch(/not granted/);
  });

  it("picks up a grant made after the first denial", async () => {
    const ctx = context(["kv:own"]);
    await expect(ctx.kv.get("k")).rejects.toThrow();

    grants.set("sample-plugin", ["kv:own"]);
    invalidatePluginPermissionCache("sample-plugin");

    await expect(ctx.kv.get("k")).resolves.toBeNull();
  });
});

describe("ctx.asUser", () => {
  it("makes the named user the actor and audits the switch", async () => {
    grants.set("sample-plugin", ["kv:own"]);
    const ctx = context(["kv:own"]);

    let seen: string | undefined;
    await ctx.asUser("user-7", async () => {
      seen = ctx.currentActor();
      await ctx.kv.set("k", 1);
    });

    expect(seen).toBe("user-7");

    expect(
      auditEntries.find((e) => e.action === "plugin_as_user"),
    ).toMatchObject({ resourceId: "sample-plugin", success: true });

    expect(
      auditEntries.find((e) => e.action === "plugin_kv_set"),
    ).toMatchObject({ userId: "user-7" });
  });

  it("restores the previous actor afterwards", async () => {
    const ctx = context([]);

    await runAsActor("outer-user", "request", async () => {
      await ctx.asUser("inner-user", async () => {
        expect(ctx.currentActor()).toBe("inner-user");
      });
      expect(ctx.currentActor()).toBe("outer-user");
    });
  });

  it("refuses an empty user id", async () => {
    const ctx = context([]);

    await expect(ctx.asUser("", async () => {})).rejects.toThrow(
      /without a user id/,
    );
  });
});

describe("ctx.events namespacing", () => {
  it("refuses a core topic without events:core", () => {
    const ctx = context(["kv:own"]);

    // Without this a plugin could publish host.status and drive the
    // automations engine as though core had.
    expect(() => ctx.events.emit("host.status", {})).toThrow(
      /may only emit topics under/,
    );
  });

  it("allows the plugin's own namespace", () => {
    const ctx = context(["kv:own"]);

    expect(() =>
      ctx.events.emit("plugin.sample-plugin.thing", {}),
    ).not.toThrow();
  });

  it("allows a core topic when events:core is declared", () => {
    const ctx = context(["events:core"]);

    expect(() => ctx.events.emit("host.status", {})).not.toThrow();
  });
});

describe("ctx.kv limits", () => {
  beforeEach(() => {
    grants.set("sample-plugin", ["kv:own"]);
  });

  it("rejects an over-long key", async () => {
    const ctx = context(["kv:own"]);

    await expect(ctx.kv.set("k".repeat(129), 1)).rejects.toThrow(
      /at most 128 characters/,
    );
  });

  it("rejects a value over the size cap", async () => {
    const ctx = context(["kv:own"]);

    await expect(ctx.kv.set("big", "x".repeat(300_000))).rejects.toThrow(
      /byte limit/,
    );
  });
});
