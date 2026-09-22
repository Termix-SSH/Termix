/**
 * The single-tier loader: discovery, dependency order and lifecycle.
 *
 * These drive the real PluginLoader against real plugin directories written
 * to a temp dir, because the things worth testing here are exactly the ones a
 * mock would paper over: does a manifest on disk parse, does an id collision
 * get refused, does a plugin's own deactivate actually run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PluginLoader } from "../../plugins/loader.js";
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

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Points the loader at `bundled` and `user` as its two discovery roots. */
function setRoots(bundled: string, user: string): void {
  process.env.TERMIX_BUNDLED_PLUGINS_DIR = bundled;
  process.env.DATA_DIR = user;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  delete process.env.TERMIX_BUNDLED_PLUGINS_DIR;
  delete process.env.DATA_DIR;
  while (cleanups.length) cleanups.pop()?.();
});

describe("PluginLoader discovery", () => {
  it("loads a valid plugin directory", async () => {
    const fixture = createFixturePlugin();
    cleanups.push(fixture.cleanup);

    const loader = new PluginLoader();
    const plugin = await loader.load(fixture.dir, "bundled");

    expect(plugin.id).toBe("sample-plugin");
    expect(plugin.state).toBe("loaded");
    expect(plugin.manifest.capabilities).toEqual(["hosts:read", "kv:own"]);
  });

  it("rejects a directory whose name does not match the manifest id", async () => {
    const fixture = createFixturePlugin({
      manifestOverrides: { id: "something-else" },
    });
    cleanups.push(fixture.cleanup);

    const loader = new PluginLoader();
    await expect(loader.load(fixture.dir, "bundled")).rejects.toThrow(
      /does not match manifest id/,
    );
  });

  it("rejects a manifest whose backend entry is missing", async () => {
    const fixture = createFixturePlugin({ omitBackendEntry: true });
    cleanups.push(fixture.cleanup);

    const loader = new PluginLoader();
    await expect(loader.load(fixture.dir, "bundled")).rejects.toThrow(
      /backend entry .* is missing/,
    );
  });

  it("skips an invalid directory and loads the rest", async () => {
    const bundled = tempRoot("termix-bundled-");
    const user = tempRoot("termix-data-");

    createFixturePlugin({ id: "good-plugin", root: bundled });
    const broken = path.join(bundled, "broken-plugin");
    fs.mkdirSync(broken, { recursive: true });
    fs.writeFileSync(path.join(broken, "manifest.json"), "{ not json");

    setRoots(bundled, user);

    const loader = new PluginLoader();
    const loaded = await loader.loadAll();

    expect(loaded.map((plugin) => plugin.id)).toEqual(["good-plugin"]);
  });

  // A plugin dropped into the data directory must never be able to take over
  // an id the install already ships, or "ssh-terminal" becomes whatever the
  // last person to write that folder wanted it to be.
  it("refuses a user plugin that shadows a bundled id", async () => {
    const bundled = tempRoot("termix-bundled-");
    const user = tempRoot("termix-data-");
    const userPlugins = path.join(user, "plugins");
    fs.mkdirSync(userPlugins, { recursive: true });

    createFixturePlugin({ id: "ssh-terminal", root: bundled });
    createFixturePlugin({
      id: "ssh-terminal",
      root: userPlugins,
      manifestOverrides: { name: "Impostor" },
    });

    setRoots(bundled, user);

    const loader = new PluginLoader();
    const loaded = await loader.loadAll();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].source).toBe("bundled");
    expect(loaded[0].manifest.name).toBe("Sample Plugin");
  });
});

