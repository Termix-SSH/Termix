/**
 * ctx.audit.subscribe, list and exportBatches: audit:read gates reading, and
 * subscribers see lines after they are accepted without delaying the writer.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const grants = new Map<string, string[]>();
const rows = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async (pluginId: string) =>
      (grants.get(pluginId) ?? []).map((capability) => ({
        pluginId,
        capability,
      })),
  }),
  createCurrentAuditLogRepository: () => ({
    listPage: async ({ limit }: { limit: number }) => ({
      logs: rows.list.slice(0, limit),
      total: rows.list.length,
    }),
    listForExport: async ({
      limit,
      offset,
    }: {
      limit: number;
      offset: number;
    }) => rows.list.slice(offset, offset + limit),
    create: async () => {},
  }),
  createCurrentUserRepository: () => ({ findById: async () => null }),
}));

import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";
import { emitAuditEntry } from "../../utils/audit-hooks.js";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";

function contextFor(pluginId: string, capabilities: string[]) {
  const manifest = {
    id: pluginId,
    name: pluginId,
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=26.10.3", api: "1" },
    capabilities,
  } as PluginManifest;
  const handle = createPluginHandle(pluginId, { activate: () => {} });
  return { ctx: createPluginContext(manifest, handle), handle };
}

const line = (id: number) => ({
  id,
  timestamp: new Date(1_700_000_000_000 + id),
  userId: null,
  username: "root",
  action: "login",
  resourceType: "user",
  resourceId: null,
  resourceName: null,
  details: null,
  ipAddress: null,
  userAgent: null,
  success: true,
  errorMessage: null,
});

beforeEach(() => {
  grants.clear();
  invalidatePluginPermissionCache();
  rows.list = [line(1), line(2), line(3)];
});

describe("ctx.audit reading", () => {
  it("refuses list and export without audit:read", async () => {
    grants.set("demo", []);
    const { ctx } = contextFor("demo", []);

    await expect(ctx.audit.list()).rejects.toThrow(/audit:read/);
    await expect(ctx.audit.exportBatches().next()).rejects.toThrow(
      /audit:read/,
    );
    expect(() => ctx.audit.subscribe(() => {})).toThrow(/audit:read/);
  });

  it("lists stored lines", async () => {
    grants.set("demo", ["audit:read"]);
    const { ctx } = contextFor("demo", ["audit:read"]);

    const page = await ctx.audit.list({ limit: 2 });
    expect(page.total).toBe(3);
    expect(page.entries.map((entry) => entry.id)).toEqual([1, 2]);
    expect(page.entries[0].timestamp).toMatch(/^20\d\d-/);
  });

  it("exports in batches", async () => {
    grants.set("demo", ["audit:read"]);
    const { ctx } = contextFor("demo", ["audit:read"]);

    const sizes: number[] = [];
    for await (const batch of ctx.audit.exportBatches({}, 2)) {
      sizes.push(batch.length);
    }
    expect(sizes).toEqual([2, 1]);
  });

  it("delivers new lines to a subscriber until it unsubscribes", async () => {
    grants.set("demo", ["audit:read"]);
    const { ctx } = contextFor("demo", ["audit:read"]);
    const seen: string[] = [];

    const stop = ctx.audit.subscribe((entry) => seen.push(entry.action));
    await new Promise((resolve) => setTimeout(resolve, 20));

    emitAuditEntry({
      userId: null,
      username: "root",
      action: "one",
      resourceType: "x",
      success: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    stop();
    emitAuditEntry({
      userId: null,
      username: "root",
      action: "two",
      resourceType: "x",
      success: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(seen).toEqual(["one"]);
  });

  it("stops delivering when the plugin deactivates", async () => {
    grants.set("demo", ["audit:read"]);
    const { ctx, handle } = contextFor("demo", ["audit:read"]);
    const seen: string[] = [];
    ctx.audit.subscribe((entry) => seen.push(entry.action));
    await new Promise((resolve) => setTimeout(resolve, 20));

    await handle.bag.disposeAll();
    emitAuditEntry({
      userId: null,
      username: "root",
      action: "late",
      resourceType: "x",
      success: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(seen).toEqual([]);
  });
});
