/**
 * ctx.ws: the one way a plugin serves WebSockets.
 *
 * The properties that matter are the ones the per-plugin ports used to leave
 * to each plugin: an upgrade is authenticated before any plugin code runs, a
 * route that no longer exists refuses cleanly, and disabling a plugin actually
 * closes its live sockets rather than just unrouting new ones.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";

const state = vi.hoisted(() => ({
  validToken: "valid-token",
  userId: "user-1",
  granted: new Set<string>(["network:serve"]),
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
      verifyJWTToken: async (token: string) =>
        token === state.validToken ? { userId: state.userId } : null,
    }),
  },
}));

vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: {
    getUserDataKey: (userId: string) =>
      userId === state.userId ? Buffer.from("key") : null,
  },
}));

vi.mock("../../plugins/permissions.js", () => ({
  hasCapability: async (
    _pluginId: string,
    capability: string,
    declared: readonly string[],
  ) => declared.includes(capability) && state.granted.has(capability),
}));

const ws = await import("../../plugins/ws.js");

const DECLARED = ["network:serve"] as const;

let server: http.Server | null = null;
let baseUrl = "";

async function startServer(): Promise<string> {
  const instance = http.createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  ws.attachPluginWebSockets(instance);

  return new Promise((resolve) => {
    server = instance;
    instance.listen(0, "127.0.0.1", () => {
      const { port } = instance.address() as AddressInfo;
      baseUrl = `ws://127.0.0.1:${port}`;
      resolve(baseUrl);
    });
  });
}

/** Resolves with "open" or the HTTP status the upgrade was refused with. */
function connect(
  url: string,
  protocols: string[] = [],
): Promise<{ outcome: "open"; socket: WebSocket } | { outcome: number }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, protocols);
    socket.once("open", () => resolve({ outcome: "open", socket }));
    socket.once("unexpected-response", (_req, res) =>
      resolve({ outcome: res.statusCode ?? 0 }),
    );
    socket.once("error", () => resolve({ outcome: 0 }));
  });
}

function authProtocols(token: string): string[] {
  return [`termix.jwt.${token}`];
}

beforeEach(() => {
  ws.resetPluginWebSockets();
  state.granted = new Set(["network:serve"]);
});

afterEach(async () => {
  ws.resetPluginWebSockets();
  if (server) {
    await new Promise((resolve) => server!.close(() => resolve(undefined)));
    server = null;
  }
});

describe("ctx.ws routing", () => {
  it("serves a registered route to an authenticated client", async () => {
    const seen: string[] = [];
    ws.registerPluginWsRoute(
      "sample-plugin",
      "/socket",
      ({ userId, socket }) => {
        seen.push(userId);
        (socket as WebSocket).send("hello");
      },
      DECLARED,
    );

    const base = await startServer();
    const result = await connect(
      `${base}/plugin-ws/sample-plugin/socket`,
      authProtocols(state.validToken),
    );

    expect(result.outcome).toBe("open");
    expect(seen).toEqual([state.userId]);
    if (result.outcome === "open") result.socket.close();
  });

  it("404s a path nothing registered", async () => {
    const base = await startServer();

    const result = await connect(`${base}/plugin-ws/sample-plugin/missing`);

    expect(result.outcome).toBe(404);
  });

  it("leaves non-plugin upgrades to whoever else is listening", async () => {
    let claimedByCore = false;

    const base = await startServer();
    // A second listener standing in for a core WS server. If the plugin
    // handler answered /ssh/websocket/ itself this would never fire, and the
    // socket would be stolen from core rather than passed on.
    server!.on("upgrade", (_req, socket) => {
      claimedByCore = true;
      socket.destroy();
    });

    await connect(`${base}/ssh/websocket/`);

    expect(claimedByCore).toBe(true);
  });
});

describe("ctx.ws authentication", () => {
  it("rejects an upgrade with no token", async () => {
    ws.registerPluginWsRoute("sample-plugin", "/socket", () => {}, DECLARED);

    const base = await startServer();
    const result = await connect(`${base}/plugin-ws/sample-plugin/socket`);

    expect(result.outcome).toBe(401);
  });

  it("rejects an upgrade with a bad token", async () => {
    ws.registerPluginWsRoute("sample-plugin", "/socket", () => {}, DECLARED);

    const base = await startServer();
    const result = await connect(
      `${base}/plugin-ws/sample-plugin/socket`,
      authProtocols("nope"),
    );

    expect(result.outcome).toBe(401);
  });

  it("serves a public route without a token", async () => {
    ws.registerPluginWsRoute(
      "sample-plugin",
      "/guest",
      ({ socket }) => (socket as WebSocket).send("hi"),
      DECLARED,
      { public: true },
    );

    const base = await startServer();
    const result = await connect(`${base}/plugin-ws/sample-plugin/guest`);

    expect(result.outcome).toBe("open");
    if (result.outcome === "open") result.socket.close();
  });
});

