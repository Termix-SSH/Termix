/**
 * Disabling a plugin releases what it owns.
 *
 * A plugin that keeps a port after deactivate makes "disabled" a lie and
 * makes re-enabling fail on a port that is still held, which is exactly the
 * bug the docker console had: its WebSocket server was created at module
 * scope, so it survived deactivate and the second activate got nothing.
 *
 * These use a real listening socket rather than a mock, because the thing
 * under test is whether the OS still has the port.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import net from "node:net";
import { PluginLoader } from "../../plugins/loader.js";
import { clearRegistry } from "../../plugins/registry.js";
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

vi.mock("../../plugins/permissions.js", () => ({
  assertCapability: vi.fn().mockResolvedValue(undefined),
  hasCapability: vi.fn().mockResolvedValue(true),
  PluginCapabilityError: class extends Error {},
  invalidatePluginPermissionCache: vi.fn(),
}));

const TEST_PORT = 39102;

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

/**
 * A plugin that owns a real port, the way ssh-terminal and docker do.
 *
 * The server is created inside activate and closed through a disposable, not
 * at module scope, which is the rule the runtime documents.
 */
function portOwningSource(port: number): string {
  return `
    import net from "node:net";

    export async function activate(ctx) {
      const server = net.createServer();
      await new Promise((resolve) => server.listen(${port}, "127.0.0.1", resolve));
      ctx.disposables.add(
        () => new Promise((resolve) => server.close(() => resolve())),
      );
    }
  `;
}

let fixture: Fixture | null = null;
let loader: PluginLoader | null = null;

afterEach(async () => {
  await loader?.shutdown();
  loader = null;
  fixture?.cleanup();
  fixture = null;
  clearRegistry();
  delete process.env.TERMIX_BUNDLED_PLUGINS_DIR;
  delete process.env.DATA_DIR;
});

describe("disabling a plugin releases its resources", () => {
  async function start(): Promise<PluginLoader> {
    fixture = createFixturePlugin({
      backendSource: portOwningSource(TEST_PORT),
    });
    process.env.TERMIX_BUNDLED_PLUGINS_DIR = fixture.root;
    process.env.DATA_DIR = fixture.root;

    const instance = new PluginLoader();
    await instance.loadAll();
    await instance.activate(fixture.id);
    loader = instance;
    return instance;
  }

  it("frees the port the plugin was listening on", async () => {
    const instance = await start();
    expect(await isListening(TEST_PORT)).toBe(true);

    await instance.deactivate(fixture!.id);

    expect(await isListening(TEST_PORT)).toBe(false);
  });

  // The regression the docker console hit: the module stays in the ESM cache,
  // so the second activate runs against it and has to be able to bind again.
  it("can take the port again after being re-enabled", async () => {
    const instance = await start();

    await instance.deactivate(fixture!.id);
    expect(await isListening(TEST_PORT)).toBe(false);

    await instance.activate(fixture!.id);

    expect(await isListening(TEST_PORT)).toBe(true);
    expect(instance.get(fixture!.id)?.state).toBe("active");
  });

  it("frees the port on shutdown too", async () => {
    const instance = await start();

    await instance.shutdown();
    loader = null;

    expect(await isListening(TEST_PORT)).toBe(false);
  });
});
