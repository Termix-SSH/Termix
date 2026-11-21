import net from "node:net";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

const mocks = vi.hoisted(() => ({
  resolveHostById: vi.fn(),
  openSshTransport: vi.fn(),
  logAudit: vi.fn(),
  handler: null as null | ((connection: unknown) => Promise<void>),
}));

vi.mock("../../utils/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { sshLogger: log, logger: log, pluginLogger: log };
});
vi.mock("../../utils/audit-logger.js", () => ({
  getAuditUsername: async (id: string) => id,
  logAudit: mocks.logAudit,
}));
vi.mock("../../hosts/host-resolver.js", () => ({
  resolveHostById: mocks.resolveHostById,
  resolveHostBySyncId: vi.fn(),
}));
vi.mock("../../hosts/connect/transport.js", () => ({
  openSshTransport: mocks.openSshTransport,
}));
vi.mock("../../plugins/ws.js", () => ({
  registerCoreWsRoute: (_path: string, handler: never) => {
    mocks.handler = handler;
    return () => {};
  },
}));

const { registerSshRelay } = await import("../../hosts/ssh-relay.js");
const { provideConnectPolicy, clearConnectPolicies } =
  await import("../../hosts/connect-policy.js");

let echo: net.Server;
let relayServer: http.Server;
let wss: WebSocketServer;
let relayUrl = "";

beforeEach(async () => {
  vi.clearAllMocks();
  clearConnectPolicies();
  registerSshRelay();

  echo = net.createServer((socket) => {
    socket.on("error", () => {});
    socket.pipe(socket);
  });
  await new Promise<void>((resolve) => echo.listen(0, "127.0.0.1", resolve));
  const echoPort = (echo.address() as AddressInfo).port;

  relayServer = http.createServer();
  wss = new WebSocketServer({ server: relayServer });
  wss.on("connection", (socket, request) => {
    void mocks.handler?.({ userId: "user-1", request, socket });
  });
  await new Promise<void>((resolve) =>
    relayServer.listen(0, "127.0.0.1", resolve),
  );
  relayUrl = `ws://127.0.0.1:${(relayServer.address() as AddressInfo).port}`;

  mocks.resolveHostById.mockResolvedValue({
    id: 5,
    ip: "127.0.0.1",
    port: echoPort,
  });
  mocks.openSshTransport.mockResolvedValue({ jumpClient: null, via: "direct" });
});

afterEach(async () => {
  clearConnectPolicies();
  wss.close();
  await new Promise((resolve) => relayServer.close(resolve));
  await new Promise((resolve) => echo.close(resolve));
});

function open(query: string) {
  return new Promise<{
    socket: WebSocket;
    closed: Promise<{ code: number; reason: string }>;
  }>((resolve) => {
    const socket = new WebSocket(`${relayUrl}/${query}`);
    const closed = new Promise<{ code: number; reason: string }>((done) =>
      socket.once("close", (code, reason) =>
        done({ code, reason: reason.toString() }),
      ),
    );
    socket.once("open", () => resolve({ socket, closed }));
  });
}

describe("GHSA-h4fm-j6pg-g43x", () => {
  it("asks connect policies before the relay opens a connection", async () => {
    const check = vi.fn(async () => ({
      decision: "deny" as const,
      reason: "Outside hours",
    }));
    provideConnectPolicy("hours", { check });

    const { closed } = await open("?hostId=5");

    expect(await closed).toMatchObject({
      code: 1008,
      reason: "Connection not allowed",
    });
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", hostId: 5, protocol: "ssh" }),
    );
    expect(mocks.openSshTransport).not.toHaveBeenCalled();
  });

  it("still relays when every policy allows", async () => {
    provideConnectPolicy("hours", {
      check: async () => ({ decision: "allow" as const }),
    });

    const { socket } = await open("?hostId=5");
    const received = new Promise<string>((resolve) =>
      socket.once("message", (data) => resolve(data.toString())),
    );
    socket.send("ping");
    expect(await received).toBe("ping");
    socket.close();
  });
});
