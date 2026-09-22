/**
 * Core owns shutdown.
 *
 * gracefulShutdown in starter.ts calls shutdownPlugins(), which runs every
 * plugin's deactivate and disposes what it registered. A plugin does not need
 * its own process signal handler, and must not have one: the docker console
 * used to install a SIGTERM listener that called process.exit(0), which
 * skipped the rest of the sequence including other plugins and the database
 * flush.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { PluginLoader } from "../../plugins/loader.js";
import { createFixturePlugin } from "./fixture-plugin.js";

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../../plugins/permissions.js", () => ({
  assertCapability: vi.fn().mockResolvedValue(undefined),
  hasCapability: vi.fn().mockResolvedValue(true),
  PluginCapabilityError: class extends Error {},
  invalidatePluginPermissionCache: vi.fn(),
}));

const CONSOLE_PORT = 39109;
const cleanups: Array<() => void> = [];

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

afterEach(() => {
  delete process.env.TERMIX_BUNDLED_PLUGINS_DIR;
  delete process.env.DATA_DIR;
  while (cleanups.length) cleanups.pop()?.();
});

/**
 * Shaped like the docker plugin: a REST server and a console WebSocket
 * server, both started inside activate and closed through disposables.
 */
const DOCKER_LIKE = `
  import net from "node:net";

  export async function activate(ctx) {
    const console = net.createServer();
    await new Promise((resolve) =>
      console.listen(${CONSOLE_PORT}, "127.0.0.1", resolve),
    );
    ctx.disposables.add(
      () => new Promise((resolve) => console.close(() => resolve())),
    );
  }
`;

describe("shutdownPlugins closes what plugins own", () => {
  it("closes a console-style WebSocket server on shutdown", async () => {
    const bundled = tempRoot("termix-bundled-");
    const user = tempRoot("termix-data-");
    createFixturePlugin({
      id: "docker",
      root: bundled,
      backendSource: DOCKER_LIKE,
    });
    process.env.TERMIX_BUNDLED_PLUGINS_DIR = bundled;
    process.env.DATA_DIR = user;

    const loader = new PluginLoader();
    await loader.loadAll();
    await loader.activate("docker");

    expect(await isListening(CONSOLE_PORT)).toBe(true);

    await loader.shutdown();

    expect(await isListening(CONSOLE_PORT)).toBe(false);
  });

  // One plugin failing to shut down cleanly must not strand the others,
  // which is the other half of why core drives this rather than each plugin.
  it("keeps going when one plugin's deactivate throws", async () => {
    const marker = path.join(tempRoot("termix-marker-"), "stopped.txt");
    const bundled = tempRoot("termix-bundled-");
    const user = tempRoot("termix-data-");

    createFixturePlugin({
      id: "alpha",
      root: bundled,
      backendSource: `
        export async function activate() {}
        export async function deactivate() {
          throw new Error("alpha refuses to stop");
        }
      `,
    });
    createFixturePlugin({
      id: "beta",
      root: bundled,
      backendSource: `
        import fs from "node:fs";
        export async function activate() {}
        export async function deactivate() {
          fs.appendFileSync(${JSON.stringify(marker)}, "beta stopped\\n");
        }
      `,
    });

    process.env.TERMIX_BUNDLED_PLUGINS_DIR = bundled;
    process.env.DATA_DIR = user;

    const loader = new PluginLoader();
    await loader.loadAll();
    await loader.activateAll(["alpha", "beta"]);

    await loader.shutdown();

    expect(loader.get("alpha")?.state).toBe("stopped");
    expect(loader.get("beta")?.state).toBe("stopped");
    expect(fs.readFileSync(marker, "utf8")).toBe("beta stopped\n");
  });
});