describe("PluginLoader dependency resolution", () => {
  async function loadAll(
    specs: Array<{ id: string; manifestOverrides?: Record<string, unknown> }>,
  ): Promise<PluginLoader> {
    const bundled = tempRoot("termix-bundled-");
    const user = tempRoot("termix-data-");
    for (const spec of specs) {
      createFixturePlugin({ ...spec, root: bundled });
    }
    setRoots(bundled, user);

    const loader = new PluginLoader();
    await loader.loadAll();
    return loader;
  }

  it("orders a dependency before its dependent", async () => {
    const loader = await loadAll([
      { id: "alpha", manifestOverrides: { dependencies: { beta: "^1.0.0" } } },
      { id: "beta" },
    ]);

    const { order, blocked, cycles } = loader.resolveOrder(["alpha", "beta"]);

    expect(cycles.size).toBe(0);
    expect(blocked.size).toBe(0);
    expect(order.indexOf("beta")).toBeLessThan(order.indexOf("alpha"));
  });

  it("blocks a plugin whose hard dependency is not installed", async () => {
    const loader = await loadAll([
      {
        id: "alpha",
        manifestOverrides: { dependencies: { missing: "^1.0.0" } },
      },
    ]);

    const { order, blocked } = loader.resolveOrder(["alpha"]);

    expect(order).toEqual([]);
    expect(blocked.get("alpha")).toMatch(/not installed/);
  });

  it("blocks a plugin whose dependency is present at the wrong version", async () => {
    const loader = await loadAll([
      { id: "alpha", manifestOverrides: { dependencies: { beta: "^2.0.0" } } },
      { id: "beta" },
    ]);

    const { blocked } = loader.resolveOrder(["alpha", "beta"]);

    expect(blocked.get("alpha")).toMatch(/1\.0\.0 is installed/);
  });

  it("blocks a plugin whose dependency is installed but disabled", async () => {
    const loader = await loadAll([
      { id: "alpha", manifestOverrides: { dependencies: { beta: "^1.0.0" } } },
      { id: "beta" },
    ]);

    const { blocked } = loader.resolveOrder(["alpha"]);

    expect(blocked.get("alpha")).toMatch(/not enabled/);
  });

  // Nothing to wait for, so this is a failure rather than a block.
  it("fails every plugin in a dependency cycle", async () => {
    const loader = await loadAll([
      { id: "alpha", manifestOverrides: { dependencies: { beta: "^1.0.0" } } },
      { id: "beta", manifestOverrides: { dependencies: { alpha: "^1.0.0" } } },
    ]);

    const { order, cycles } = loader.resolveOrder(["alpha", "beta"]);

    expect(order).toEqual([]);
    expect(cycles.get("alpha")).toMatch(/cycle/);
    expect(cycles.get("beta")).toMatch(/cycle/);
  });

  it("activates in dependency order and reports blocked plugins", async () => {
    const marker = path.join(tempRoot("termix-order-"), "order.txt");
    const record = (id: string) => `
      import fs from "node:fs";
      export async function activate() {
        fs.appendFileSync(${JSON.stringify(marker)}, "${id}\\n");
      }
    `;

    const bundled = tempRoot("termix-bundled-");
    const user = tempRoot("termix-data-");
    createFixturePlugin({
      id: "alpha",
      root: bundled,
      backendSource: record("alpha"),
      manifestOverrides: { dependencies: { beta: "^1.0.0" } },
    });
    createFixturePlugin({
      id: "beta",
      root: bundled,
      backendSource: record("beta"),
    });
    createFixturePlugin({
      id: "gamma",
      root: bundled,
      manifestOverrides: { dependencies: { nowhere: "^1.0.0" } },
    });
    setRoots(bundled, user);

    const loader = new PluginLoader();
    await loader.loadAll();
    const result = await loader.activateAll(["alpha", "beta", "gamma"]);

    expect(result.activated).toEqual(["beta", "alpha"]);
    expect(fs.readFileSync(marker, "utf8").trim().split("\n")).toEqual([
      "beta",
      "alpha",
    ]);
    expect(loader.get("gamma")?.state).toBe("blocked");
    expect(loader.get("gamma")?.lastError).toMatch(/not installed/);
  });
});

