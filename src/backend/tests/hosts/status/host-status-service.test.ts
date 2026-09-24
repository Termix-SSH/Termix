import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: vi.fn(),
  getCurrentSettingValue: vi.fn(() => null),
}));
vi.mock("../../../utils/logger.js", () => ({
  sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  pluginLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { HostStatusService, toStatusTarget } =
  await import("../../../hosts/status/host-status-service.js");
const { hostSessionStatus } =
  await import("../../../hosts/host-session-status.js");
const { pluginEvents, TOPICS } = await import("../../../plugins/events.js");

type Target = ReturnType<typeof toStatusTarget>;

function target(id: number, extra: Partial<Target> = {}): Target {
  return {
    id,
    userId: "owner",
    ip: `10.0.0.${id}`,
    port: 22,
    connectionType: "ssh",
    jumpHosts: [],
    statusCheckEnabled: true,
    statusCheckInterval: null,
    ...extra,
  };
}

function setup(targets: Target[], reachable = true) {
  const emitted: unknown[] = [];
  const ping = vi.fn(async () => reachable);
  const pingThroughJumpHosts = vi.fn(async () => reachable);
  const loadTargets = vi.fn(
    async (filter: { userId?: string; hostIds?: number[] }) =>
      targets.filter(
        (t) =>
          (!filter.userId || t.userId === filter.userId) &&
          (!filter.hostIds || filter.hostIds.includes(t.id)),
      ),
  );
  const service = new HostStatusService({
    loadTargets,
    ping,
    pingThroughJumpHosts,
    globalInterval: () => 60,
    emit: (payload) => emitted.push(payload),
  });
  return { service, emitted, ping, pingThroughJumpHosts, loadTargets };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let active: InstanceType<typeof HostStatusService> | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  active?.stop();
  active = null;
  pluginEvents.clear();
  vi.useRealTimers();
});

describe("HostStatusService", () => {
  it("starts a user's own hosts and reports them reachable", async () => {
    const { service, emitted, ping } = setup([target(1), target(2)]);
    active = service;

    await service.statusesFor("owner", null);
    await flush();

    expect(ping).toHaveBeenCalledWith("10.0.0.1", 22);
    expect(service.get(1)?.status).toBe("reachable");
    expect(emitted).toContainEqual({
      hostId: 1,
      ownerUserId: "owner",
      status: "reachable",
      previous: null,
      online: true,
    });
  });

  it("reports offline for a host that does not answer", async () => {
    const { service } = setup([target(1)], false);
    active = service;
    await service.statusesFor("owner", null);
    await flush();
    expect(service.get(1)?.status).toBe("offline");
  });

  it("never checks a host with status checks off", async () => {
    const { service, ping } = setup([target(1, { statusCheckEnabled: false })]);
    active = service;
    await service.statusesFor("owner", null);
    await flush();
    expect(ping).not.toHaveBeenCalled();
    expect(service.get(1)).toBeNull();
  });

  it("goes through the jump hosts when a host has them", async () => {
    const { service, ping, pingThroughJumpHosts } = setup([
      target(1, { jumpHosts: [{ hostId: 9 }] }),
    ]);
    active = service;
    await service.statusesFor("owner", null);
    await flush();
    expect(ping).not.toHaveBeenCalled();
    expect(pingThroughJumpHosts).toHaveBeenCalledOnce();
  });

  it("asks a registered plugin for a protocol's port", async () => {
    const { service, ping } = setup([target(1, { connectionType: "rdp" })]);
    active = service;
    service.registerPort("rdp", async () => 3390);
    await service.statusesFor("owner", null);
    await flush();
    expect(ping).toHaveBeenCalledWith("10.0.0.1", 3390);
  });

  it("falls back to the host's port when no plugin knows the protocol", async () => {
    const { service, ping } = setup([
      target(1, { connectionType: "rdp", port: 3389 }),
    ]);
    active = service;
    await service.statusesFor("owner", null);
    await flush();
    expect(ping).toHaveBeenCalledWith("10.0.0.1", 3389);
  });

  it("turns reachable into online when a plugin reports a login", async () => {
    const { service, emitted } = setup([target(1)]);
    active = service;
    await service.statusesFor("owner", null);
    await flush();

    service.reportLogin(1, { ok: true });
    await flush();
    expect(service.get(1)?.status).toBe("online");
    expect(emitted.at(-1)).toMatchObject({
      status: "online",
      previous: "reachable",
    });

    service.reportLogin(1, { ok: false, hostKeyChanged: true });
    expect(service.get(1)).toMatchObject({
      status: "reachable",
      reason: "host_key_changed",
    });
  });

  it("clears the host key reason once the new key is accepted", async () => {
    const { service } = setup([target(1)]);
    active = service;
    service.start();
    await service.statusesFor("owner", null);
    await flush();
    service.reportLogin(1, { ok: false, hostKeyChanged: true });

    pluginEvents.emit(TOPICS.hostKeyUpdated, { hostId: 1 });
    expect(service.get(1)?.reason).toBeUndefined();
  });

  it("shows a host with an open terminal session as online", async () => {
    const { service } = setup([target(1)]);
    active = service;
    service.start();
    await service.statusesFor("owner", null);
    await flush();

    const release = hostSessionStatus.register(1);
    expect(service.get(1)?.status).toBe("online");
    release();
    expect(service.get(1)?.status).toBe("reachable");
  });

  it("only checks the requested hosts on the desktop app", async () => {
    const { service, ping } = setup([target(1), target(2)]);
    active = service;
    await service.statusesFor("owner", new Set([2]));
    await flush();
    expect(ping).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledWith("10.0.0.2", 22);
  });

  it("checks again on its interval", async () => {
    const { service, ping } = setup([target(1, { statusCheckInterval: 10 })]);
    active = service;
    await service.statusesFor("owner", null);
    await flush();
    expect(ping).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(15_000);
    await flush();
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("checks a host on demand unless the last result is fresh", async () => {
    const { service, ping } = setup([target(1)]);
    active = service;
    expect(await service.check(1)).toMatchObject({ status: "reachable" });
    expect(await service.check(1)).toMatchObject({ status: "reachable" });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("forgets a deleted host", async () => {
    const { service } = setup([target(1)]);
    active = service;
    service.start();
    await service.statusesFor("owner", null);
    await flush();

    pluginEvents.emit(TOPICS.hostDeleted, { hostId: 1 });
    expect(service.get(1)).toBeNull();
  });

  it("never logs in to check a host", async () => {
    // The only transports are the two ping functions: nothing here can
    // authenticate, so a RADIUS or Duo backed host gets no 2FA push.
    const { service, ping, pingThroughJumpHosts } = setup([target(1)]);
    active = service;
    await service.statusesFor("owner", null);
    await flush();
    expect(ping.mock.calls[0]).toEqual(["10.0.0.1", 22]);
    expect(pingThroughJumpHosts).not.toHaveBeenCalled();
  });
});

describe("toStatusTarget", () => {
  it("parses the jump hosts and defaults the connection type", () => {
    expect(
      toStatusTarget({
        id: 1,
        userId: "u",
        ip: "h",
        port: 22,
        connectionType: "",
        jumpHosts: '[{"hostId":3},{"bad":1}]',
        statusCheckEnabled: false,
        statusCheckInterval: 30,
      }),
    ).toEqual({
      id: 1,
      userId: "u",
      ip: "h",
      port: 22,
      connectionType: "ssh",
      jumpHosts: [{ hostId: 3 }],
      statusCheckEnabled: false,
      statusCheckInterval: 30,
    });
  });
});
