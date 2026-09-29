import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const main = readFileSync(
  new URL("../../../../electron/main.cjs", import.meta.url),
  "utf8",
);
const section = (from: string, to: string) =>
  main.slice(main.indexOf(from), main.indexOf(to, main.indexOf(from)));
function setup() {
  const sockets: Socket[] = [];
  class Socket extends EventEmitter {
    readyState = 1;
    send = vi.fn();
    close = vi.fn(() => {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit("close");
    });
    constructor() {
      super();
      sockets.push(this);
      queueMicrotask(() => this.emit("open"));
    }
    ready() {
      this.emit(
        "message",
        Buffer.from(JSON.stringify({ type: "ready" })),
        false,
      );
    }
  }
  const runtimes = new Map();
  let incoming!: (socket: EventEmitter) => void;
  const server = Object.assign(new EventEmitter(), {
    listen: (_options: unknown, ready: () => void) => ready(),
    close: vi.fn((done?: () => void) => done?.()),
  });
  const headers = vi.fn(async () => ({}));
  const dynamic = vi.fn();
  const context = vm.createContext({
    setTimeout,
    clearTimeout,
    WebSocket: Socket,
    crypto: { randomUUID: () => "runtime-token" },
    net: {
      createServer: (callback: typeof incoming) => {
        incoming = callback;
        return server;
      },
    },
    c2sTunnelRuntimes: runtimes,
    normalizeC2STunnelAddresses: (t: unknown) => t,
    resolveC2SRemoteSourceHost: async (t: unknown) => t,
    getC2STunnelName: (t: { name: string }) => t.name,
    getC2SLocalAddress: () => "127.0.0.1",
    getC2SRemoteAddress: () => "127.0.0.1",
    getC2SRelayUrl: () => "wss://server/relay",
    getC2SRelayHeaders: headers,
    getWebSocketOptions: (_url: string, options: unknown) => options,
    attachC2SAuth: vi.fn(),
    logToFile: vi.fn(),
    emitC2STunnelStatuses: vi.fn(),
    checkLocalPortAvailable: async () => ({ available: true }),
    handleC2SDynamicConnection: dynamic,
    setC2STunnelStatus: (name: string, status: unknown) => {
      runtimes.get(name).status = status;
    },
    setC2STunnelError: (name: string, error: string) => {
      runtimes.get(name).status = { connected: false, reason: error };
    },
    createC2SFailure: (error: string) => ({ success: false, error }),
  });
  vm.runInContext(
    section("async function testC2SRelay(", "async function testC2STunnel(") +
      section("async function startC2STunnel(", "function stopAllC2STunnels("),
    context,
  );
  return {
    context,
    runtimes,
    sockets,
    server,
    headers,
    dynamic,
    incoming: () => incoming,
  };
}

describe("client tunnel runtime authentication", () => {
  it("holds preflight open, shares its runtime identity and token, and releases it when stopped", async () => {
    const { context, runtimes, sockets, server, headers, dynamic, incoming } =
      setup();
    const tunnel = {
      name: "socks",
      mode: "dynamic",
      sourceHostId: 7,
      sourcePort: 1080,
    };
    await context.startC2STunnel(tunnel, 0, "local-auth");
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const premature = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    incoming()(premature);
    expect(premature.destroy).toHaveBeenCalledOnce();
    expect(headers).toHaveBeenCalledWith("wss://server/relay", "local-auth");
    expect(JSON.parse(sockets[0].send.mock.calls[0][0])).toMatchObject({
      keepAlive: true,
      tunnelConfig: { sessionId: "runtime-token" },
    });
    sockets[0].ready();
    await vi.waitFor(() =>
      expect(runtimes.get("socks").status.connected).toBe(true),
    );
    expect(sockets[0].close).not.toHaveBeenCalled();
    const client = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    incoming()(client);
    expect(dynamic).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "runtime-token" }),
      client,
      "local-auth",
    );
    await context.stopC2STunnel("socks");
    expect(sockets[0].close).toHaveBeenCalledOnce();
    expect(client.destroy).toHaveBeenCalledOnce();
    expect(server.close).toHaveBeenCalledOnce();
    expect(runtimes.size).toBe(0);
  });

  it("does not retain a socket for a standalone test or a stopped runtime", async () => {
    const { context, sockets } = setup();
    const test = context.testC2SRelay({ name: "test" });
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0].ready();
    expect(await test).toEqual({ success: true });
    expect(sockets[0].close).toHaveBeenCalledOnce();
    expect(
      await context.testC2SRelay({ name: "stopped" }, null, null, null, {}),
    ).toEqual({ success: false, error: "Tunnel stopped" });
    expect(sockets).toHaveLength(1);
  });
});
