import net from "node:net";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMockCtx,
  type MockPluginContext,
} from "@termix/plugin-sdk/testing";
import { createTunnelManager } from "../../src/backend/manager.js";
import type { TunnelConfig } from "../../src/backend/types.js";
import { host, manifest, pluginDir, withHosts } from "./helpers";

/** Just enough of an ssh2 Client for the manager's channel calls. */
class FakeClient extends EventEmitter {
  channels: PassThrough[] = [];
  forwardOut = vi.fn(
    (
      _srcIP: string,
      _srcPort: number,
      _host: string,
      _port: number,
      cb: (err: Error | undefined, stream?: PassThrough) => void,
    ) => {
      const channel = new PassThrough();
      this.channels.push(channel);
      cb(undefined, channel);
    },
  );
  forwardIn = vi.fn(
    (_host: string, port: number, cb: (err?: Error, port?: number) => void) =>
      cb(undefined, port || 40000),
  );
  unforwardIn = vi.fn((_host: string, _port: number, cb?: () => void) =>
    cb?.(),
  );
  end = vi.fn(() => this.emit("close"));
}

let manager: ReturnType<typeof createTunnelManager> | null = null;

afterEach(() => {
  manager?.dispose();
  manager = null;
});

function setup(client = new FakeClient()) {
  const mock: MockPluginContext = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    actor: "user-1",
    sshClient: client,
  });
  withHosts(mock, {
    "user-1": [host(), host({ id: 9, name: "db", ip: "10.0.0.9" })],
  });
  manager = createTunnelManager(mock.ctx);
  return { mock, client, manager };
}

function config(overrides: Partial<TunnelConfig> = {}): TunnelConfig {
  return {
    name: "7::0::web::0::127.0.0.1::9",
    scope: "s2s",
    mode: "local",
    tunnelType: "local",
    bindHost: "127.0.0.1",
    sourceHostId: 7,
    tunnelIndex: 0,
    requestingUserId: "user-1",
    hostName: "web",
    sourceIP: "10.0.0.5",
    sourceSSHPort: 22,
    sourceUsername: "root",
    endpointHost: "127.0.0.1",
    sourcePort: 0,
    endpointPort: 9,
    maxRetries: 3,
    retryInterval: 5000,
    autoStart: false,
    ...overrides,
  };
}

describe("both SSH legs go through ctx.ssh", () => {
  it("never builds its own ssh2 Client", () => {
    // The host key check lives in core's connect pipeline. A raw
    // `new Client()` here would skip it, which is the bug this plugin fixed.
    const dir = join(pluginDir, "src", "backend");
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(/new Client\(/);
      expect(source, file).not.toMatch(
        /import \{[^}]*\bClient\b[^}]*\} from "ssh2"/,
      );
    }
  });

  it("opens the endpoint leg over a channel on the source connection", async () => {
    const { mock, client } = setup();
    const runtime = await manager!.connect(
      config({
        name: "7::0::web::8080::db::5432",
        mode: "remote",
        tunnelType: "remote",
        endpointHost: "db",
        endpointHostId: 9,
        endpointIP: "10.0.0.9",
        endpointSSHPort: 22,
        sourcePort: 8080,
        endpointPort: 5432,
      }),
      0,
      { throwOnError: true },
    );

    expect(runtime).not.toBeNull();
    expect(mock.sshConnections).toHaveLength(2);
    const [source, endpoint] = mock.sshConnections;
    expect(source.host).toBe(7);
    expect(source.options?.purpose).toBe("tunnel");
    expect(source.options?.sock).toBeUndefined();

    expect(client.forwardOut.mock.calls[0].slice(2, 4)).toEqual([
      "10.0.0.9",
      22,
    ]);
    expect(endpoint.host).toBe(9);
    expect(endpoint.options?.purpose).toBe("tunnel");
    expect(endpoint.options?.sock).toBe(client.channels[0]);
    // Remote mode binds on the endpoint leg.
    expect(client.forwardIn).toHaveBeenCalledWith(
      "127.0.0.1",
      5432,
      expect.any(Function),
    );
  });
});

describe("local listeners", () => {
  it("reports the kernel-assigned port, never the requested 0", async () => {
    setup();
    const runtime = await manager!.connect(config(), 0, {
      throwOnError: true,
    });

    expect(runtime!.bindPort).toBeGreaterThan(0);
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(runtime!.bindPort, "127.0.0.1", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", reject);
    });
    expect(manager!.statuses.get(config().name)?.status).toBe("connected");
  });

  it("honours a fixed source port", async () => {
    setup();
    const probe = net.createServer();
    const wanted = await new Promise<number>((resolve) => {
      probe.listen(0, "127.0.0.1", () =>
        resolve((probe.address() as { port: number }).port),
      );
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const runtime = await manager!.connect(
      config({ name: "web:7:fixed", sourcePort: wanted }),
      0,
      { throwOnError: true },
    );
    expect(runtime!.bindPort).toBe(wanted);
  });

  it("closes an idle tunnel and drops its runtime entry", async () => {
    setup();
    await manager!.connect(
      config({ name: "web:7:idle", idleTimeoutMs: 60 }),
      0,
      { throwOnError: true },
    );
    expect(manager!.runtimes.has("web:7:idle")).toBe(true);

    await vi.waitFor(
      () => expect(manager!.runtimes.has("web:7:idle")).toBe(false),
      { timeout: 4000, interval: 25 },
    );
  });

  it("leaves a tunnel with no idle timeout running", async () => {
    setup();
    await manager!.connect(config({ name: "web:7:forever" }), 0, {
      throwOnError: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(manager!.runtimes.has("web:7:forever")).toBe(true);
  });
});

describe("failures and stops", () => {
  it("reports an auth failure without retrying and tells automations", async () => {
    const { mock } = setup();
    const connect = vi
      .spyOn(mock.ctx.ssh, "connect")
      .mockRejectedValue(
        new Error("All configured authentication methods failed"),
      );

    await manager!.connect(config());

    const status = manager!.statuses.get(config().name);
    expect(status?.status).toBe("failed");
    expect(status?.errorType).toBe("AUTHENTICATION_FAILED");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(mock.emitted).toContainEqual({
      topic: "plugin.tunnels.tunnel_disconnected",
      payload: {
        userId: "user-1",
        hostId: 7,
        tunnelName: config().name,
      },
    });
  });

  it("stops on request and holds off an immediate reconnect", async () => {
    const { mock } = setup();
    manager!.configs.set(config().name, config());
    await manager!.connect(config(), 0, { throwOnError: true });

    await manager!.stop(config().name);

    expect(manager!.runtimes.has(config().name)).toBe(false);
    expect(manager!.statuses.get(config().name)).toMatchObject({
      status: "disconnected",
      manualDisconnect: true,
    });
    expect(await manager!.connect(config())).toBeNull();
    expect(
      mock.emitted.some(
        (event) => event.topic === "plugin.tunnels.tunnel_disconnected",
      ),
    ).toBe(false);
  });

  it("only shows a user the tunnels on hosts they can reach", async () => {
    setup();
    manager!.configs.set(config().name, config());
    await manager!.connect(config(), 0, { throwOnError: true });

    expect(Object.keys(await manager!.statusesFor("user-1"))).toEqual([
      config().name,
    ]);
    expect(await manager!.statusesFor("user-2")).toEqual({});
  });
});
