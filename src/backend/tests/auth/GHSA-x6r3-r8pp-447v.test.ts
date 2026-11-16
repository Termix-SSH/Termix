/**
 * A socket is tied to the login that opened it: revoking, expiring or idling
 * out that login closes the socket. Real ws server, real session table.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocket } from "ws";

const state = vi.hoisted(() => ({
  tokens: new Map<
    string,
    { userId: string; sessionId: string; apiKeyId?: string }
  >(),
}));

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      verifyJWTToken: async (token: string) => state.tokens.get(token) ?? null,
    }),
  },
}));
vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: { getUserDataKey: () => Buffer.from("key") },
}));
vi.mock("../../plugins/permissions.js", () => ({
  hasCapability: async () => true,
}));

const { TestSqliteDatabase } =
  await import("../database/repositories/test-support.js");
const { SessionRepository } =
  await import("../../database/repositories/session-repository.js");
const { ApiKeyRepository } =
  await import("../../database/repositories/api-key-repository.js");
const { UserRepository } =
  await import("../../database/repositories/user-repository.js");
const ws = await import("../../plugins/ws.js");
const socketSessions = await import("../../auth/socket-sessions.js");

const USER = "user-1";
let adapter: InstanceType<typeof TestSqliteDatabase>;
let sessions: InstanceType<typeof SessionRepository>;
let apiKeys: InstanceType<typeof ApiKeyRepository>;
let server: http.Server;
let baseUrl = "";
const rawSockets: Duplex[] = [];
const publicUsers: string[] = [];

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function addSession(
  id: string,
  fields: Partial<{
    expiresAt: string;
    lastActiveAt: string;
    idleTimeout: number | null;
  }> = {},
) {
  await sessions.create({
    id,
    userId: USER,
    jwtToken: `token-${id}`,
    deviceType: "web",
    deviceInfo: "test",
    createdAt: iso(0),
    expiresAt: fields.expiresAt ?? iso(3_600_000),
    lastActiveAt: fields.lastActiveAt ?? iso(0),
    idleTimeout: fields.idleTimeout ?? null,
  });
  state.tokens.set(`tok-${id}`, { userId: USER, sessionId: id });
}

function open(token: string, path = "/plugin-ws/sample/live") {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(`${baseUrl}${path}`, [`termix.jwt.${token}`]);
    socket.once("open", () => resolve(socket));
    socket.once("unexpected-response", (_req, res) =>
      reject(new Error(`refused ${res.statusCode}`)),
    );
    socket.once("error", reject);
  });
}

function closed(socket: WebSocket) {
  return new Promise<number>((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve(1006);
    socket.once("close", (code) => resolve(code));
  });
}

async function stillOpen(socket: WebSocket) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return socket.readyState === WebSocket.OPEN;
}

beforeEach(async () => {
  state.tokens.clear();
  adapter = new TestSqliteDatabase();
  const context = await adapter.connect();
  sessions = new SessionRepository(context);
  apiKeys = new ApiKeyRepository(context);
  await new UserRepository(context).create({
    id: USER,
    username: "user",
    passwordHash: "hash",
    isAdmin: false,
  });
  socketSessions.resetSocketSessions();
  socketSessions.setSocketSessionStore({
    findSessions: (ids) => sessions.findManyByIds(ids),
    touch: (id) => sessions.touch(id, new Date().toISOString(), 0),
    extend: (id, expiresAt) => sessions.extendExpiry(id, expiresAt),
    revoke: (id) => sessions.revoke(id),
    apiKeyUsable: async (keyId, userId) => {
      const key = await apiKeys.findById(keyId);
      return !!key && key.isActive && key.userId === userId;
    },
  });

  ws.resetPluginWebSockets();
  ws.registerPluginWsRoute(
    "sample",
    "/live",
    ({ socket }) => {
      socket.on("message", (data) => socket.send(`echo:${String(data)}`));
    },
    ["network:serve"],
  );
  ws.registerPluginWsUpgrade(
    "sample",
    "/raw",
    (_request, socket) => {
      rawSockets.push(socket);
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
    },
    ["network:serve"],
  );
  ws.registerPluginWsUpgrade(
    "sample",
    "/display",
    (_request, socket, _head, userId) => {
      publicUsers.push(userId);
      rawSockets.push(socket);
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
    },
    ["network:serve"],
    { public: true },
  );
  server = http.createServer();
  ws.attachPluginWebSockets(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  ws.resetPluginWebSockets();
  socketSessions.resetSocketSessions();
  rawSockets.length = 0;
  publicUsers.length = 0;
  await new Promise((resolve) => server.close(() => resolve(undefined)));
  await adapter.close();
});

describe("GHSA-x6r3-r8pp-447v sockets end with their session", () => {
  it("closes the socket when its session is revoked", async () => {
    await addSession("s1");
    const socket = await open("tok-s1");
    const done = closed(socket);
    await sessions.revoke("s1");
    expect(await done).toBe(1008);
  });

  it("closes every socket of a user on revoke all, but the kept session", async () => {
    await addSession("s1");
    await addSession("s2");
    const first = await open("tok-s1");
    const kept = await open("tok-s2");
    const done = closed(first);
    await sessions.revokeAllForUser(USER, "s2");
    expect(await done).toBe(1008);
    expect(await stillOpen(kept)).toBe(true);
    kept.close();
  });

  it("closes the socket when the session row is gone another way", async () => {
    await addSession("s1");
    const socket = await open("tok-s1");
    const done = closed(socket);
    await adapter.run("DELETE FROM sessions WHERE id = 's1'");
    await socketSessions.sweepSocketSessions();
    expect(await done).toBe(1008);
  });

  it("closes the socket when its session expires", async () => {
    await addSession("s1", { expiresAt: iso(200) });
    const socket = await open("tok-s1");
    expect(await stillOpen(socket)).toBe(true);
    const done = closed(socket);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await socketSessions.sweepSocketSessions();
    expect(await done).toBe(1008);
  });

  it("closes an idle socket and ends the idle session", async () => {
    await addSession("s1", { idleTimeout: 60, lastActiveAt: iso(-120_000) });
    const socket = await open("tok-s1");
    const done = closed(socket);
    await socketSessions.sweepSocketSessions();
    expect(await done).toBe(1008);
    expect(await sessions.findById("s1")).toBeNull();
  });

  it("keeps an active socket's session from idling out", async () => {
    await addSession("s1", { idleTimeout: 60, lastActiveAt: iso(-120_000) });
    const socket = await open("tok-s1");
    socket.send("ls");
    await new Promise((resolve) => socket.once("message", resolve));
    await socketSessions.sweepSocketSessions();
    expect(await stillOpen(socket)).toBe(true);
    const row = await sessions.findById("s1");
    expect(new Date(row!.lastActiveAt).getTime()).toBeGreaterThan(
      Date.now() - 5_000,
    );
    socket.close();
  });

  it("destroys a raw upgrade socket when its session is revoked", async () => {
    await addSession("s1");
    const socket = new WebSocket(`${baseUrl}/plugin-ws/sample/raw`, [
      "termix.jwt.tok-s1",
    ]);
    socket.on("error", () => {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(rawSockets).toHaveLength(1);
    const gone = new Promise((resolve) => rawSockets[0].once("close", resolve));
    await sessions.revoke("s1");
    await gone;
    expect(rawSockets[0].destroyed).toBe(true);
  });

  it("ends a public socket with the login that opened it, without naming the user", async () => {
    await addSession("s1");
    const socket = new WebSocket(`${baseUrl}/plugin-ws/sample/display`, [
      "termix.jwt.tok-s1",
    ]);
    socket.on("error", () => {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(publicUsers).toEqual([""]);
    const gone = new Promise((resolve) => rawSockets[0].once("close", resolve));
    await sessions.revoke("s1");
    await gone;
    expect(rawSockets[0].destroyed).toBe(true);
  });

  it("keeps an API key socket alive while the key is valid, then ends it with the key", async () => {
    await apiKeys.create({
      id: "key-1",
      userId: USER,
      name: "cli",
      tokenHash: "hash",
      tokenPrefix: "tmx_abcd",
    });
    await addSession("carrier", { expiresAt: iso(30_000) });
    state.tokens.set("tok-key", {
      userId: USER,
      sessionId: "carrier",
      apiKeyId: "key-1",
    });
    const socket = await open("tok-key");

    await socketSessions.sweepSocketSessions();
    const row = await sessions.findById("carrier");
    expect(new Date(row!.expiresAt).getTime()).toBeGreaterThan(
      Date.now() + 90_000,
    );
    expect(await stillOpen(socket)).toBe(true);

    const done = closed(socket);
    await apiKeys.delete("key-1");
    expect(await done).toBe(1008);
  });

  it("refuses a new socket for a revoked session", async () => {
    await addSession("s1");
    await sessions.revoke("s1");
    state.tokens.delete("tok-s1");
    await expect(open("tok-s1")).rejects.toThrow("refused 401");
  });
});
