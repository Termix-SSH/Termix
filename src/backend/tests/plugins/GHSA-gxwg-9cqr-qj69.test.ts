/**
 * Plugin sockets follow the same session rules as HTTP: setup only sessions,
 * pending second factor tokens and plugin minted sessions reach exactly what
 * they may reach over HTTP.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";

type Payload = {
  userId: string;
  sessionId?: string;
  pendingTOTP?: boolean;
  restriction?: string | null;
  pluginSession?: boolean;
};

const state = vi.hoisted(() => ({
  tokens: new Map<string, Payload>(),
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
vi.mock("../../auth/registry.js", () => ({
  listSecondFactors: () => [{ pluginId: "keys" }],
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

const ws = await import("../../plugins/ws.js");
const socketSessions = await import("../../auth/socket-sessions.js");
const { sessionAccessRefusal } = await import("../../auth/session-access.js");

let server: http.Server;
let baseUrl = "";

function outcome(token: string, path: string) {
  return new Promise<number | "open">((resolve) => {
    const socket = new WebSocket(`${baseUrl}${path}`, [`termix.jwt.${token}`]);
    socket.once("open", () => {
      socket.close();
      resolve("open");
    });
    socket.once("unexpected-response", (_req, res) =>
      resolve(res.statusCode ?? 0),
    );
    socket.once("error", () => resolve(0));
  });
}

beforeEach(async () => {
  state.tokens = new Map<string, Payload>([
    ["normal", { userId: "u", sessionId: "s-normal" }],
    [
      "setup",
      { userId: "u", sessionId: "s-setup", restriction: "second-factor-setup" },
    ],
    ["pending", { userId: "u", pendingTOTP: true }],
    ["pending-session", { userId: "u", sessionId: "s-p", pendingTOTP: true }],
    ["plugin", { userId: "u", sessionId: "s-plugin", pluginSession: true }],
  ]);
  socketSessions.resetSocketSessions();
  socketSessions.setSocketSessionStore({
    findSessions: async () => [],
    touch: async () => {},
    extend: async () => {},
    revoke: async () => {},
    apiKeyUsable: async () => true,
  });
  ws.resetPluginWebSockets();
  for (const plugin of ["terminal-like", "keys"]) {
    ws.registerPluginWsRoute(plugin, "/live", () => {}, ["network:serve"]);
  }
  server = http.createServer();
  ws.attachPluginWebSockets(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  ws.resetPluginWebSockets();
  socketSessions.resetSocketSessions();
  await new Promise((resolve) => server.close(() => resolve(undefined)));
});

describe("GHSA-gxwg-9cqr-qj69 sockets use the HTTP session rules", () => {
  it("refuses a setup only session on an ordinary plugin socket", async () => {
    expect(await outcome("setup", "/plugin-ws/terminal-like/live")).toBe(401);
  });

  it("lets a setup only session reach a second factor plugin's socket", async () => {
    expect(await outcome("setup", "/plugin-ws/keys/live")).toBe("open");
  });

  it("refuses a token still waiting for its second factor", async () => {
    expect(await outcome("pending", "/plugin-ws/terminal-like/live")).toBe(401);
    expect(
      await outcome("pending-session", "/plugin-ws/terminal-like/live"),
    ).toBe(401);
  });

  it("refuses a plugin minted session on a second factor plugin's socket", async () => {
    expect(await outcome("plugin", "/plugin-ws/keys/live")).toBe(401);
    expect(await outcome("plugin", "/plugin-ws/terminal-like/live")).toBe(
      "open",
    );
  });

  it("serves a normal session", async () => {
    expect(await outcome("normal", "/plugin-ws/terminal-like/live")).toBe(
      "open",
    );
  });

  it("gives HTTP and socket paths of one plugin the same answer", () => {
    const sessions: Payload[] = [...state.tokens.values()];
    for (const session of sessions) {
      for (const plugin of ["keys", "terminal-like"]) {
        expect(
          !!sessionAccessRefusal(session, `/plugin-ws/${plugin}/live`),
        ).toBe(!!sessionAccessRefusal(session, `/plugin-api/${plugin}/live`));
      }
    }
  });
});
