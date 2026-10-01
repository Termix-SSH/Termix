/**
 * ctx.secrets.get/set/delete: a plugin's own per-user secrets. Gated on
 * secrets:own, scoped to the acting user, encrypted at rest, and the value
 * never reaches the audit log.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const grants = new Map<string, string[]>();
const auditEntries: Array<Record<string, unknown>> = [];

const state = vi.hoisted(() => ({
  rows: new Map<string, { value: string | null; encrypted: boolean }>(),
}));

const rowKey = (
  pluginId: string,
  scope: string,
  scopeId: string | null,
  key: string,
) => `${pluginId}|${scope}|${scopeId}|${key}`;

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async (pluginId: string) =>
      (grants.get(pluginId) ?? []).map((capability) => ({
        pluginId,
        capability,
      })),
  }),
  createCurrentPluginSettingsRepository: () => ({
    get: async (
      pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
    ) => {
      const row = state.rows.get(rowKey(pluginId, scope, scopeId, key));
      return row ? { ...row } : null;
    },
    set: async (
      pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
      value: string | null,
      encrypted = false,
    ) => {
      state.rows.set(rowKey(pluginId, scope, scopeId, key), {
        value,
        encrypted,
      });
    },
    delete: async (
      pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
    ) => state.rows.delete(rowKey(pluginId, scope, scopeId, key)),
  }),
}));

vi.mock("../../utils/system-secret-crypto.js", () => ({
  encryptSystemSecret: async (value: string) => `sysenc:${value}`,
  decryptSystemSecret: async (value: string) => value.replace(/^sysenc:/, ""),
  isSystemEncrypted: (value: string) => value.startsWith("sysenc:"),
}));

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    auditEntries.push(entry);
  },
}));

import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";
import { runAsActor } from "../../plugins/actor.js";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

function contextFor(capabilities: string[]) {
  grants.set("demo", capabilities);
  const manifest = {
    id: "demo",
    name: "demo",
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities,
  } as PluginManifest;
  const handle = createPluginHandle("demo", { activate: () => {} });
  return createPluginContext(manifest, handle);
}

beforeEach(() => {
  grants.clear();
  auditEntries.length = 0;
  invalidatePluginPermissionCache();
  state.rows.clear();
});

describe("ctx.secrets store", () => {
  it("refuses every call without secrets:own", async () => {
    const ctx = contextFor([]);
    await runAsActor("alice", "request", async () => {
      await expect(ctx.secrets.get("k")).rejects.toThrow(/secrets:own/);
      await expect(ctx.secrets.set("k", "v")).rejects.toThrow(/secrets:own/);
      await expect(ctx.secrets.delete("k")).rejects.toThrow(/secrets:own/);
    });
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_secret_delete",
      success: false,
    });
    expect(state.rows.size).toBe(0);
  });

  it("refuses a call with no acting user", async () => {
    const ctx = contextFor(["secrets:own"]);
    await expect(ctx.secrets.set("k", "v")).rejects.toThrow(/acting user/);
  });

  it("stores encrypted, per user, and never audits the value", async () => {
    const ctx = contextFor(["secrets:own"]);

    await runAsActor("alice", "request", () =>
      ctx.secrets.set("provider:1", "sk-alice"),
    );

    expect(state.rows.get("demo|secret|alice|provider:1")).toEqual({
      value: JSON.stringify("sysenc:sk-alice"),
      encrypted: true,
    });
    expect(
      await runAsActor("alice", "request", () => ctx.secrets.get("provider:1")),
    ).toBe("sk-alice");
    expect(
      await runAsActor("bob", "request", () => ctx.secrets.get("provider:1")),
    ).toBeNull();
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_secret_set",
      success: true,
    });
    expect(JSON.stringify(auditEntries)).not.toContain("sk-alice");
  });

  it("clears on null and on delete", async () => {
    const ctx = contextFor(["secrets:own"]);
    await runAsActor("alice", "request", async () => {
      await ctx.secrets.set("a", "1");
      await ctx.secrets.set("b", "2");
      await ctx.secrets.set("a", null);
      await ctx.secrets.delete("b");
      expect(await ctx.secrets.get("a")).toBeNull();
      expect(await ctx.secrets.get("b")).toBeNull();
    });
    expect(state.rows.size).toBe(0);
  });

  it("seals without an acting user and refuses without secrets:own", async () => {
    const denied = contextFor([]);
    await expect(denied.secrets.seal("v")).rejects.toThrow(/secrets:own/);
    await expect(denied.secrets.unseal("sysenc:v")).rejects.toThrow(
      /secrets:own/,
    );

    const ctx = contextFor(["secrets:own"]);
    const sealed = await ctx.secrets.seal("totp-secret");
    expect(sealed).toBe("sysenc:totp-secret");
    expect(await ctx.secrets.unseal(sealed)).toBe("totp-secret");
    // A plain string was never sealed and must not read back as one.
    expect(await ctx.secrets.unseal("totp-secret")).toBeNull();
    expect(JSON.stringify(auditEntries)).not.toContain("totp-secret");
  });
});
