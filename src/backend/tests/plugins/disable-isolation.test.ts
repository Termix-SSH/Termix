/**
 * The central promise of shipping the terminal as a plugin: disabling it
 * releases what it owns, and nothing else notices.
 *
 * The SSH connection pool deliberately stayed in core, so a worker plugin's
 * ctx.ssh keeps working with the terminal disabled. If the pool had moved into
 * the terminal plugin, these tests would fail, which is the point of them.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import net from "node:net";
import { PluginLoader } from "../../plugins/loader.js";
import { PluginBroker } from "../../plugins/broker.js";
import { TRANSPORT_OWNER_CAPABILITY } from "../../plugins/first-party.js";
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
  PluginPermissionError: class extends Error {},
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

/** Stands in for the terminal: a first-party plugin that owns a real port. */
function terminalLikeSource(port: number): string {
  return `
import net from "node:net";
let server = null;
export async function activate(ctx) {
  server = net.createServer();
  await new Promise((resolve) => server.listen(${port}, "127.0.0.1", resolve));
  ctx.registry.provide("terminal.sessions", { live: true });
}
export async function deactivate() {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = null;
}
`;
}

describe("disabling the terminal plugin", () => {
  const fixtures: Fixture[] = [];
  let loader: PluginLoader | null = null;

  afterEach(async () => {
    await loader?.shutdown();
    loader = null;
    for (const fixture of fixtures.splice(0)) fixture.cleanup();
    clearRegistry();
  });

  it("frees its port and leaves another plugin's ctx.ssh working", async () => {
    const terminal = createFixturePlugin({
      id: "ssh-terminal",
      permissions: [TRANSPORT_OWNER_CAPABILITY],
      manifestOverrides: { category: "Terminal" },
      backendSource: terminalLikeSource(TEST_PORT),
    });
    fixtures.push(terminal);

    const other = createFixturePlugin({
      id: "other-plugin",
      permissions: ["ssh.exec"],
      // Exposes an HTTP route the test invokes after the terminal is
      // disabled, so the ctx.ssh round trip genuinely happens afterwards and
      // travels the real worker boundary.
      backendSource: `
export async function activate(ctx) {
  await ctx.http.route("GET", "/run", async () => {
    const handle = await ctx.ssh.connect(1);
    const result = await ctx.ssh.exec(handle, "uptime");
    await ctx.ssh.close(handle);
    return result;
  });
}
`,
    });
    fixtures.push(other);

    // Stands in for the core pool. The terminal plugin does not provide it,
    // so disabling the terminal must not affect it.
    const open = vi.fn().mockResolvedValue({
      release: vi.fn(),
      exec: vi
        .fn()
        .mockResolvedValue({ stdout: "up 3 days", stderr: "", code: 0 }),
    });

    const broker = new PluginBroker({
      listHosts: async () => [],
      resolveHost: async () => null,
      ssh: { open },
    });

    loader = new PluginLoader({
      onWorkerReady: (plugin, worker) => broker.attach(plugin, worker),
      onWorkerGone: (plugin) => broker.detach(plugin.id),
    });

    await loader.load(terminal.dir);
    await loader.load(other.dir);
    await loader.activate("ssh-terminal");
    await loader.activate("other-plugin", "user-1");

    expect(await isListening(TEST_PORT)).toBe(true);

    await loader.deactivate("ssh-terminal");

    // What the user sees: the terminal's port is gone.
    expect(await isListening(TEST_PORT)).toBe(false);
    expect(loader.get("ssh-terminal")?.state).toBe("stopped");

    // And the other plugin is untouched, still running off the core pool.
    const otherPlugin = loader.get("other-plugin");
    expect(otherPlugin?.state).toBe("active");

    // The real test: a ctx.ssh round trip completed AFTER the terminal was
    // disabled, off the core pool, across the worker boundary.
    const runtime = broker.get("other-plugin")!;
    const result = (await broker.invokeRoute(runtime, "GET /run", {
      method: "GET",
      path: "/run",
      params: {},
      query: {},
      body: null,
      headers: {},
      userId: "user-1",
    })) as { stdout: string };

    expect(open).toHaveBeenCalled();
    expect(result.stdout).toBe("up 3 days");
  });

  it("can be re-enabled after being disabled", async () => {
    const terminal = createFixturePlugin({
      id: "ssh-terminal",
      permissions: [TRANSPORT_OWNER_CAPABILITY],
      manifestOverrides: { category: "Terminal" },
      backendSource: terminalLikeSource(TEST_PORT + 1),
    });
    fixtures.push(terminal);

    loader = new PluginLoader();
    await loader.load(terminal.dir);

    await loader.activate("ssh-terminal");
    expect(await isListening(TEST_PORT + 1)).toBe(true);

    await loader.deactivate("ssh-terminal");
    expect(await isListening(TEST_PORT + 1)).toBe(false);

    await loader.activate("ssh-terminal");
    expect(await isListening(TEST_PORT + 1)).toBe(true);
  });
});
