import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("../../plugins/service-registry.js", () => ({
  getServiceImplementation: () => service.value,
}));

const { liveTerminalSessions } =
  await import("../../hosts/live-terminal-sessions.js");

const session = {
  id: "s1",
  userId: "u1",
  hostId: 9,
  hostName: "Testing",
  isConnected: true,
  createdAt: 1,
  lastDetachedAt: null,
  tabInstanceId: null,
  cols: 80,
  rows: 24,
};

beforeEach(() => {
  service.value = undefined;
});

describe("live terminal sessions", () => {
  it("awaits a terminal running in its own process", async () => {
    service.value = {
      listForUser: async () => [session],
      idleTimeoutMinutes: async () => 45,
    };
    expect(await liveTerminalSessions.listForUser("u1")).toEqual([session]);
    expect(await liveTerminalSessions.idleTimeoutMinutes()).toBe(45);
  });

  it("still takes a provider that answers at once", async () => {
    service.value = {
      listForUser: () => [session],
      idleTimeoutMinutes: () => 10,
    };
    expect(await liveTerminalSessions.listForUser("u1")).toEqual([session]);
    expect(await liveTerminalSessions.idleTimeoutMinutes()).toBe(10);
  });

  it("finds nothing while the terminal is off", async () => {
    expect(await liveTerminalSessions.listForUser("u1")).toEqual([]);
    expect(await liveTerminalSessions.idleTimeoutMinutes()).toBeNull();
  });
});
