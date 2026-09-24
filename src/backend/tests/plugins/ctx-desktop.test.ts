/**
 * ctx.desktop.openIsolatedWindow: desktop:window is checked and audited, and
 * the call only reaches Electron's main process when the backend is actually
 * running embedded in it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  available: false,
  requestFromElectronMain: vi.fn(async () => ({ success: true as const })),
}));
vi.mock("../../utils/electron-ipc-bridge.js", () => ({
  isElectronIpcAvailable: () => bridge.available,
  requestFromElectronMain: bridge.requestFromElectronMain,
}));

import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";
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
  invalidatePluginPermissionCache();
  bridge.available = false;
  bridge.requestFromElectronMain.mockClear();
});

describe("ctx.desktop.openIsolatedWindow", () => {
  it("refuses without desktop:window, before reaching Electron", async () => {
    grants.set("demo", []);
    const { ctx } = contextFor("demo", []);

    await expect(
      ctx.desktop.openIsolatedWindow({ url: "https://example.test" }),
    ).rejects.toThrow(/desktop:window/);
    expect(bridge.requestFromElectronMain).not.toHaveBeenCalled();
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_desktop_open_isolated_window",
      success: false,
    });
  });

  it("refuses when granted but not declared in the manifest", async () => {
    grants.set("demo", ["desktop:window"]);
    const { ctx } = contextFor("demo", []);

    await expect(
      ctx.desktop.openIsolatedWindow({ url: "https://example.test" }),
    ).rejects.toThrow(/desktop:window/);
  });

  it("refuses outside the desktop app even with the capability", async () => {
    grants.set("demo", ["desktop:window"]);
    bridge.available = false;
    const { ctx } = contextFor("demo", ["desktop:window"]);

    await expect(
      ctx.desktop.openIsolatedWindow({ url: "https://example.test" }),
    ).rejects.toThrow(/desktop app/);
    expect(bridge.requestFromElectronMain).not.toHaveBeenCalled();
  });

  it("relays to Electron main and audits success", async () => {
    grants.set("demo", ["desktop:window"]);
    bridge.available = true;
    const { ctx } = contextFor("demo", ["desktop:window"]);

    const request = { url: "https://example.test", title: "Example" };
    await expect(ctx.desktop.openIsolatedWindow(request)).resolves.toEqual({
      success: true,
    });

    expect(bridge.requestFromElectronMain).toHaveBeenCalledWith(
      "open-isolated-window",
      request,
    );
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_desktop_open_isolated_window",
      success: true,
    });
  });
});

describe("ctx.desktop.launchNativeRdp", () => {
  const request = { host: "win.example.test", port: 3389, username: "bob" };

  it("refuses without desktop:window", async () => {
    grants.set("demo", []);
    const { ctx } = contextFor("demo", []);

    await expect(ctx.desktop.launchNativeRdp(request)).rejects.toThrow(
      /desktop:window/,
    );
    expect(bridge.requestFromElectronMain).not.toHaveBeenCalled();
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_desktop_launch_native_rdp",
      success: false,
    });
  });

  it("refuses outside the desktop app", async () => {
    grants.set("demo", ["desktop:window"]);
    const { ctx } = contextFor("demo", ["desktop:window"]);

    expect(ctx.desktop.available()).toBe(false);
    await expect(ctx.desktop.launchNativeRdp(request)).rejects.toThrow(
      /desktop app/,
    );
  });

  it("relays to Electron main and audits success", async () => {
    grants.set("demo", ["desktop:window"]);
    bridge.available = true;
    const { ctx } = contextFor("demo", ["desktop:window"]);

    expect(ctx.desktop.available()).toBe(true);
    await expect(ctx.desktop.launchNativeRdp(request)).resolves.toEqual({
      success: true,
    });
    expect(bridge.requestFromElectronMain).toHaveBeenCalledWith(
      "launch-native-rdp",
      request,
    );
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_desktop_launch_native_rdp",
      success: true,
    });
  });
});
