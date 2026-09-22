import type express from "express";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveHostById = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/backend/hosts/host-resolver.js", () => ({
  resolveHostById,
}));

const manager = vi.hoisted(() => ({
  activeTunnelRuntimes: new Map<string, unknown>(),
  connectionStatus: new Map<string, unknown>(),
  tunnelConnecting: new Set<string>(),
  connectSSHTunnel: vi.fn(),
  cleanupTunnelResources: vi.fn(async () => undefined),
}));
vi.mock("../../../../src/backend/hosts/tunnel/manager.js", () => manager);

const forwardOut = vi.hoisted(() => vi.fn(async () => ({ end: vi.fn() })));
vi.mock("../../../../src/backend/hosts/tunnel/ssh-primitives.js", () => ({
  forwardOut,
}));

vi.mock("../../../../src/backend/utils/auth-manager.js", () => ({
  AuthManager: { getInstance: () => ({ createAuthMiddleware: () => vi.fn() }) },
}));

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

function request(body: unknown, userId: string | undefined = "u1") {
  return { body, userId } as unknown as express.Request;
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
    password: "pw",
    enableWebUi: true,
    webUiConfig: JSON.stringify({ endpoints: [endpoint()] }),
    ...overrides,
  };
}

/** Makes connectSSHTunnel behave like a successful open. */
function tunnelConnectsOn(port: number) {
  manager.connectSSHTunnel.mockImplementation(
    async (config: { name: string }) => {
      manager.activeTunnelRuntimes.set(config.name, {
        bindPort: port,
        sourceClient: {},
        close: vi.fn(),
      });
    },
  );
}

beforeEach(() => {
  manager.activeTunnelRuntimes.clear();
  manager.connectionStatus.clear();
  manager.tunnelConnecting.clear();
  manager.connectSSHTunnel.mockReset();
  manager.cleanupTunnelResources.mockClear();
  forwardOut.mockClear();
  forwardOut.mockResolvedValue({ end: vi.fn() });
  resolveHostById.mockReset();
  resolveHostById.mockResolvedValue(host());
});

afterEach(() => {
  vi.resetModules();
});

