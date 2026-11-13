/**
 * Which plugins run in their own process, which run inside the server and
 * which do not run at all (plugin API 2 and the "Run without isolation"
 * switch).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_COMMUNITY_ERROR,
  LEGACY_SWITCH_ERROR,
  PluginLoader,
} from "../../plugins/loader.js";
import {
  setPluginRunner,
  type PluginRunner,
} from "../../plugins/sandbox/runner.js";
import { createFixturePlugin } from "./fixture-plugin.js";

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginStorageRepository: () => ({
    get: async () => null,
    set: async () => {},
    delete: async () => false,
    listKeys: async () => [],
  }),
}));

const cleanups: Array<() => void> = [];

afterEach(() => {
  delete process.env.TERMIX_BUNDLED_PLUGINS_DIR;
  delete process.env.DATA_DIR;
  while (cleanups.length) cleanups.pop()?.();
});

function root(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function spyRunner(options: { fail?: boolean } = {}) {
  const registered: string[] = [];
  const unregistered: string[] = [];
  const runner: PluginRunner = {
    register: async (spec) => {
      registered.push(spec.manifest.id);
      if (options.fail) throw new Error("process did not start");
    },
    unregister: async (id) => {
      unregistered.push(id);
    },
    wake: async () => true,
    status: () => [],
    shutdown: async () => {},
  };
  setPluginRunner(runner);
  return { registered, unregistered };
}

const MARKER_BACKEND = (marker: string) => `
  import fs from "node:fs";
  export async function activate() {
    fs.appendFileSync(${JSON.stringify(marker)}, "in-process\\n");
  }
`;

async function load(options: {
  api: string;
  where: "bundled" | "user";
  backendSource?: string;
}): Promise<PluginLoader> {
  const bundled = root("termix-bundled-");
  const user = root("termix-data-");
  const target =
    options.where === "bundled" ? bundled : path.join(user, "plugins");
  fs.mkdirSync(target, { recursive: true });
  createFixturePlugin({
    root: target,
    backendSource: options.backendSource,
    manifestOverrides: { engine: { termix: ">=2.9.0", api: options.api } },
  });
  process.env.TERMIX_BUNDLED_PLUGINS_DIR = bundled;
  process.env.DATA_DIR = user;
  const loader = new PluginLoader();
  await loader.loadAll();
  return loader;
}

describe("plugin isolation", () => {
  it("hands an API 2 plugin to the supervisor and never imports it into core", async () => {
    const marker = path.join(root("termix-marker-"), "marker.txt");
    const { registered } = spyRunner();
    const loader = await load({
      api: "^2.0.0",
      where: "bundled",
      backendSource: MARKER_BACKEND(marker),
    });
    await loader.activate("sample-plugin");
    expect(registered).toEqual(["sample-plugin"]);
    expect(loader.get("sample-plugin")).toMatchObject({
      state: "active",
      sandboxed: true,
    });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("stops the process when the plugin is turned off", async () => {
    const { unregistered } = spyRunner();
    const loader = await load({ api: "2", where: "bundled" });
    await loader.activate("sample-plugin");
    await loader.deactivate("sample-plugin");
    expect(unregistered).toEqual(["sample-plugin"]);
    expect(loader.get("sample-plugin")?.state).toBe("stopped");
  });

  it("marks an API 2 plugin failed when its process does not start", async () => {
    const { unregistered } = spyRunner({ fail: true });
    const loader = await load({ api: "2", where: "bundled" });
    await expect(loader.activate("sample-plugin")).rejects.toThrow(
      /did not start/,
    );
    expect(loader.get("sample-plugin")?.state).toBe("failed");
    expect(unregistered).toEqual(["sample-plugin"]);
  });

  it("blocks an official API 1 plugin until an admin turns the switch on", async () => {
    const marker = path.join(root("termix-marker-"), "marker.txt");
    const { registered } = spyRunner();
    const loader = await load({
      api: "^1.15",
      where: "bundled",
      backendSource: MARKER_BACKEND(marker),
    });
    await loader.activate("sample-plugin");
    expect(loader.get("sample-plugin")).toMatchObject({
      state: "blocked",
      lastError: LEGACY_SWITCH_ERROR,
    });
    expect(fs.existsSync(marker)).toBe(false);

    loader.get("sample-plugin")!.runUnisolated = true;
    await loader.activate("sample-plugin");
    expect(loader.get("sample-plugin")?.state).toBe("active");
    expect(fs.readFileSync(marker, "utf8")).toBe("in-process\n");
    expect(registered).toEqual([]);
  });

  it("never runs a community API 1 plugin, even with the switch on", async () => {
    const marker = path.join(root("termix-marker-"), "marker.txt");
    spyRunner();
    const loader = await load({
      api: "1",
      where: "user",
      backendSource: MARKER_BACKEND(marker),
    });
    const plugin = loader.get("sample-plugin")!;
    plugin.runUnisolated = true;
    await loader.activate("sample-plugin");
    expect(plugin).toMatchObject({
      state: "blocked",
      lastError: LEGACY_COMMUNITY_ERROR,
    });
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("marks a plugin failed when its process keeps crashing", async () => {
    spyRunner();
    const onFailed = vi.fn();
    const bundled = root("termix-bundled-");
    createFixturePlugin({
      root: bundled,
      manifestOverrides: { engine: { termix: ">=2.9.0", api: "2" } },
    });
    process.env.TERMIX_BUNDLED_PLUGINS_DIR = bundled;
    process.env.DATA_DIR = root("termix-data-");
    const loader = new PluginLoader({ onFailed });
    await loader.loadAll();
    await loader.activate("sample-plugin");
    await loader.failPlugin("sample-plugin", "stopped 5 times");
    expect(loader.get("sample-plugin")).toMatchObject({
      state: "failed",
      lastError: "stopped 5 times",
    });
    expect(onFailed).toHaveBeenCalledOnce();
  });
});
