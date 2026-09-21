/**
 * Worker plugins gained an optional deactivate() hook. It is best-effort by
 * design: a plugin that ignores it or hangs must not be able to block a
 * disable, it just loses its cleanup.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PluginLoader } from "../../plugins/loader.js";
import { PluginBroker } from "../../plugins/broker.js";
import { createFixturePlugin, type Fixture } from "./fixture-plugin.js";

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function buildLoader(broker: PluginBroker): PluginLoader {
  return new PluginLoader({
    onWorkerReady: (plugin, worker) => broker.attach(plugin, worker),
    onWorkerGone: (plugin) => broker.detach(plugin.id),
    onBeforeTerminate: async (plugin) => {
      const runtime = broker.get(plugin.id);
      if (runtime) await broker.requestDeactivate(runtime, 2000);
    },
  });
}

function newBroker(): PluginBroker {
  return new PluginBroker({
    listHosts: async () => [],
    resolveHost: async () => null,
  });
}

describe("worker deactivate hook", () => {
  let fixture: Fixture | null = null;
  let loader: PluginLoader | null = null;

  afterEach(async () => {
    await loader?.shutdown();
    loader = null;
    fixture?.cleanup();
    fixture = null;
  });

  it("runs the plugin's deactivate() before the worker is terminated", async () => {
    fixture = createFixturePlugin();
    const marker = path.join(fixture.root, "marker.txt");

    fs.writeFileSync(
      path.join(fixture.dir, "backend", "index.mjs"),
      `
import fs from "node:fs";
export async function activate() {}
export async function deactivate() {
  fs.writeFileSync(${JSON.stringify(marker)}, "cleaned");
}
`,
    );

    loader = buildLoader(newBroker());
    const plugin = await loader.load(fixture.dir);
    await loader.activate(plugin.id, "user-1");
    await loader.deactivate(plugin.id);

    expect(plugin.state).toBe("stopped");
    expect(fs.readFileSync(marker, "utf8")).toBe("cleaned");
  });

  it("still stops a plugin that exports no deactivate", async () => {
    fixture = createFixturePlugin();
    loader = buildLoader(newBroker());

    const plugin = await loader.load(fixture.dir);
    await loader.activate(plugin.id, "user-1");
    await loader.deactivate(plugin.id);

    expect(plugin.state).toBe("stopped");
    expect(plugin.worker).toBeNull();
  });

  it("does not let a hanging deactivate block the disable", async () => {
    fixture = createFixturePlugin();
    fs.writeFileSync(
      path.join(fixture.dir, "backend", "index.mjs"),
      `
export async function activate() {}
export function deactivate() {
  return new Promise(() => {});
}
`,
    );

    const broker = newBroker();
    loader = new PluginLoader({
      onWorkerReady: (plugin, worker) => broker.attach(plugin, worker),
      onWorkerGone: (plugin) => broker.detach(plugin.id),
      onBeforeTerminate: async (plugin) => {
        const runtime = broker.get(plugin.id);
        // Short timeout so the test does not wait out the real one.
        if (runtime) await broker.requestDeactivate(runtime, 150);
      },
    });

    const plugin = await loader.load(fixture.dir);
    await loader.activate(plugin.id, "user-1");

    const started = Date.now();
    await loader.deactivate(plugin.id);

    expect(plugin.state).toBe("stopped");
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
