/**
 * ctx.desktop.local: desktop:local is checked and audited, and nothing
 * touches the machine unless the backend runs embedded in the desktop app.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const grants = new Map<string, string[]>();
const auditEntries: Array<Record<string, unknown>> = [];

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

const bridge = vi.hoisted(() => ({
  requestFromElectronMain: vi.fn(async () => ({ success: true })),
}));
vi.mock("../../utils/electron-ipc-bridge.js", () => ({
  isElectronIpcAvailable: () => process.env.ELECTRON_EMBEDDED === "true",
  requestFromElectronMain: bridge.requestFromElectronMain,
}));

vi.mock("../../sync/client/link-store.js", () => ({
  getLink: async () => ({
    serverUrl: "https://termix.example.test",
    sessionToken: "token",
  }),
}));

import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";
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
  return createPluginContext(manifest, handle);
}

let dir: string;
const previous = process.env.ELECTRON_EMBEDDED;

beforeEach(() => {
  grants.clear();
  auditEntries.length = 0;
  invalidatePluginPermissionCache();
  bridge.requestFromElectronMain.mockClear();
  process.env.ELECTRON_EMBEDDED = "true";
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-local-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  if (previous === undefined) delete process.env.ELECTRON_EMBEDDED;
  else process.env.ELECTRON_EMBEDDED = previous;
});

describe("ctx.desktop.local", () => {
  it("refuses without desktop:local and audits the refusal", async () => {
    grants.set("demo", []);
    const ctx = contextFor("demo", []);

    await expect(ctx.desktop.local.fs.list(dir)).rejects.toThrow(
      /desktop:local/,
    );
    expect(auditEntries.at(-1)).toMatchObject({ success: false });
  });

  it("refuses when granted but not declared", async () => {
    grants.set("demo", ["desktop:local"]);
    const ctx = contextFor("demo", []);

    await expect(ctx.desktop.local.fs.list(dir)).rejects.toThrow(
      /desktop:local/,
    );
  });

  it("refuses outside the desktop app even with the capability", async () => {
    grants.set("demo", ["desktop:local"]);
    process.env.ELECTRON_EMBEDDED = "false";
    const ctx = contextFor("demo", ["desktop:local"]);

    expect(ctx.desktop.local.available()).toBe(false);
    await expect(ctx.desktop.local.fs.list(dir)).rejects.toThrow(/desktop app/);
  });

  it("lists and audits once per action", async () => {
    grants.set("demo", ["desktop:local"]);
    fs.writeFileSync(path.join(dir, "a.txt"), "hi");
    const ctx = contextFor("demo", ["desktop:local"]);

    const first = await ctx.desktop.local.fs.list(dir);
    await ctx.desktop.local.fs.list(dir);

    expect(first.entries.map((entry) => entry.name)).toEqual(["a.txt"]);
    expect(
      auditEntries.filter(
        (entry) => entry.action === "plugin_desktop_local_fs",
      ),
    ).toHaveLength(1);
  });

  it("rejects relative paths and unsafe names", async () => {
    grants.set("demo", ["desktop:local"]);
    const ctx = contextFor("demo", ["desktop:local"]);

    await expect(ctx.desktop.local.fs.list("relative/path")).rejects.toThrow(
      /absolute/,
    );
    await expect(ctx.desktop.local.fs.mkdir(dir, "../evil")).rejects.toThrow(
      /Invalid/,
    );
  });

  it("never renames onto an existing name", async () => {
    grants.set("demo", ["desktop:local"]);
    fs.writeFileSync(path.join(dir, "a"), "1");
    fs.writeFileSync(path.join(dir, "b"), "2");
    const ctx = contextFor("demo", ["desktop:local"]);

    await expect(
      ctx.desktop.local.fs.rename(path.join(dir, "a"), "b"),
    ).rejects.toThrow(/already exists/);
    expect(fs.readFileSync(path.join(dir, "b"), "utf8")).toBe("2");
  });

  it("keeps downloads inside the chosen folder and publishes on success", async () => {
    grants.set("demo", ["desktop:local"]);
    const ctx = contextFor("demo", ["desktop:local"]);

    await expect(
      ctx.desktop.local.fs.openDownload({
        rootPath: dir,
        destPath: path.join(dir, "..", "escape.txt"),
        transferId: "t1",
      }),
    ).rejects.toThrow(/outside/);

    const download = await ctx.desktop.local.fs.openDownload({
      rootPath: dir,
      destPath: path.join(dir, "ok.txt"),
      transferId: "t2",
    });
    download.stream.write("data");
    expect(await download.publish()).toBe(path.join(dir, "ok.txt"));
    expect(fs.readFileSync(path.join(dir, "ok.txt"), "utf8")).toBe("data");
    expect(fs.readdirSync(dir)).toEqual(["ok.txt"]);
  });

  it("removes the partial file when a download is aborted", async () => {
    grants.set("demo", ["desktop:local"]);
    const ctx = contextFor("demo", ["desktop:local"]);

    const download = await ctx.desktop.local.fs.openDownload({
      rootPath: dir,
      destPath: path.join(dir, "gone.txt"),
      transferId: "t3",
    });
    download.stream.write("partial");
    await download.abort();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("sends trash and open through Electron main and audits each call", async () => {
    grants.set("demo", ["desktop:local"]);
    const ctx = contextFor("demo", ["desktop:local"]);
    const target = path.join(dir, "x.txt");
    fs.writeFileSync(target, "x");

    await expect(ctx.desktop.local.fs.trash([target])).resolves.toEqual({
      trashed: 1,
      failed: [],
    });
    expect(bridge.requestFromElectronMain).toHaveBeenCalledWith(
      "shell-trash-item",
      { path: target },
    );

    await ctx.desktop.local.fs.open(target);
    await ctx.desktop.local.fs.open(target);
    expect(
      auditEntries.filter(
        (entry) => entry.action === "plugin_desktop_local_open",
      ),
    ).toHaveLength(2);
  });

  it("only calls the plugin's own routes", async () => {
    grants.set("demo", ["desktop:local"]);
    const ctx = contextFor("demo", ["desktop:local"]);

    for (const bad of [
      "relative",
      "//evil.example/x",
      "/../other",
      "/a/../../b",
      String.raw`/a\b`,
    ]) {
      await expect(ctx.desktop.local.pluginFetch("local", bad)).rejects.toThrow(
        /Invalid plugin route path/,
      );
    }
    await expect(
      ctx.desktop.local.pluginFetch("elsewhere" as never, "/ok"),
    ).rejects.toThrow(/Unknown origin|No acting user/);
  });

  it("reports the link and the embedded backend port", async () => {
    grants.set("demo", ["desktop:local"]);
    process.env.EMBEDDED_BACKEND_PORT = "31234";
    const ctx = contextFor("demo", ["desktop:local"]);

    const info = await ctx.desktop.local.info();
    expect(info.backendPort).toBe(31234);
    expect(info.link).toMatchObject({
      serverUrl: "https://termix.example.test",
      token: "token",
      allowInvalidCertificate: false,
    });
    expect(info.link?.headers.Cookie).toBe("jwt=token");
    delete process.env.EMBEDDED_BACKEND_PORT;
  });
});
