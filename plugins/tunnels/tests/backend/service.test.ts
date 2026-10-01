import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMockCtx,
  type MockPluginContext,
} from "@termix/plugin-sdk/testing";
import { createTunnelManager } from "../../src/backend/manager.js";
import {
  createTunnelsService,
  type TunnelsAccess,
} from "../../src/backend/service.js";
import { host, manifest, withHosts } from "./helpers";

class FakeClient extends EventEmitter {
  failForward = false;
  forwardOut = vi.fn(
    (
      _srcIP: string,
      _srcPort: number,
      _host: string,
      _port: number,
      cb: (err: Error | undefined, stream?: PassThrough) => void,
    ) => {
      if (this.failForward)
        cb(new Error("Channel open failure: connect failed"));
      else cb(undefined, new PassThrough());
    },
  );
  forwardIn = vi.fn();
  unforwardIn = vi.fn();
  end = vi.fn(() => this.emit("close"));
}

let manager: ReturnType<typeof createTunnelManager> | null = null;

afterEach(() => {
  manager?.dispose();
  manager = null;
});

function setup(): {
  mock: MockPluginContext;
  client: FakeClient;
  service: TunnelsAccess;
} {
  const client = new FakeClient();
  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    actor: "user-1",
    sshClient: client,
  });
  withHosts(mock, { "user-1": [host()], "user-2": [] });
  manager = createTunnelManager(mock.ctx);
  return { mock, client, service: createTunnelsService(mock.ctx, manager) };
}

const target = { targetHost: "127.0.0.1", targetPort: 8006 };

describe("tunnels.access forward()", () => {
  it("resolves with the bound port once the target answered a probe", async () => {
    const { service, client } = setup();
    const handle = await service.forward(7, target, { name: "web:7:e1" });

    expect(handle.bindHost).toBe("127.0.0.1");
    expect(handle.bindPort).toBeGreaterThan(0);
    expect(client.forwardOut).toHaveBeenCalledWith(
      "127.0.0.1",
      0,
      "127.0.0.1",
      8006,
      expect.any(Function),
    );
    await handle.close();
    expect(manager!.runtimes.has("web:7:e1")).toBe(false);
  });

  it("reuses a live forward and reopens one whose target changed", async () => {
    const { service, mock } = setup();
    const first = await service.forward(7, target, { name: "web:7:e1" });
    const again = await service.forward(7, target, { name: "web:7:e1" });
    expect(again.bindPort).toBe(first.bindPort);
    expect(mock.sshConnections).toHaveLength(1);

    await service.forward(
      7,
      { ...target, targetPort: 9000 },
      { name: "web:7:e1" },
    );
    expect(mock.sshConnections).toHaveLength(2);
  });

  it("rejects with the real reason and leaves nothing behind when the target is closed", async () => {
    const { service, client } = setup();
    client.failForward = true;

    await expect(
      service.forward(7, target, { name: "web:7:e1" }),
    ).rejects.toThrow(/connect failed/);
    expect(manager!.runtimes.has("web:7:e1")).toBe(false);
  });

  it("refuses a host the caller cannot reach and a name that is not reserved", async () => {
    const { service, mock } = setup();

    await mock.ctx.asUser("user-2", async () => {
      await expect(service.forward(7, target)).rejects.toThrow(/access denied/);
    });
    await expect(
      service.forward(7, target, { name: "my-tunnel" }),
    ).rejects.toThrow(/Forward names/);
    await expect(
      service.forward(7, target, { name: "web:8:e1" }),
    ).rejects.toThrow(/Forward names/);
    expect(mock.sshConnections).toEqual([]);
  });
});

describe("tunnels.access start/stop/status", () => {
  const saved = {
    scope: "s2s",
    mode: "local",
    sourcePort: 0,
    endpointHost: "127.0.0.1",
    endpointPort: 9,
    maxRetries: 3,
    retryInterval: 5,
    autoStart: false,
  };
  const name = "7::0::web::0::127.0.0.1::9";

  it("starts a host's saved tunnel by name and stops it again", async () => {
    const { service, mock } = setup();
    await mock.ctx.settings.setHost(7, "enableTunnel", true);
    await mock.ctx.settings.setHost(7, "tunnelConnections", [saved]);

    await service.start(name);
    await vi.waitFor(async () =>
      expect((await service.status(name))?.status).toBe("connected"),
    );
    expect(Object.keys(await service.list())).toEqual([name]);

    await service.stop(name);
    expect((await service.status(name))?.status).toBe("disconnected");
  });

  it("refuses a name that matches no saved tunnel", async () => {
    const { service, mock } = setup();
    await mock.ctx.settings.setHost(7, "enableTunnel", false);
    await mock.ctx.settings.setHost(7, "tunnelConnections", [saved]);

    await expect(service.start(name)).rejects.toThrow(/not configured/);
    await expect(service.start("nope")).rejects.toThrow(/not configured/);
  });

  it("hides a tunnel from a user who cannot reach its host", async () => {
    const { service, mock } = setup();
    await mock.ctx.settings.setHost(7, "enableTunnel", true);
    await mock.ctx.settings.setHost(7, "tunnelConnections", [saved]);
    await service.start(name);
    // The fake context tracks one actor globally, so let the connect settle
    // before switching users.
    await vi.waitFor(async () =>
      expect((await service.status(name))?.status).toBe("connected"),
    );

    await mock.ctx.asUser("user-2", async () => {
      expect(await service.status(name)).toBeNull();
      expect(await service.list()).toEqual({});
      await expect(service.stop(name)).rejects.toThrow(/Access denied/);
    });
  });
});
