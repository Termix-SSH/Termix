/**
 * ctx.hosts.importMany, importSshConfig, exportMany, registerImportNormalizer:
 * capability checks, core permission checks, audit lines and the registry key.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const grants = new Map<string, string[]>();
const auditEntries: Array<Record<string, unknown>> = [];
const state = vi.hoisted(() => ({
  permissions: new Set<string>(["hosts.create", "hosts.edit"]),
}));
const importer = vi.hoisted(() => ({
  runBulkImport: vi.fn(),
  runSshConfigImport: vi.fn(),
  exportAllHosts: vi.fn(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async (pluginId: string) =>
      (grants.get(pluginId) ?? []).map((capability) => ({
        pluginId,
        capability,
      })),
  }),
}));
vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    auditEntries.push(entry);
  },
}));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      hasPermission: async (_user: string, name: string) =>
        state.permissions.has(name),
    }),
  },
}));
vi.mock("../../hosts/import/host-import.js", () => ({
  runBulkImport: importer.runBulkImport,
  runSshConfigImport: importer.runSshConfigImport,
}));
vi.mock("../../hosts/import/host-export.js", () => ({
  exportAllHosts: importer.exportAllHosts,
}));
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { batched: (fn: () => unknown) => fn },
}));

import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";
import { runAsActor } from "../../plugins/actor.js";
import * as registry from "../../plugins/registry.js";
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

const asUser = <T>(fn: () => Promise<T>) => runAsActor("user-1", "request", fn);

const outcome = {
  success: 1,
  updated: 0,
  skipped: 0,
  failed: 0,
  errors: [],
  createdHostIds: [5],
};

beforeEach(() => {
  grants.clear();
  auditEntries.length = 0;
  invalidatePluginPermissionCache();
  state.permissions = new Set(["hosts.create", "hosts.edit"]);
  importer.runBulkImport.mockReset().mockResolvedValue(outcome);
  importer.runSshConfigImport.mockReset().mockResolvedValue(outcome);
  importer.exportAllHosts.mockReset().mockResolvedValue({ hosts: [{ id: 1 }] });
});

describe("ctx.hosts.importMany", () => {
  it("refuses without hosts:write", async () => {
    grants.set("demo", []);
    const { ctx } = contextFor("demo", []);
    await expect(
      asUser(() => ctx.hosts.importMany([{ ip: "a" }])),
    ).rejects.toThrow(/hosts:write/);
    expect(importer.runBulkImport).not.toHaveBeenCalled();
  });

  it("needs credentials:write only when credentials are passed", async () => {
    grants.set("demo", ["hosts:write"]);
    const { ctx } = contextFor("demo", ["hosts:write"]);
    await expect(
      asUser(() => ctx.hosts.importMany([{ ip: "a" }])),
    ).resolves.toMatchObject({ success: 1 });
    await expect(
      asUser(() =>
        ctx.hosts.importMany([{ ip: "a" }], { credentials: [{ alias: "k" }] }),
      ),
    ).rejects.toThrow(/credentials:write/);
  });

  it("refuses when the acting user lacks the core permissions", async () => {
    grants.set("demo", ["hosts:write"]);
    state.permissions = new Set(["hosts.create"]);
    const { ctx } = contextFor("demo", ["hosts:write"]);
    await expect(
      asUser(() => ctx.hosts.importMany([{ ip: "a" }])),
    ).rejects.toThrow(/hosts.edit/);
    expect(importer.runBulkImport).not.toHaveBeenCalled();
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_hosts_import",
      success: false,
    });
  });

  it("needs an acting user", async () => {
    grants.set("demo", ["hosts:write"]);
    const { ctx } = contextFor("demo", ["hosts:write"]);
    await expect(ctx.hosts.importMany([{ ip: "a" }])).rejects.toThrow(
      /acting user/,
    );
  });

  it("passes the options through and audits the counts", async () => {
    grants.set("demo", ["hosts:write"]);
    const { ctx } = contextFor("demo", ["hosts:write"]);
    const result = await asUser(() =>
      ctx.hosts.importMany([{ ip: "a" }], { atomic: true }),
    );
    expect(result.createdHostIds).toEqual([5]);
    expect(importer.runBulkImport).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ atomic: true, hosts: [{ ip: "a" }] }),
    );
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_hosts_import",
      success: true,
    });
  });

  it("surfaces the importer's request errors and audits the failure", async () => {
    grants.set("demo", ["hosts:write"]);
    importer.runBulkImport.mockRejectedValue(new Error("Maximum 100 hosts"));
    const { ctx } = contextFor("demo", ["hosts:write"]);
    await expect(asUser(() => ctx.hosts.importMany([]))).rejects.toThrow(
      /Maximum 100/,
    );
    expect(auditEntries.at(-1)).toMatchObject({ success: false });
  });
});

describe("ctx.hosts.importSshConfig", () => {
  it("refuses without hosts:write and runs with it", async () => {
    grants.set("demo", []);
    const { ctx } = contextFor("demo", []);
    await expect(
      asUser(() => ctx.hosts.importSshConfig("Host a")),
    ).rejects.toThrow(/hosts:write/);

    grants.set("demo", ["hosts:write"]);
    invalidatePluginPermissionCache();
    const { ctx: allowed } = contextFor("demo", ["hosts:write"]);
    await asUser(() => allowed.hosts.importSshConfig("Host a"));
    expect(importer.runSshConfigImport).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ content: "Host a" }),
    );
  });
});

describe("ctx.hosts.exportMany", () => {
  it("refuses with only hosts:write and audits the refusal", async () => {
    grants.set("demo", ["hosts:write"]);
    const { ctx } = contextFor("demo", ["hosts:write"]);
    await expect(asUser(() => ctx.hosts.exportMany())).rejects.toThrow(
      /hosts:export/,
    );
    expect(importer.exportAllHosts).not.toHaveBeenCalled();
    expect(auditEntries.at(-1)).toMatchObject({ success: false });
  });

  it("exports with secrets by default and audits it", async () => {
    grants.set("demo", ["hosts:export"]);
    const { ctx } = contextFor("demo", ["hosts:export"]);
    await expect(asUser(() => ctx.hosts.exportMany())).resolves.toEqual({
      hosts: [{ id: 1 }],
    });
    expect(importer.exportAllHosts).toHaveBeenCalledWith(
      "user-1",
      false,
      undefined,
    );
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_export_hosts",
      success: true,
    });
    expect(String(auditEntries.at(-1)?.details)).toMatch(/with secrets/);
  });

  it("passes share mode through", async () => {
    grants.set("demo", ["hosts:export"]);
    const { ctx } = contextFor("demo", ["hosts:export"]);
    await asUser(() => ctx.hosts.exportMany({ share: true }));
    expect(importer.exportAllHosts).toHaveBeenCalledWith(
      "user-1",
      true,
      undefined,
    );
    expect(String(auditEntries.at(-1)?.details)).toMatch(/without secrets/);
  });

  it("passes the host ids filter through", async () => {
    grants.set("demo", ["hosts:export"]);
    const { ctx } = contextFor("demo", ["hosts:export"]);
    await asUser(() => ctx.hosts.exportMany({ hostIds: [4, 5] }));
    expect(importer.exportAllHosts).toHaveBeenCalledWith(
      "user-1",
      false,
      [4, 5],
    );
  });
});

describe("ctx.hosts.registerImportNormalizer", () => {
  it("needs hosts:write", () => {
    const { ctx } = contextFor("demo", []);
    expect(() => ctx.hosts.registerImportNormalizer(() => null)).toThrow(
      /hosts:write/,
    );
  });

  it("registers under the key the import path reads and removes it on deactivate", async () => {
    const { ctx, handle } = contextFor("demo", ["hosts:write"]);
    const normalizer = () => ({ a: 1 });
    ctx.hosts.registerImportNormalizer(normalizer);
    expect(registry.consume("demo.hostImportNormalizer")).toBe(normalizer);

    await handle.bag.disposeAll();
    expect(registry.consume("demo.hostImportNormalizer")).toBeUndefined();
  });

  it("returns a remover", () => {
    const { ctx } = contextFor("demo", ["hosts:write"]);
    const remove = ctx.hosts.registerImportNormalizer(() => null);
    remove();
    expect(registry.consume("demo.hostImportNormalizer")).toBeUndefined();
  });
});
