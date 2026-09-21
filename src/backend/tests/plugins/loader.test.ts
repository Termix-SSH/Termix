import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginLoader, MAX_RESTART_ATTEMPTS } from "../../plugins/loader.js";
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

// Worker spawn plus crash backoff does not fit the 5s backend default.
const WORKER_TIMEOUT = 30_000;

describe("PluginLoader", () => {
  const fixtures: Fixture[] = [];
  let loader: PluginLoader | null = null;

  function fixture(...args: Parameters<typeof createFixturePlugin>) {
    const created = createFixturePlugin(...args);
    fixtures.push(created);
    return created;
  }

  afterEach(async () => {
    await loader?.shutdown();
    loader = null;
    while (fixtures.length) fixtures.pop()!.cleanup();
  });

  describe("load", () => {
    it("loads a valid plugin directory", async () => {
      const plugin = fixture();
      loader = new PluginLoader();

      const loaded = await loader.load(plugin.dir);

      expect(loaded.id).toBe("sample-plugin");
      expect(loaded.state).toBe("loaded");
      expect(loaded.worker).toBeNull();
      expect(loader.get("sample-plugin")).toBe(loaded);
    });

    it("rejects a manifest that fails validation", async () => {
      const plugin = fixture({ manifestOverrides: { version: "nope" } });
      loader = new PluginLoader();

      await expect(loader.load(plugin.dir)).rejects.toThrow(
        /Invalid plugin manifest/,
      );
    });

    it("rejects a directory whose name does not match the manifest id", async () => {
      const plugin = fixture({ manifestOverrides: { id: "other-id" } });
      loader = new PluginLoader();

      await expect(loader.load(plugin.dir)).rejects.toThrow(
        /does not match manifest id/,
      );
    });

    it("rejects a declared backend with no entry file", async () => {
      const plugin = fixture({ omitBackendEntry: true });
      loader = new PluginLoader();

      await expect(loader.load(plugin.dir)).rejects.toThrow(
        /declares a backend but/,
      );
    });

    it("rejects an unreadable manifest", async () => {
      loader = new PluginLoader();
      await expect(loader.load("/nonexistent/plugin-dir")).rejects.toThrow(
        /Could not read plugin manifest/,
      );
    });
  });

  describe("activate and deactivate", () => {
    it(
      "activates a plugin and runs its activate(ctx)",
      async () => {
        const plugin = fixture();
        loader = new PluginLoader();
        await loader.load(plugin.dir);

        await loader.activate("sample-plugin", "user-1");

        const loaded = loader.get("sample-plugin")!;
        expect(loaded.state).toBe("active");
        expect(loaded.worker).not.toBeNull();
        expect(loaded.ownerUserId).toBe("user-1");
      },
      WORKER_TIMEOUT,
    );

    it(
      "surfaces an error thrown inside activate(ctx)",
      async () => {
        const plugin = fixture({
          backendSource: `
            export async function activate() {
              throw new Error("boom from plugin");
            }
          `,
        });
        loader = new PluginLoader();
        await loader.load(plugin.dir);

        await expect(
          loader.activate("sample-plugin", "user-1"),
        ).rejects.toThrow(/boom from plugin/);
      },
      WORKER_TIMEOUT,
    );

    it(
      "rejects a backend entry with no activate export",
      async () => {
        const plugin = fixture({
          backendSource: `export const nothing = true;`,
        });
        loader = new PluginLoader();
        await loader.load(plugin.dir);

        await expect(
          loader.activate("sample-plugin", "user-1"),
        ).rejects.toThrow(/does not export an activate\(ctx\) function/);
      },
      WORKER_TIMEOUT,
    );

    it(
      "deactivate terminates the worker and does not count as a crash",
      async () => {
        const plugin = fixture();
        loader = new PluginLoader();
        await loader.load(plugin.dir);
        await loader.activate("sample-plugin", "user-1");

        await loader.deactivate("sample-plugin");

        const loaded = loader.get("sample-plugin")!;
        expect(loaded.state).toBe("stopped");
        expect(loaded.worker).toBeNull();
        expect(loaded.restartAttempts).toBe(0);
      },
      WORKER_TIMEOUT,
    );

    it(
      "does not leak the server's environment into the worker",
      async () => {
        process.env.TERMIX_TEST_SECRET = "super-secret-value";

        const plugin = fixture({
          backendSource: `
            export async function activate() {
              if (process.env.TERMIX_TEST_SECRET) {
                throw new Error("leaked:" + process.env.TERMIX_TEST_SECRET);
              }
            }
          `,
        });
        loader = new PluginLoader();
        await loader.load(plugin.dir);

        await loader.activate("sample-plugin", "user-1");
        expect(loader.get("sample-plugin")!.state).toBe("active");

        delete process.env.TERMIX_TEST_SECRET;
      },
      WORKER_TIMEOUT,
    );

    it("deactivating a never-started plugin is a no-op", async () => {
      const plugin = fixture();
      loader = new PluginLoader();
      await loader.load(plugin.dir);

      await loader.deactivate("sample-plugin");
      expect(loader.get("sample-plugin")!.state).toBe("stopped");
    });

    it("activating an unknown plugin throws", async () => {
      loader = new PluginLoader();
      await expect(loader.activate("ghost", "user-1")).rejects.toThrow(
        /Plugin ghost is not loaded/,
      );
    });
  });

  describe("crash restart", () => {
    it(
      "restarts a crashed plugin, then disables it after the retry budget",
      async () => {
        // Exits on a timer so activation succeeds first, then the worker dies.
        const plugin = fixture({
          backendSource: `
            export async function activate() {
              setTimeout(() => process.exit(1), 10);
            }
          `,
        });

        loader = new PluginLoader({ restartBackoffMs: [10, 10, 10] });
        await loader.load(plugin.dir);
        await loader.activate("sample-plugin", "user-1");

        const loaded = loader.get("sample-plugin")!;
        await vi.waitFor(
          () => {
            expect(loaded.state).toBe("disabled");
          },
          { timeout: 25_000, interval: 50 },
        );

        expect(loaded.restartAttempts).toBeGreaterThan(MAX_RESTART_ATTEMPTS);
        expect(loaded.worker).toBeNull();
      },
      WORKER_TIMEOUT,
    );

    it(
      "retry clears the crash counter and starts the plugin again",
      async () => {
        const plugin = fixture();
        loader = new PluginLoader();
        await loader.load(plugin.dir);
        await loader.activate("sample-plugin", "user-1");

        const loaded = loader.get("sample-plugin")!;
        // Simulate having been auto-disabled.
        await loader.deactivate("sample-plugin");
        loaded.state = "disabled";
        loaded.restartAttempts = MAX_RESTART_ATTEMPTS + 1;

        await loader.retry("sample-plugin");

        expect(loaded.state).toBe("active");
        // retry() clears the counter up front, before the stability window.
        expect(loaded.restartAttempts).toBe(0);
      },
      WORKER_TIMEOUT,
    );

    it(
      "clears the crash counter once a plugin stays up past the stability window",
      async () => {
        const plugin = fixture();
        loader = new PluginLoader({ stabilityWindowMs: 50 });
        await loader.load(plugin.dir);

        const loaded = loader.get("sample-plugin")!;
        loaded.restartAttempts = 2;
        await loader.activate("sample-plugin", "user-1");

        await vi.waitFor(
          () => {
            expect(loaded.restartAttempts).toBe(0);
          },
          { timeout: 5_000, interval: 25 },
        );
      },
      WORKER_TIMEOUT,
    );

    it("retry on a plugin that never activated throws", async () => {
      const plugin = fixture();
      loader = new PluginLoader();
      await loader.load(plugin.dir);

      await expect(loader.retry("sample-plugin")).rejects.toThrow(
        /never been activated/,
      );
    });
  });

  describe("loadAll", () => {
    // loadAll scans bundled plugins as well as user-installed ones, and the
    // repo really does ship one now. These tests are about the user directory,
    // so they point the bundled dir somewhere empty.
    let previousBundled: string | undefined;

    beforeEach(() => {
      previousBundled = process.env.TERMIX_BUNDLED_PLUGINS_DIR;
      process.env.TERMIX_BUNDLED_PLUGINS_DIR = "/nonexistent/bundled-plugins";
    });

    afterEach(() => {
      if (previousBundled === undefined) {
        delete process.env.TERMIX_BUNDLED_PLUGINS_DIR;
      } else {
        process.env.TERMIX_BUNDLED_PLUGINS_DIR = previousBundled;
      }
    });

    it("returns an empty list when the plugins dir does not exist", async () => {
      const previous = process.env.DATA_DIR;
      process.env.DATA_DIR = "/nonexistent/data-dir";
      loader = new PluginLoader();

      expect(await loader.loadAll()).toEqual([]);

      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
    });

    it("skips invalid directories and loads the rest", async () => {
      const good = fixture({ id: "good-plugin" });
      // Share the same root so both sit under one plugins dir.
      const bad = createFixturePlugin({
        id: "bad-plugin",
        manifestOverrides: { version: "nope" },
      });
      fixtures.push(bad);

      const fs = await import("node:fs");
      const path = await import("node:path");
      fs.cpSync(bad.dir, path.join(good.root, "bad-plugin"), {
        recursive: true,
      });

      const previous = process.env.DATA_DIR;
      // getPluginsDir() appends "plugins", so point DATA_DIR at the parent.
      const dataDir = path.join(good.root, "..");
      const pluginsDir = path.join(dataDir, "plugins");
      fs.mkdirSync(pluginsDir, { recursive: true });
      fs.cpSync(good.dir, path.join(pluginsDir, "good-plugin"), {
        recursive: true,
      });
      fs.cpSync(bad.dir, path.join(pluginsDir, "bad-plugin"), {
        recursive: true,
      });
      process.env.DATA_DIR = dataDir;

      loader = new PluginLoader();
      const loaded = await loader.loadAll();

      expect(loaded.map((p) => p.id)).toEqual(["good-plugin"]);

      fs.rmSync(pluginsDir, { recursive: true, force: true });
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
    });
  });
});