describe("ctx.ws optional auth", () => {
  function register(seen: Array<Record<string, unknown>>) {
    ws.registerPluginWsRoute(
      "sample-plugin",
      "/mixed",
      (connection) => {
        seen.push({
          userId: connection.userId,
          unlocked: connection.isDataUnlocked(),
          clientIp: connection.clientIp,
          requestOrigin: connection.requestOrigin,
        });
        (connection.socket as WebSocket).send("hi");
      },
      DECLARED,
      { public: true, optionalAuth: true },
    );
  }

  it("names the user when a valid token came with the upgrade", async () => {
    const seen: Array<Record<string, unknown>> = [];
    register(seen);
    const base = await startServer();
    const result = await connect(
      `${base}/plugin-ws/sample-plugin/mixed`,
      authProtocols(state.validToken),
    );
    expect(result.outcome).toBe("open");
    expect(seen[0]).toMatchObject({ userId: state.userId, unlocked: true });
    expect(typeof seen[0].clientIp).toBe("string");
    expect(String(seen[0].requestOrigin)).toMatch(/^http/);
    if (result.outcome === "open") result.socket.close();
  });

  it("still serves a guest, with no user and nothing unlocked", async () => {
    const seen: Array<Record<string, unknown>> = [];
    register(seen);
    const base = await startServer();
    const result = await connect(
      `${base}/plugin-ws/sample-plugin/mixed`,
      authProtocols("nope"),
    );
    expect(result.outcome).toBe("open");
    expect(seen[0]).toMatchObject({ userId: "", unlocked: false });
    if (result.outcome === "open") result.socket.close();
  });
});

describe("ctx.ws capability", () => {
  it("refuses the upgrade when network:serve is not granted", async () => {
    ws.registerPluginWsRoute("sample-plugin", "/socket", () => {}, DECLARED);
    state.granted.delete("network:serve");

    const base = await startServer();
    const result = await connect(
      `${base}/plugin-ws/sample-plugin/socket`,
      authProtocols(state.validToken),
    );

    expect(result.outcome).toBe(403);
  });
});

describe("ctx.ws disposal", () => {
  it("closes live sockets and stops routing on deactivate", async () => {
    const dispose = ws.registerPluginWsRoute(
      "sample-plugin",
      "/socket",
      () => {},
      DECLARED,
    );

    const base = await startServer();
    const result = await connect(
      `${base}/plugin-ws/sample-plugin/socket`,
      authProtocols(state.validToken),
    );
    expect(result.outcome).toBe("open");

    const closed = new Promise<number>((resolve) => {
      if (result.outcome === "open") {
        result.socket.once("close", (code) => resolve(code));
      }
    });

    dispose();

    // A live terminal must not outlive the plugin that owns it.
    expect(await closed).toBeGreaterThan(0);

    const afterDispose = await connect(
      `${base}/plugin-ws/sample-plugin/socket`,
      authProtocols(state.validToken),
    );
    expect(afterDispose.outcome).toBe(404);
  });
});

describe("ctx.ws raw upgrades", () => {
  it("authenticates before handing the socket to the plugin", async () => {
    const handled: string[] = [];
    ws.registerPluginWsUpgrade(
      "sample-plugin",
      "/raw",
      (_request, socket, _head, userId) => {
        handled.push(userId);
        (socket as { destroy: () => void }).destroy();
      },
      DECLARED,
    );

    const base = await startServer();

    const unauthenticated = await connect(
      `${base}/plugin-ws/sample-plugin/raw`,
    );
    expect(unauthenticated.outcome).toBe(401);
    // The plugin never saw the unauthenticated attempt.
    expect(handled).toEqual([]);

    await connect(
      `${base}/plugin-ws/sample-plugin/raw`,
      authProtocols(state.validToken),
    );
    expect(handled).toEqual([state.userId]);
  });
});

describe("parsePluginWsUrl", () => {
  it("only claims well-formed plugin socket paths", () => {
    expect(ws.parsePluginWsUrl("/plugin-ws/docker/console")).toEqual({
      pluginId: "docker",
      path: "/console",
    });
    expect(ws.parsePluginWsUrl("/plugin-ws/docker/console?x=1")).toEqual({
      pluginId: "docker",
      path: "/console",
    });
    expect(ws.parsePluginWsUrl("/ssh/websocket/")).toBeNull();
    expect(ws.parsePluginWsUrl("/plugin-ws/docker")).toBeNull();
    expect(ws.parsePluginWsUrl(undefined)).toBeNull();
  });
});