describe("POST /tunnel/web-endpoint/open", () => {
  it("refuses a host the user cannot resolve, without opening anything", async () => {
    resolveHostById.mockResolvedValue(null);
    const { handleWebEndpointOpen } =
      await import("../../src/backend/routes.js");
    const res = response();
    await handleWebEndpointOpen(request({ hostId: 7, endpointId: "e1" }), res);

    expect(res.statusCode).toBe(403);
    expect(manager.connectSSHTunnel).not.toHaveBeenCalled();
  });

  it("refuses when the feature is disabled even though the config still lists the endpoint", async () => {
    // Reachable via a bulk update that sends only { webUiConfig } while the
    // stored enable_web_ui is still 0. The UI reads as off in that state.
    resolveHostById.mockResolvedValue(host({ enableWebUi: false }));
    const { handleWebEndpointOpen } =
      await import("../../src/backend/routes.js");
    const res = response();
    await handleWebEndpointOpen(request({ hostId: 7, endpointId: "e1" }), res);

    expect(res.statusCode).toBe(400);
    expect(manager.connectSSHTunnel).not.toHaveBeenCalled();
  });

  it("refuses an endpoint id that matches nothing", async () => {
    const { handleWebEndpointOpen } =
      await import("../../src/backend/routes.js");
    const res = response();
    await handleWebEndpointOpen(
      request({ hostId: 7, endpointId: "nope" }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it("returns the real bound port", async () => {
    tunnelConnectsOn(41234);
    const { handleWebEndpointOpen } =
      await import("../../src/backend/routes.js");
    const res = response();
    await handleWebEndpointOpen(request({ hostId: 7, endpointId: "e1" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.port).toBe(41234);
  });

  it("selects the local-forward path via endpointHost, not targetHost", async () => {
    // connectSSHTunnel routes on isSingleHostTunnel, which keys on
    // endpointHost === "127.0.0.1". Setting only targetHost would silently
    // select a different strategy and the forward would never bind locally.
    tunnelConnectsOn(41234);
    const { handleWebEndpointOpen } =
      await import("../../src/backend/routes.js");
    await handleWebEndpointOpen(
      request({ hostId: 7, endpointId: "e1" }),
      response(),
    );

    const config = manager.connectSSHTunnel.mock.calls[0][0];
    expect(config.endpointHost).toBe("127.0.0.1");
    expect(config.mode).toBe("local");
    expect(config.endpointPort).toBe(8006);
    // Carries the source SSH identity -- connectSSHTunnel builds its client
    // from these, and reads sourceUserId specifically.
    expect(config.sourceIP).toBe("10.0.0.5");
    expect(config.sourceUserId).toBe("u1");
  });

  it("binds loopback by default and the endpoint's choice when given", async () => {
    tunnelConnectsOn(41234);
    const { handleWebEndpointOpen } =
      await import("../../src/backend/routes.js");
    await handleWebEndpointOpen(
      request({ hostId: 7, endpointId: "e1" }),
      response(),
    );
    expect(manager.connectSSHTunnel.mock.calls[0][0].bindHost).toBe(
      "127.0.0.1",
    );

    manager.activeTunnelRuntimes.clear();
    resolveHostById.mockResolvedValue(
      host({
        webUiConfig: JSON.stringify({
          endpoints: [endpoint({ bindHost: "0.0.0.0", localPort: 38080 })],
        }),
      }),
    );
    await handleWebEndpointOpen(
      request({ hostId: 7, endpointId: "e1" }),
      response(),
    );
    const config = manager.connectSSHTunnel.mock.calls[1][0];
    expect(config.bindHost).toBe("0.0.0.0");
    expect(config.sourcePort).toBe(38080);
  });

  it("reuses a live tunnel instead of opening a second one", async () => {
    tunnelConnectsOn(41234);
    const { handleWebEndpointOpen } =
      await import("../../src/backend/routes.js");
    const first = response();
    await handleWebEndpointOpen(
      request({ hostId: 7, endpointId: "e1" }),
      first,
    );
    const second = response();
    await handleWebEndpointOpen(
      request({ hostId: 7, endpointId: "e1" }),
      second,
    );

    expect(second.body.port).toBe(41234);
    expect(manager.connectSSHTunnel).toHaveBeenCalledTimes(1);
  });

  it("reopens when the endpoint's target changed under a live tunnel", async () => {
    tunnelConnectsOn(41234);
    const { handleWebEndpointOpen } =
      await import("../../src/backend/routes.js");
    await handleWebEndpointOpen(
      request({ hostId: 7, endpointId: "e1" }),
      response(),
    );

    // Same id, different port: the live forward now points at the wrong place.
    resolveHostById.mockResolvedValue(
      host({
        webUiConfig: JSON.stringify({ endpoints: [endpoint({ port: 9000 })] }),
      }),
    );
    tunnelConnectsOn(51234);
    const res = response();
    await handleWebEndpointOpen(request({ hostId: 7, endpointId: "e1" }), res);

    expect(manager.cleanupTunnelResources).toHaveBeenCalledWith(
      "web:7:e1",
      true,
    );
    expect(res.body.port).toBe(51234);
  });

  it("reports the target port being closed rather than returning a dead 200", async () => {
    // The likeliest real error: the listener binds fine, but nothing is
    // serving on the endpoint's port. Without the probe this returns 200 and
    // the user gets a blank frame with no message.
    tunnelConnectsOn(41234);
    forwardOut.mockRejectedValue(
      new Error("Channel open failure: connect failed"),
    );
    const { handleWebEndpointOpen } =
      await import("../../src/backend/routes.js");
    const res = response();
    await handleWebEndpointOpen(request({ hostId: 7, endpointId: "e1" }), res);

    expect(res.statusCode).toBe(502);
    expect(String(res.body.error)).toMatch(/connect failed/);
    // Nothing half-built is left registered.
    expect(manager.cleanupTunnelResources).toHaveBeenCalledWith(
      "web:7:e1",
      true,
    );
  });

  it("surfaces a connection failure reported only over the status map", async () => {
    // connectSSHTunnel never rejects and resolves before the SSH handshake, so
    // without waitForTunnelSettled this path would read as success.
    manager.connectSSHTunnel.mockImplementation(
      async (config: { name: string }) => {
        manager.connectionStatus.set(config.name, {
          connected: false,
          reason: "All authentication methods failed",
        });
      },
    );
    const { handleWebEndpointOpen } =
      await import("../../src/backend/routes.js");
    const res = response();
    await handleWebEndpointOpen(request({ hostId: 7, endpointId: "e1" }), res);

    expect(res.statusCode).toBe(502);
    expect(String(res.body.error)).toMatch(/authentication methods failed/);
  });

  it("rejects a malformed request before touching the database", async () => {
    const { handleWebEndpointOpen } =
      await import("../../src/backend/routes.js");
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
 * The client path and the server path have to agree.
 *
 * This guards a real bug: the route once served the unprefixed form while the
 * client called the full one, so every call 404d and no handler unit test
 * noticed, because those call the handler directly. It was caught only by
 * opening a tunnel against a deployed build.
 *
 * The shape changed with A4. The route used to be composed of a mount point in
 * the tunnel service (/ssh/tunnel/web-endpoint, port 30003) plus "/open" on
 * this router. Now core mounts every plugin at /plugin-api/<id>, so the client
 * calls /plugin-api/web-endpoint/open and the only half this plugin owns is
 * "/open". Asserting that keeps the guard meaningful without re-encoding a
 * prefix the plugin no longer controls.
 */
describe("route registration", () => {
  it("registers /open on the router core hands it", async () => {
    const routes = await import("../../src/backend/routes.js");
    const express = (await import("express")).default;
    const mountOn = express.Router();

    routes.startWebEndpointService(mountOn);

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

    // ctx.http.router() is what puts this plugin at /plugin-api/web-endpoint.
    expect(source).toContain("ctx.http.router()");
  });
});
