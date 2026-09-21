/**
 * The in-process branch of the loader: a first-party plugin runs on the main
 * thread, with no worker, and its deactivate() actually gets awaited.
 *
 * These use the real ssh-terminal id because the allowlist is hardcoded and
 * that is the point -- there is deliberately no way to fake membership.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PluginLoader } from "../../plugins/loader.js";
import { TRANSPORT_OWNER_CAPABILITY } from "../../plugins/first-party.js";
import { clearRegistry, consume } from "../../plugins/registry.js";
import { pluginEvents } from "../../plugins/events.js";
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

const FIRST_PARTY_OPTIONS = {
  id: "ssh-terminal",
  permissions: [TRANSPORT_OWNER_CAPABILITY],
  manifestOverrides: { category: "Terminal" },
};

/**
 * Writes a marker file rather than using a module-level variable: the plugin
 * is imported by URL into the same process, but ESM caching means a second
 * fixture at a different path is a different module instance.
 */
function backendWritingMarker(markerPath: string, extra = ""): string {
  const literal = JSON.stringify(markerPath);
  return `
import fs from "node:fs";
export async function activate(ctx) {
  fs.writeFileSync(${literal}, "activated");
  ${extra}
}
export async function deactivate() {
  fs.appendFileSync(${literal}, ":deactivated");
}
`;
}

describe("in-process first-party plugins", () => {
  let fixture: Fixture | null = null;
  let loader: PluginLoader | null = null;

  beforeEach(() => {
    clearRegistry();
    pluginEvents.clear();
  });

  afterEach(async () => {
    await loader?.shutdown();
    loader = null;
    fixture?.cleanup();
    fixture = null;
    clearRegistry();
    pluginEvents.clear();
  });

  it("activates on the main thread with no worker and no owner", async () => {
    fixture = createFixturePlugin(FIRST_PARTY_OPTIONS);
    const marker = path.join(fixture.root, "marker.txt");
    fs.writeFileSync(
      path.join(fixture.dir, "backend", "index.mjs"),
      backendWritingMarker(marker),
    );

    const onWorkerReady = vi.fn();
    loader = new PluginLoader({ onWorkerReady });

    const plugin = await loader.load(fixture.dir);
    // No ownerUserId: an in-process plugin never acts as a user.
    await loader.activate(plugin.id);

    expect(plugin.state).toBe("active");
    expect(plugin.worker).toBeNull();
    expect(plugin.inProcess).not.toBeNull();
    expect(plugin.ownerUserId).toBeNull();
    // The broker attaches via this hook; an in-process plugin bypasses it.
    expect(onWorkerReady).not.toHaveBeenCalled();
    expect(fs.readFileSync(marker, "utf8")).toBe("activated");
  });

  it("awaits deactivate() on disable and clears the handle", async () => {
    fixture = createFixturePlugin(FIRST_PARTY_OPTIONS);
    const marker = path.join(fixture.root, "marker.txt");
    fs.writeFileSync(
      path.join(fixture.dir, "backend", "index.mjs"),
      backendWritingMarker(marker),
    );

    loader = new PluginLoader();
    const plugin = await loader.load(fixture.dir);
    await loader.activate(plugin.id);
    await loader.deactivate(plugin.id);

    expect(plugin.state).toBe("stopped");
    expect(plugin.inProcess).toBeNull();
    expect(fs.readFileSync(marker, "utf8")).toBe("activated:deactivated");
  });

  it("revokes registry entries the plugin provided", async () => {
    fixture = createFixturePlugin(FIRST_PARTY_OPTIONS);
    const marker = path.join(fixture.root, "marker.txt");
    fs.writeFileSync(
      path.join(fixture.dir, "backend", "index.mjs"),
      backendWritingMarker(
        marker,
        `ctx.registry.provide("terminal.sessions", { live: true });`,
      ),
    );

    loader = new PluginLoader();
    const plugin = await loader.load(fixture.dir);
    await loader.activate(plugin.id);

    expect(consume("terminal.sessions")).toEqual({ live: true });

    await loader.deactivate(plugin.id);
    // Disabling the plugin must take its services with it, or a consumer
    // would keep resolving a dead provider.
    expect(consume("terminal.sessions")).toBeUndefined();
  });

  it("detaches event listeners the plugin registered", async () => {
    fixture = createFixturePlugin(FIRST_PARTY_OPTIONS);
    const marker = path.join(fixture.root, "marker.txt");
    fs.writeFileSync(
      path.join(fixture.dir, "backend", "index.mjs"),
      backendWritingMarker(marker, `ctx.events.on("host.status", () => {});`),
    );

    loader = new PluginLoader();
    const plugin = await loader.load(fixture.dir);
    await loader.activate(plugin.id);

    expect(pluginEvents.listenerCount("host.status")).toBe(1);

    await loader.deactivate(plugin.id);
    expect(pluginEvents.listenerCount("host.status")).toBe(0);
  });

  it("reports an activation failure instead of leaving a half-live plugin", async () => {
    fixture = createFixturePlugin(FIRST_PARTY_OPTIONS);
    fs.writeFileSync(
      path.join(fixture.dir, "backend", "index.mjs"),
      `export async function activate() { throw new Error("boom"); }`,
    );

    loader = new PluginLoader();
    const plugin = await loader.load(fixture.dir);

    await expect(loader.activate(plugin.id)).rejects.toThrow("boom");
    expect(plugin.state).toBe("crashed");
    expect(plugin.inProcess).toBeNull();
    expect(plugin.lastError).toContain("boom");
  });

  it("rejects an entry with no activate export", async () => {
    fixture = createFixturePlugin(FIRST_PARTY_OPTIONS);
    fs.writeFileSync(
      path.join(fixture.dir, "backend", "index.mjs"),
      `export const nothing = true;`,
    );

    loader = new PluginLoader();
    const plugin = await loader.load(fixture.dir);

    await expect(loader.activate(plugin.id)).rejects.toThrow(
      /does not export an activate/,
    );
  });

  it("runs a first-party plugin in a worker when it does not ask for the tier", async () => {
    fixture = createFixturePlugin({
      id: "ssh-terminal",
      permissions: ["hosts.read"],
      manifestOverrides: { category: "Terminal" },
    });

    loader = new PluginLoader();
    const plugin = await loader.load(fixture.dir);
    await loader.activate(plugin.id, "user-1");

    expect(plugin.state).toBe("active");
    expect(plugin.worker).not.toBeNull();
    expect(plugin.inProcess).toBeNull();
  });
});
