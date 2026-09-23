import express from "express";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeContext } from "@termix/plugin-sdk/testing";

const resolveHostById = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/backend/hosts/host-resolver.js", () => ({
  resolveHostById,
}));

const forward = vi.fn();

function response() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as express.Response & {
    statusCode: number;
    body: { port?: number; error?: string };
  };
}

function request(body: unknown) {
  return { body } as unknown as express.Request;
}

const endpoint = (overrides: Record<string, unknown> = {}) => ({
  id: "e1",
  label: "Proxmox",
  scheme: "http",
  port: 8006,
  path: "/",
  access: "tunnel",
  render: "embedded",
  ...overrides,
});

function host(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    userId: "u1",
    ip: "10.0.0.5",
    port: 22,
    username: "root",
    authType: "password",
    enableWebUi: true,
    webUiConfig: JSON.stringify({ endpoints: [endpoint()] }),
    ...overrides,
  };
}

/** Activates the routes against a fake ctx, with or without the tunnels service. */
async function load(options: { tunnels?: boolean; actor?: string } = {}) {
  const fake = createFakeContext({
    pluginId: "web-endpoint",
    actor: options.actor ?? "u1",
  });
  if (options.tunnels !== false) {
    fake.ctx.services.provide("tunnels.access", { forward });
  }
  const routes = await import("../../src/backend/routes.js");
  routes.startWebEndpointService(express.Router(), fake.ctx);
  return routes;
}

beforeEach(() => {
  forward.mockReset();
  forward.mockResolvedValue({ bindHost: "127.0.0.1", bindPort: 41234 });
  resolveHostById.mockReset();
  resolveHostById.mockResolvedValue(host());
});

afterEach(() => {
  vi.resetModules();
});

describe("POST /open", () => {
  it("refuses a host the user cannot resolve, without opening anything", async () => {
    resolveHostById.mockResolvedValue(null);
    const { handleWebEndpointOpen } = await load();
    const res = response();
    await handleWebEndpointOpen(request({ hostId: 7, endpointId: "e1" }), res);

    expect(res.statusCode).toBe(403);
    expect(forward).not.toHaveBeenCalled();
  });

  it("refuses when the feature is disabled even though the config still lists the endpoint", async () => {
    resolveHostById.mockResolvedValue(host({ enableWebUi: false }));
    const { handleWebEndpointOpen } = await load();
    const res = response();
    await handleWebEndpointOpen(request({ hostId: 7, endpointId: "e1" }), res);

    expect(res.statusCode).toBe(400);
    expect(forward).not.toHaveBeenCalled();
  });

  it("refuses an endpoint id that matches nothing", async () => {
    const { handleWebEndpointOpen } = await load();
    const res = response();
    await handleWebEndpointOpen(
      request({ hostId: 7, endpointId: "nope" }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns the port the tunnels service bound", async () => {
    const { handleWebEndpointOpen } = await load();
    const res = response();
    await handleWebEndpointOpen(request({ hostId: 7, endpointId: "e1" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.port).toBe(41234);
  });

  it("asks for a loopback forward under the reserved web name", async () => {
    const { handleWebEndpointOpen } = await load();
    await handleWebEndpointOpen(
      request({ hostId: 7, endpointId: "e1" }),
      response(),
    );

    expect(forward).toHaveBeenCalledWith(
      7,
      {
        targetHost: "127.0.0.1",
        targetPort: 8006,
        bindHost: "127.0.0.1",
        bindPort: undefined,
      },
      { name: "web:7:e1", idleTimeoutMs: 10 * 60 * 1000 },
    );
  });

  it("passes the endpoint's own bind address and fixed port through", async () => {
    resolveHostById.mockResolvedValue(
      host({
        webUiConfig: JSON.stringify({
          endpoints: [endpoint({ bindHost: "0.0.0.0", localPort: 38080 })],
        }),
      }),
    );
    const { handleWebEndpointOpen } = await load();
    await handleWebEndpointOpen(
      request({ hostId: 7, endpointId: "e1" }),
      response(),
    );

    const target = forward.mock.calls[0][1];
    expect(target.bindHost).toBe("0.0.0.0");
    expect(target.bindPort).toBe(38080);
  });

  it("reports the service's reason as a 502 instead of a dead 200", async () => {
    forward.mockRejectedValue(
      new Error("Channel open failure: connect failed"),
    );
    const { handleWebEndpointOpen } = await load();
    const res = response();
    await handleWebEndpointOpen(request({ hostId: 7, endpointId: "e1" }), res);

    expect(res.statusCode).toBe(502);
    expect(String(res.body.error)).toMatch(/connect failed/);
  });

  it("answers 503 while the tunnels plugin is not available", async () => {
    const { handleWebEndpointOpen } = await load({ tunnels: false });
    const res = response();
    await handleWebEndpointOpen(request({ hostId: 7, endpointId: "e1" }), res);

    expect(res.statusCode).toBe(503);
  });

  it("rejects a malformed request before touching the database", async () => {
    const { handleWebEndpointOpen } = await load();
    for (const body of [
      {},
      { hostId: "7", endpointId: "e1" },
      { hostId: 0, endpointId: "e1" },
    ]) {
      const res = response();
      await handleWebEndpointOpen(request(body), res);
      expect(res.statusCode).toBe(400);
    }
    expect(resolveHostById).not.toHaveBeenCalled();
  });
});

/**
 * The client path and the server path have to agree. Core mounts every
 * plugin at /plugin-api/<id>, so the client calls /plugin-api/web-endpoint/open
 * and the only half this plugin owns is "/open".
 */
describe("route registration", () => {
  it("registers /open on the router core hands it", async () => {
    const routes = await load();

    const paths = (
      routes.router as unknown as {
        stack: Array<{ route?: { path: string; methods: { post?: boolean } } }>;
      }
    ).stack
      .filter((layer) => layer.route?.methods.post)
      .map((layer) => layer.route?.path);

    expect(paths).toContain("/open");
  });

  it("is reached through the plugin mount rather than a port of its own", async () => {
    const source = await readFile(
      new URL("../../src/backend/index.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("ctx.http.router()");
  });
});
