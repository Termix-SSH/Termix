import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginHostSummary } from "@termix/plugin-sdk/backend";
import { startServer, type TestServer } from "./helpers.js";

vi.mock("../../src/backend/magic-packet.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/backend/magic-packet.js")
  >("../../src/backend/magic-packet.js");
  return { ...actual, sendMagicPacket: vi.fn().mockResolvedValue(undefined) };
});

const HOST: PluginHostSummary = {
  id: 1,
  userId: "user-1",
  name: "server",
  ip: "10.0.0.5",
  port: 22,
  username: "root",
  tags: null,
  folder: null,
  authType: "password",
};

describe("POST /host/:id/wake", () => {
  let server: TestServer;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await server?.close();
  });

  it("sends the packet for a configured host", async () => {
    server = await startServer({ hosts: [HOST] });
    await server.mock.ctx.settings.setHost(
      1,
      "macAddress",
      "aa:bb:cc:dd:ee:ff",
    );

    const response = await server.request("POST", "/host/1/wake");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
  });

  it("404s for an unknown host", async () => {
    server = await startServer({ hosts: [] });
    const response = await server.request("POST", "/host/999/wake");
    expect(response.status).toBe(404);
  });

  it("400s when no MAC address is configured", async () => {
    server = await startServer({ hosts: [HOST] });
    const response = await server.request("POST", "/host/1/wake");
    expect(response.status).toBe(400);
  });

  it("denies a caller without wake-on-lan.send", async () => {
    server = await startServer({ hosts: [HOST], permissions: [] });
    const response = await server.request("POST", "/host/1/wake");
    expect(response.status).toBe(403);
  });
});
