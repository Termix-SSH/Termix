import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockCtx } from "@termix/plugin-sdk/testing";
import { createTunnelManager } from "../../src/backend/manager.js";
import { startAutoStartTunnels } from "../../src/backend/autostart.js";
import { host, manifest, withHosts } from "./helpers";

class FakeClient extends EventEmitter {
  forwardOut = vi.fn((_a, _b, _c, _d, cb) => cb(undefined, new PassThrough()));
  end = vi.fn();
}

let manager: ReturnType<typeof createTunnelManager> | null = null;

afterEach(() => {
  manager?.dispose();
  manager = null;
});

const tunnel = (autoStart: boolean, sourcePort: number) => ({
  scope: "s2s",
  mode: "local",
  sourcePort,
  endpointHost: "127.0.0.1",
  endpointPort: 9,
  maxRetries: 3,
  retryInterval: 5,
  autoStart,
});

describe("autostart", () => {
  it("starts only autostart tunnels on enabled hosts, as each host's owner", async () => {
    const mock = createMockCtx({
      pluginId: manifest.id,
      manifest,
      capabilities: manifest.capabilities,
      sshClient: new FakeClient(),
    });
    withHosts(mock, {
      "user-1": [host()],
      "user-2": [host({ id: 8, userId: "user-2", name: "db" })],
    });
    await mock.ctx.settings.setHost(7, "enableTunnel", true);
    await mock.ctx.settings.setHost(7, "tunnelConnections", [
      tunnel(true, 0),
      tunnel(false, 0),
    ]);
    await mock.ctx.settings.setHost(8, "enableTunnel", false);
    await mock.ctx.settings.setHost(8, "tunnelConnections", [tunnel(true, 0)]);
    manager = createTunnelManager(mock.ctx);

    const started = await startAutoStartTunnels(mock.ctx, manager, async () => [
      { id: 7, userId: "user-1" },
      { id: 8, userId: "user-2" },
    ]);

    expect(started).toBe(1);
    expect([...manager.configs.keys()]).toEqual(["7::0::web::0::127.0.0.1::9"]);
    expect(
      manager.configs.get("7::0::web::0::127.0.0.1::9")?.requestingUserId,
    ).toBe("user-1");
  });

  it("does nothing when the host list cannot be read", async () => {
    const mock = createMockCtx({
      pluginId: manifest.id,
      manifest,
      capabilities: manifest.capabilities,
    });
    manager = createTunnelManager(mock.ctx);
    await expect(
      startAutoStartTunnels(mock.ctx, manager, async () => {
        throw new Error("no database");
      }),
    ).resolves.toBe(0);
  });
});
