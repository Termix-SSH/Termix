/**
 * /plugin-api and /plugin-ws: auth unless declared public, 503 for an
 * installed plugin that is off, no stack in an error, public routes listed
 * for admins, and an anonymous caller who cannot spend a plugin's error
 * budget.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import httpModule from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { WebSocket } from "ws";

const state = vi.hoisted(() => ({
  validToken: "valid-token",
  userId: "user-1",
  installed: new Set<string>(),
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../utils/logger.js", () => {
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  };
  return { pluginLogger: log, databaseLogger: log };
});

vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          const header = req.headers.authorization;
          if (header !== `Bearer ${state.validToken}`) {
            res.status(401).json({ error: "Unauthorized" });
            return;
          }
          (req as express.Request & { userId?: string }).userId = state.userId;
          next();
        },
      verifyJWTToken: async (token: string) =>
        token === state.validToken ? { userId: state.userId } : null,
    }),
  },
}));
vi.mock("../../../utils/data-crypto.js", () => ({
  DataCrypto: { getUserDataKey: () => Buffer.from("key") },
}));
vi.mock("../../../plugins/permissions.js", () => ({
  hasCapability: async () => true,
}));
vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    state.audits.push(entry);
  },
}));

const http = await import("../../../plugins/http.js");
const ws = await import("../../../plugins/ws.js");
const { getActor } = await import("../../../plugins/actor.js");
const { mountPluginApi } =
  await import("../../../database/routes/plugin-api-routes.js");

const manifest = {
  id: "sample",
  name: "Sample",
  version: "1.0.0",
  capabilities: ["network:serve"],
} as never;

let server: Server | null = null;

async function start(): Promise<{ httpBase: string; wsBase: string }> {
  const app = express();
  mountPluginApi(app);
  const instance = httpModule.createServer(app);
  ws.attachPluginWebSockets(instance);
  server = instance;
  return new Promise((resolve) => {
    instance.listen(0, "127.0.0.1", () => {
      const { port } = instance.address() as AddressInfo;
      resolve({
        httpBase: `http://127.0.0.1:${port}`,
        wsBase: `ws://127.0.0.1:${port}`,
      });
    });
  });
}

function upgrade(
  url: string,
  protocols: string[] = [],
): Promise<"open" | number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, protocols);
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

beforeEach(() => {
  http.resetPluginHttp();
  ws.resetPluginWebSockets();
  state.installed = new Set();
  state.audits = [];
  http.setPluginInstalledCheck((id) => state.installed.has(id));
});

afterEach(async () => {
  ws.resetPluginWebSockets();
  if (server) {
    await new Promise((resolve) => server!.close(() => resolve(undefined)));
    server = null;
  }
});

describe("auth by default", () => {
  it("refuses an HTTP route and a socket without a login", async () => {
    const router = http.createPluginRouter({ manifest, reportError: () => {} });
    router.get("/private", (_req, res) => res.json({ ok: true }));
    ws.registerPluginWsRoute("sample", "/socket", () => {}, ["network:serve"]);
    const { httpBase, wsBase } = await start();

    expect((await fetch(`${httpBase}/plugin-api/sample/private`)).status).toBe(
      401,
    );
    expect(await upgrade(`${wsBase}/plugin-ws/sample/socket`)).toBe(401);
  });

  it("gives a public socket's guest no actor at all", async () => {
    let actor: string | undefined = "unset";
    ws.registerPluginWsRoute(
      "sample",
      "/guest",
      ({ socket }) => {
        actor = getActor();
        (socket as WebSocket).close();
      },
      ["network:serve"],
      { public: true },
    );
    const { wsBase } = await start();
    await upgrade(`${wsBase}/plugin-ws/sample/guest`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(actor).toBeUndefined();
  });
});

describe("a disabled plugin", () => {
  it("answers 503 on HTTP and on a socket once its routes are gone", async () => {
    state.installed.add("sample");
    const { httpBase, wsBase } = await start();

    const response = await fetch(`${httpBase}/plugin-api/sample/anything`);
    expect(response.status).toBe(503);
    expect(await upgrade(`${wsBase}/plugin-ws/sample/socket`)).toBe(503);
  });

  it("answers 404 for an id nobody installed", async () => {
    const { httpBase, wsBase } = await start();
    expect((await fetch(`${httpBase}/plugin-api/ghost/x`)).status).toBe(404);
    expect(await upgrade(`${wsBase}/plugin-ws/ghost/socket`)).toBe(404);
  });
});

describe("errors", () => {
  it("hides the stack and the message", async () => {
    const router = http.createPluginRouter({ manifest, reportError: () => {} });
    router.get("/boom", () => {
      throw new Error("secret detail at /srv/termix/keys");
    });
    const { httpBase } = await start();
    const response = await fetch(`${httpBase}/plugin-api/sample/boom`, {
      headers: { Authorization: `Bearer ${state.validToken}` },
    });
    const body = await response.text();
    expect(response.status).toBe(500);
    expect(body).not.toMatch(/secret detail|at \//);
  });

  it("does not let an anonymous caller spend the error budget", async () => {
    const reported: unknown[] = [];
    const router = http.createPluginRouter({
      manifest,
      options: { public: ["/hook", "/throws"] },
      reportError: (error) => reported.push(error),
    });
    router.post("/hook", (_req, res) => res.json({ ok: true }));
    router.get("/throws", () => {
      throw new Error("bad input");
    });
    const { httpBase } = await start();

    for (let i = 0; i < 6; i++) {
      const junk = await fetch(`${httpBase}/plugin-api/sample/hook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      });
      expect(junk.status).toBe(400);
      await fetch(`${httpBase}/plugin-api/sample/throws`);
    }
    expect(reported).toEqual([]);
  });

  it("still counts a signed-in caller's server error", async () => {
    const reported: unknown[] = [];
    const router = http.createPluginRouter({
      manifest,
      reportError: (error) => reported.push(error),
    });
    router.get("/boom", () => {
      throw new Error("real bug");
    });
    const { httpBase } = await start();
    await fetch(`${httpBase}/plugin-api/sample/boom`, {
      headers: { Authorization: `Bearer ${state.validToken}` },
    });
    expect(reported).toHaveLength(1);
  });
});

describe("public routes are visible", () => {
  it("lists them for the admin details and audits a public socket", async () => {
    http.createPluginRouter({
      manifest,
      options: { public: ["/callback", "/u/:handle"] },
      reportError: () => {},
    });
    ws.registerPluginWsRoute("sample", "/guest", () => {}, ["network:serve"], {
      public: true,
    });
    ws.registerPluginWsRoute("sample", "/private", () => {}, ["network:serve"]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(http.getPluginPublicHttpRoutes("sample")).toEqual([
      "/callback",
      "/u/:handle",
    ]);
    expect(ws.getPluginPublicWsRoutes("sample")).toEqual(["/guest"]);
    expect(
      state.audits.some(
        (entry) =>
          entry.action === "plugin_ws_public_route" &&
          entry.resourceId === "sample",
      ),
    ).toBe(true);

    http.unregisterPluginHttp("sample");
    expect(http.getPluginPublicHttpRoutes("sample")).toEqual([]);
  });
});