describe("PluginLoader lifecycle", () => {
  async function single(
    backendSource: string,
    id = "sample-plugin",
  ): Promise<PluginLoader> {
    const bundled = tempRoot("termix-bundled-");
    const user = tempRoot("termix-data-");
    createFixturePlugin({ id, root: bundled, backendSource });
    setRoots(bundled, user);

    const loader = new PluginLoader();
    await loader.loadAll();
    return loader;
  }

  it("runs activate and then deactivate", async () => {
    const marker = path.join(tempRoot("termix-life-"), "life.txt");
    const loader = await single(`
      import fs from "node:fs";
      export async function activate() {
        fs.appendFileSync(${JSON.stringify(marker)}, "up\\n");
      }
      export async function deactivate() {
        fs.appendFileSync(${JSON.stringify(marker)}, "down\\n");
      }
    `);

    await loader.activate("sample-plugin");
    expect(loader.get("sample-plugin")?.state).toBe("active");

    await loader.deactivate("sample-plugin");
    expect(loader.get("sample-plugin")?.state).toBe("stopped");
    expect(fs.readFileSync(marker, "utf8")).toBe("up\ndown\n");
  });

  it("marks a plugin failed when activate throws", async () => {
    const loader = await single(`
      export async function activate() {
        throw new Error("no good");
      }
    `);

    await expect(loader.activate("sample-plugin")).rejects.toThrow("no good");
    expect(loader.get("sample-plugin")?.state).toBe("failed");
    expect(loader.get("sample-plugin")?.lastError).toBe("no good");
  });

  it("rejects a backend entry with no activate export", async () => {
    const loader = await single(`export const nothing = true;`);

    await expect(loader.activate("sample-plugin")).rejects.toThrow(
      /does not export an activate/,
    );
  });

  // The whole point of the bag: cleanup cannot be conditional on the plugin
  // behaving well on the way out.
  it("disposes everything even when deactivate throws", async () => {
    const marker = path.join(tempRoot("termix-dispose-"), "disposed.txt");
    const loader = await single(`
      import fs from "node:fs";
      export async function activate(ctx) {
        ctx.disposables.add(() => {
          fs.appendFileSync(${JSON.stringify(marker)}, "disposed\\n");
        });
      }
      export async function deactivate() {
        throw new Error("deactivate blew up");
      }
    `);

    await loader.activate("sample-plugin");
    await loader.deactivate("sample-plugin");

    expect(loader.get("sample-plugin")?.state).toBe("stopped");
    expect(fs.readFileSync(marker, "utf8")).toBe("disposed\n");
  });

  // ESM caches the module, so the second activate runs against the same
  // module object the first one did. Anything created at module scope would
  // already be torn down by then.
  it("supports enable, disable, enable without a restart", async () => {
    const marker = path.join(tempRoot("termix-cycle-"), "cycle.txt");
    const loader = await single(`
      import fs from "node:fs";
      let timer = null;
      let server = null;

      export async function activate(ctx) {
        server = { closed: false };
        timer = setInterval(() => {}, 1000);
        ctx.disposables.add(() => {
          clearInterval(timer);
          server.closed = true;
          fs.appendFileSync(${JSON.stringify(marker)}, "closed\\n");
        });
        fs.appendFileSync(${JSON.stringify(marker)}, "started\\n");
      }
    `);

    await loader.activate("sample-plugin");
    await loader.deactivate("sample-plugin");
    await loader.activate("sample-plugin");

    expect(loader.get("sample-plugin")?.state).toBe("active");
    expect(fs.readFileSync(marker, "utf8")).toBe("started\nclosed\nstarted\n");

    await loader.deactivate("sample-plugin");
  });

  it("disposes registrations made before activate threw", async () => {
    const marker = path.join(tempRoot("termix-partial-"), "partial.txt");
    const loader = await single(`
      import fs from "node:fs";
      export async function activate(ctx) {
        ctx.disposables.add(() => {
          fs.appendFileSync(${JSON.stringify(marker)}, "cleaned\\n");
        });
        throw new Error("halfway");
      }
    `);

    await expect(loader.activate("sample-plugin")).rejects.toThrow("halfway");
    expect(fs.readFileSync(marker, "utf8")).toBe("cleaned\n");
  });

  it("deactivating a plugin that never started is a no-op", async () => {
    const loader = await single(`export async function activate() {}`);

    await loader.deactivate("sample-plugin");
    expect(loader.get("sample-plugin")?.state).toBe("stopped");
  });

  it("shuts plugins down in reverse activation order", async () => {
    const marker = path.join(tempRoot("termix-shutdown-"), "shutdown.txt");
    const record = (id: string) => `
      import fs from "node:fs";
      export async function activate() {}
      export async function deactivate() {
        fs.appendFileSync(${JSON.stringify(marker)}, "${id}\\n");
      }
    `;

    const bundled = tempRoot("termix-bundled-");
    const user = tempRoot("termix-data-");
    createFixturePlugin({
      id: "alpha",
      root: bundled,
      backendSource: record("alpha"),
      manifestOverrides: { dependencies: { beta: "^1.0.0" } },
    });
    createFixturePlugin({
      id: "beta",
      root: bundled,
      backendSource: record("beta"),
    });
    setRoots(bundled, user);

    const loader = new PluginLoader();
    await loader.loadAll();
    await loader.activateAll(["alpha", "beta"]);
    await loader.shutdown();

    // beta started first, so it stops last: a dependency outlives its
    // dependents.
    expect(fs.readFileSync(marker, "utf8").trim().split("\n")).toEqual([
      "alpha",
      "beta",
    ]);
  });
});

