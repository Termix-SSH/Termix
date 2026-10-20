import net from "node:net";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

const mocks = vi.hoisted(() => ({
  resolveHostById: vi.fn(),
  openSshTransport: vi.fn(),
  handler: null as null | ((connection: unknown) => Promise<void>),
}));

vi.mock("../../utils/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { sshLogger: log, logger: log };
});
vi.mock("../../hosts/host-resolver.js", () => ({
  resolveHostById: mocks.resolveHostById,
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

let echo: net.Server;
let echoPort = 0;
let relayServer: http.Server;
let wss: WebSocketServer;
let relayUrl = "";

beforeEach(async () => {
  vi.clearAllMocks();
  registerSshRelay();

  echo = net.createServer((socket) => socket.pipe(socket));
  await new Promise<void>((resolve) => echo.listen(0, "127.0.0.1", resolve));
  echoPort = (echo.address() as AddressInfo).port;

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
  wss.close();
  await new Promise((resolve) => relayServer.close(resolve));
  await new Promise((resolve) => echo.close(resolve));
});

function open(query: string): Promise<{
  socket: WebSocket;
  closed: Promise<{ code: number; reason: string }>;
}> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${relayUrl}/${query}`);
    const closed = new Promise<{ code: number; reason: string }>((done) =>
      socket.once("close", (code, reason) =>
        done({ code, reason: reason.toString() }),
      ),
    );
    socket.once("open", () => resolve({ socket, closed }));
  });
}

describe("ssh relay", () => {
  it("carries bytes to the host and back", async () => {
    const { socket } = await open("?hostId=5");
    const received = new Promise<string>((resolve) =>
      socket.once("message", (data) => resolve(data.toString())),
    );
    socket.send(Buffer.from("SSH-2.0-test\r\n"));
    expect(await received).toBe("SSH-2.0-test\r\n");
    expect(mocks.resolveHostById).toHaveBeenCalledWith(5, "user-1");
    socket.close();
  });

  it("uses the stream the transport made, such as a jump host channel", async () => {
    const channel = new PassThrough();
    const end = vi.fn();
    mocks.openSshTransport.mockImplementation(
      async (_host: unknown, config: { sock?: unknown }) => {
        config.sock = channel;
        return { jumpClient: { end }, via: "jump" };
      },
    );
    const { socket } = await open("?hostId=5");
    const received = new Promise<string>((resolve) =>
      socket.once("message", (data) => resolve(data.toString())),
    );
    socket.send("ping");
    expect(await received).toBe("ping");
    socket.close();
    await vi.waitFor(() => expect(end).toHaveBeenCalled());
  });

  it("refuses a host the user can't connect to", async () => {
    mocks.resolveHostById.mockResolvedValue(null);
    const { closed } = await open("?hostId=5");
    expect(await closed).toMatchObject({
      code: 1008,
      reason: "Host not found or access denied",
    });
    expect(mocks.openSshTransport).not.toHaveBeenCalled();
  });

  it("needs a host id", async () => {
    const { closed } = await open("");
    expect((await closed).code).toBe(1008);
    expect(mocks.resolveHostById).not.toHaveBeenCalled();
  });

  it("closes the socket when the host can't be reached", async () => {
    mocks.openSshTransport.mockRejectedValue(new Error("no route"));
    const { closed } = await open("?hostId=5");
    expect((await closed).code).toBe(1000);
  });
});
