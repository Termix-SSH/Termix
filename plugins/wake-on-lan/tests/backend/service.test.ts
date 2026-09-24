import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockCtx } from "@termix/plugin-sdk/testing";
import { createWakeOnLanService } from "../../src/backend/service.js";

vi.mock("../../src/backend/magic-packet.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/backend/magic-packet.js")
  >("../../src/backend/magic-packet.js");
  return { ...actual, sendMagicPacket: vi.fn().mockResolvedValue(undefined) };
});

import { sendMagicPacket } from "../../src/backend/magic-packet.js";

const HOST = {
  id: 1,
  userId: "user-1",
  name: "server",
  ip: "10.0.0.5",
  port: 22,
  authType: "password",
};

describe("wake-on-lan service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a magic packet for a host with a valid MAC", async () => {
    const mock = createMockCtx({
      capabilities: ["hosts:read", "network:broadcast"],
      hosts: [HOST],
      actor: "user-1",
    });
    await mock.ctx.settings.setHost(1, "macAddress", "aa:bb:cc:dd:ee:ff");

    const service = createWakeOnLanService(mock.ctx);
    await service.wake(1);

    expect(sendMagicPacket).toHaveBeenCalledWith(
      "aa:bb:cc:dd:ee:ff",
      undefined,
    );
  });

  it("passes the configured broadcast address", async () => {
    const mock = createMockCtx({
      capabilities: ["hosts:read", "network:broadcast"],
      hosts: [HOST],
      actor: "user-1",
    });
    await mock.ctx.settings.setHost(1, "macAddress", "aa:bb:cc:dd:ee:ff");
    await mock.ctx.settings.setHost(1, "broadcastAddress", "192.168.1.255");

    const service = createWakeOnLanService(mock.ctx);
    await service.wake(1);

    expect(sendMagicPacket).toHaveBeenCalledWith(
      "aa:bb:cc:dd:ee:ff",
      "192.168.1.255",
    );
  });

  it("rejects a host with no MAC address configured", async () => {
    const mock = createMockCtx({
      capabilities: ["hosts:read", "network:broadcast"],
      hosts: [HOST],
      actor: "user-1",
    });

    const service = createWakeOnLanService(mock.ctx);
    await expect(service.wake(1)).rejects.toThrow(
      "No valid MAC address configured",
    );
    expect(sendMagicPacket).not.toHaveBeenCalled();
  });

  it("rejects an unknown host", async () => {
    const mock = createMockCtx({
      capabilities: ["hosts:read", "network:broadcast"],
      hosts: [],
      actor: "user-1",
    });

    const service = createWakeOnLanService(mock.ctx);
    await expect(service.wake(999)).rejects.toThrow("Host not found");
  });

  it("fails closed without network:broadcast", async () => {
    const mock = createMockCtx({
      capabilities: ["hosts:read"],
      hosts: [HOST],
      actor: "user-1",
    });
    await mock.ctx.settings.setHost(1, "macAddress", "aa:bb:cc:dd:ee:ff");

    const service = createWakeOnLanService(mock.ctx);
    await expect(service.wake(1)).rejects.toThrow();
    expect(sendMagicPacket).not.toHaveBeenCalled();
  });
});