describe("PluginLoader error budget", () => {
  async function failing(threshold: number): Promise<PluginLoader> {
    const bundled = tempRoot("termix-bundled-");
    const user = tempRoot("termix-data-");
    createFixturePlugin({
      root: bundled,
      backendSource: `export async function activate() {}`,
    });
    setRoots(bundled, user);

    const loader = new PluginLoader({
      errorThreshold: threshold,
      errorWindowMs: 60_000,
    });
    await loader.loadAll();
    await loader.activate("sample-plugin");
    return loader;
  }

  it("marks a plugin failed once it trips the threshold", async () => {
    const loader = await failing(3);

    await loader.reportError("sample-plugin", new Error("one"));
    await loader.reportError("sample-plugin", new Error("two"));
    expect(loader.get("sample-plugin")?.state).toBe("active");

    await loader.reportError("sample-plugin", new Error("three"));

    expect(loader.get("sample-plugin")?.state).toBe("failed");
    expect(loader.get("sample-plugin")?.lastError).toBe("three");
  });

  it("forgets errors that fall outside the window", async () => {
    const bundled = tempRoot("termix-bundled-");
    const user = tempRoot("termix-data-");
    createFixturePlugin({
      root: bundled,
      backendSource: `export async function activate() {}`,
    });
    setRoots(bundled, user);

    const loader = new PluginLoader({ errorThreshold: 2, errorWindowMs: 10 });
    await loader.loadAll();
    await loader.activate("sample-plugin");

    await loader.reportError("sample-plugin", new Error("one"));
    await new Promise((resolve) => setTimeout(resolve, 25));
    await loader.reportError("sample-plugin", new Error("two"));

    expect(loader.get("sample-plugin")?.state).toBe("active");
  });

  it("wrap() counts a throwing callback instead of letting it escape", async () => {
    const loader = await failing(2);

    const wrapped = loader.wrap("sample-plugin", () => {
      throw new Error("callback failed");
    });

    await expect(wrapped()).resolves.toBeUndefined();
    await wrapped();

    expect(loader.get("sample-plugin")?.state).toBe("failed");
  });

  it("retry clears the budget and starts the plugin again", async () => {
    const loader = await failing(1);

    await loader.reportError("sample-plugin", new Error("down"));
    expect(loader.get("sample-plugin")?.state).toBe("failed");

    await loader.retry("sample-plugin");

    expect(loader.get("sample-plugin")?.state).toBe("active");
    expect(loader.get("sample-plugin")?.lastError).toBeNull();
  });
});
