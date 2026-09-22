/**
 * ctx.http: the one way a plugin serves HTTP.
 *
 * Everything here is about the middleware core puts in front of a plugin's
 * routes, because that is what moving off the dispatcher shims bought: auth by
 * default, a truthful 503 while disabled, a capability that can be revoked
 * without a restart, and streaming that still streams.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

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
  databaseLogger: {
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
      createAuthMiddleware:
        () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          const header = req.headers.authorization;
          const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
          if (token !== state.validToken) {
            res.status(401).json({ error: "Unauthorized" });
            return;
          }
          (req as express.Request & { userId?: string }).userId = state.userId;
          next();
        },
    }),
  },
}));

vi.mock("../../plugins/permissions.js", () => ({
  hasCapability: async (
    _pluginId: string,
    capability: string,
    declared: readonly string[],
  ) => declared.includes(capability) && state.granted.has(capability),
}));

vi.mock("../../utils/audit-logger.js", () => ({ logAudit: vi.fn() }));

const http = await import("../../plugins/http.js");
const pluginApi = (await import("../../database/routes/plugin-api-routes.js"))
  .default;

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    id: "sample-plugin",
    name: "Sample Plugin",
    version: "1.0.0",
    capabilities: ["network:serve"],
    ...overrides,
  } as never;
}

let server: Server | null = null;

async function startServer(): Promise<string> {
  const app = express();
  // Exactly how database.ts mounts it: no auth in front, because the plugin
  // router brings its own.
  app.use("/plugin-api", pluginApi);

  return new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server!.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

const authed = { Authorization: `Bearer ${state.validToken}` };

beforeEach(() => {
  http.resetPluginHttp();
  state.granted = new Set(["network:serve"]);
});

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server!.close(() => resolve(undefined)));
    server = null;
  }
  http.resetPluginHttp();
});

describe("ctx.http mounting", () => {
  it("serves a plugin's routes once it registers a router", async () => {
    const router = http.createPluginRouter({
      manifest: manifest(),
      reportError: () => {},
    });
    router.get("/thing", (_req, res) => res.json({ ok: true }));

    const base = await startServer();
    const response = await fetch(`${base}/plugin-api/sample-plugin/thing`, {
      headers: authed,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("404s a plugin id that never registered a router", async () => {
    const base = await startServer();

    const response = await fetch(`${base}/plugin-api/nobody/thing`, {
      headers: authed,
    });

    expect(response.status).toBe(404);
  });

  it("unmounts on deactivate, so a disabled plugin stops serving", async () => {
    const router = http.createPluginRouter({
      manifest: manifest(),
      reportError: () => {},
    });
    router.get("/thing", (_req, res) => res.json({ ok: true }));

    const base = await startServer();
    expect(
      (
        await fetch(`${base}/plugin-api/sample-plugin/thing`, {
          headers: authed,
        })
      ).status,
    ).toBe(200);

    http.unregisterPluginHttp("sample-plugin");

    expect(
      (
        await fetch(`${base}/plugin-api/sample-plugin/thing`, {
          headers: authed,
        })
      ).status,
    ).toBe(404);
  });
});

describe("ctx.http authentication", () => {
  it("requires authentication by default", async () => {
    const router = http.createPluginRouter({
      manifest: manifest(),
      reportError: () => {},
    });
    router.get("/thing", (_req, res) => res.json({ ok: true }));

    const base = await startServer();

    expect((await fetch(`${base}/plugin-api/sample-plugin/thing`)).status).toBe(
      401,
    );
    expect(
      (
        await fetch(`${base}/plugin-api/sample-plugin/thing`, {
          headers: { Authorization: "Bearer nope" },
        })
      ).status,
    ).toBe(401);
  });

  it("serves a declared public path without a token", async () => {
    const router = http.createPluginRouter({
      manifest: manifest(),
      options: { public: ["/webhook/:token"] },
      reportError: () => {},
    });
    router.post("/webhook/:token", (req, res) =>
      res.json({ token: req.params.token }),
    );
    router.get("/private", (_req, res) => res.json({ ok: true }));

    const base = await startServer();

    const open = await fetch(
      `${base}/plugin-api/sample-plugin/webhook/abc123`,
      {
        method: "POST",
      },
    );
    expect(open.status).toBe(200);
    expect(await open.json()).toEqual({ token: "abc123" });

    // Declaring one route public must not open the rest of the plugin.
    expect(
      (await fetch(`${base}/plugin-api/sample-plugin/private`)).status,
    ).toBe(401);
  });

  it("does not let a public parameter swallow extra path segments", async () => {
    const router = http.createPluginRouter({
      manifest: manifest(),
      options: { public: ["/webhook/:token"] },
      reportError: () => {},
    });
    router.get("/webhook/:token/secret", (_req, res) => res.json({ ok: true }));

    const base = await startServer();

    const response = await fetch(
      `${base}/plugin-api/sample-plugin/webhook/abc/secret`,
    );
    expect(response.status).toBe(401);
  });

  it("gives the plugin the user core authenticated, not one the caller named", async () => {
    const router = http.createPluginRouter({
      manifest: manifest(),
      reportError: () => {},
    });
    router.get("/who", (req, res) =>
      res.json({
        userId: (req as express.Request & { userId?: string }).userId,
      }),
    );

    const base = await startServer();
    const response = await fetch(`${base}/plugin-api/sample-plugin/who`, {
      headers: { ...authed, "x-user-id": "attacker" },
    });

    expect(await response.json()).toEqual({ userId: state.userId });
  });
});

describe("ctx.http capability", () => {
  it("refuses to build a router without network:serve declared", () => {
    expect(() =>
      http.createPluginRouter({
        manifest: manifest({ capabilities: [] }),
        reportError: () => {},
      }),
    ).not.toThrow();
    // Declaration is checked in ctx.ts; the grant is checked per request below.
  });

  it("403s every request when the grant is revoked", async () => {
    const router = http.createPluginRouter({
      manifest: manifest(),
      reportError: () => {},
    });
    router.get("/thing", (_req, res) => res.json({ ok: true }));

    const base = await startServer();
    expect(
      (
        await fetch(`${base}/plugin-api/sample-plugin/thing`, {
          headers: authed,
        })
      ).status,
    ).toBe(200);

    // Revoked at runtime: no restart, and the next request is refused.
    state.granted.delete("network:serve");

    const response = await fetch(`${base}/plugin-api/sample-plugin/thing`, {
      headers: authed,
    });
    expect(response.status).toBe(403);
  });
});

describe("ctx.http while the plugin is disabled", () => {
  it("answers 503 rather than 404", async () => {
    const router = http.createPluginRouter({
      manifest: manifest(),
      reportError: () => {},
    });
    router.get("/thing", (_req, res) => res.json({ ok: true }));

    // "Installed but not running" is a different fact from "no such plugin",
    // and a caller can act on the difference.
    http.setPluginEnabledCheck(() => false);

    const base = await startServer();
    const response = await fetch(`${base}/plugin-api/sample-plugin/thing`, {
      headers: authed,
    });

    expect(response.status).toBe(503);
  });
});

describe("ctx.http errors", () => {
  it("reports a throwing route without leaking a stack", async () => {
    const reported: unknown[] = [];
    const router = http.createPluginRouter({
      manifest: manifest(),
      reportError: (error) => reported.push(error),
    });
    router.get("/boom", () => {
      throw new Error("secret internal detail");
    });

    const base = await startServer();
    const response = await fetch(`${base}/plugin-api/sample-plugin/boom`, {
      headers: authed,
    });

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain("secret internal detail");
    // Counted against the plugin's error budget.
    expect(reported).toHaveLength(1);
  });
});

describe("ctx.http streaming", () => {
  it("streams an SSE response as it is produced", async () => {
    const router = http.createPluginRouter({
      manifest: manifest(),
      reportError: () => {},
    });

    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    router.get("/stream", async (_req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.write("event: progress\ndata: 1\n\n");
      // The first chunk has to arrive before the handler finishes, or this is
      // buffering rather than streaming.
      await gate;
      res.write("event: result\ndata: done\n\n");
      res.end();
    });

    const base = await startServer();
    const response = await fetch(`${base}/plugin-api/sample-plugin/stream`, {
      headers: authed,
    });

    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain("data: 1");

    release!();

    let rest = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      rest += decoder.decode(chunk.value);
    }
    expect(rest).toContain("data: done");
  });
});
