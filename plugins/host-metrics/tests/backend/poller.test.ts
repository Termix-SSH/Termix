import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeContext } from "@termix/plugin-sdk/testing";
import type { MetricsHost } from "../../src/backend/helpers.js";

const collectMetrics = vi.fn();
vi.mock("../../src/backend/collect.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  collectMetrics: (...args: unknown[]) => collectMetrics(...args),
}));

const { MetricsPoller, TOPIC_SNAPSHOT, TOPIC_STATUS } =
  await import("../../src/backend/poller.js");
const { createMetricsState } = await import("../../src/backend/state.js");
const { createLogger } = await import("../../src/backend/log.js");

const sample = {
  cpu: { percent: 10, cores: 2, load: null },
  memory: { percent: 20, usedGiB: 1, totalGiB: 4 },
  disk: { percent: 30, filesystems: [] },
  network: { interfaces: [{ rxBytes: "100", txBytes: "200" }] },
};

function host(id: number): MetricsHost {
  return {
    id,
    userId: "user-1",
    ip: `10.0.0.${id}`,
    port: 22,
    username: "root",
    authType: "password",
    connectionType: "ssh",
  } as MetricsHost;
}

function setup(hostIds = [7]) {
  const fake = createFakeContext({
    pluginId: "host-metrics",
    actor: "user-1",
    sshHosts: hostIds.map(host),
    hostStatuses: Object.fromEntries(
      hostIds.map((id) => [
        id,
        { status: "reachable" as const, lastChecked: "now" },
      ]),
    ),
  });
  const samples: unknown[] = [];
  const state = createMetricsState();
  const poller = new MetricsPoller({
    ctx: fake.ctx,
    log: createLogger(fake.ctx.log),
    repository: {
      recordSample: async (input: unknown) => {
        samples.push(input);
      },
    } as never,
    ssh: fake.ctx.ssh,
    state,
    sessions: {} as never,
    collectors: {} as never,
  });
  return { fake, poller, state, samples };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

beforeEach(() => {
  collectMetrics.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MetricsPoller", () => {
  it("polls from the first viewer and reports a working login", async () => {
    collectMetrics.mockImplementation(async (_deps, _host, _mounts, onAuth) => {
      onAuth?.();
      return sample;
    });
    const { fake, poller, samples } = setup();

    poller.registerViewer(7, "viewer-a", "user-1");
    await flush();

    expect(collectMetrics).toHaveBeenCalledOnce();
    expect(poller.getMetrics(7)?.data).toEqual(sample);
    expect(fake.statusReports).toEqual([{ hostId: 7, ok: true }]);
    expect(samples).toEqual([
      expect.objectContaining({
        hostId: 7,
        cpuPercent: 10,
        netRxBytes: 100,
        netTxBytes: 200,
      }),
    ]);
    expect(fake.emitted.map((event) => event.topic)).toEqual([
      TOPIC_STATUS,
      TOPIC_SNAPSHOT,
    ]);
    expect(fake.emitted[0].payload).toMatchObject({
      hostId: 7,
      state: "collecting",
      previous: null,
    });
    const job = fake.scheduled.find((entry) => entry.kind === "every");
    expect(job?.ms).toBe(30_000);
  });

  it("uses the host's own interval over the admin one", async () => {
    collectMetrics.mockResolvedValue(sample);
    const { fake, poller } = setup();
    await fake.ctx.settings.set("metricsInterval", 60);
    await fake.ctx.settings.setHost(7, "metricsInterval", 15);

    poller.registerViewer(7, "viewer-a", "user-1");
    await flush();

    expect(fake.scheduled.find((entry) => entry.kind === "every")?.ms).toBe(
      15_000,
    );
  });

  it("waits for a host core sees as offline", async () => {
    collectMetrics.mockResolvedValue(sample);
    const { fake, poller } = setup();
    fake.hostStatuses.set(7, { status: "offline", lastChecked: "now" });

    poller.registerViewer(7, "viewer-a", "user-1");
    await flush();
    expect(collectMetrics).not.toHaveBeenCalled();

    // Core's check comes back: the first sample runs.
    fake.hostStatuses.set(7, { status: "reachable", lastChecked: "now" });
    poller.hostStatusChanged(7, "reachable");
    await flush();
    expect(collectMetrics).toHaveBeenCalledOnce();
  });

  it("reports a failed login and why collection stopped", async () => {
    collectMetrics.mockRejectedValue(
      new Error("All configured authentication methods failed"),
    );
    const { fake, poller } = setup();

    poller.registerViewer(7, "viewer-a", "user-1");
    await flush();

    expect(fake.statusReports).toEqual([
      { hostId: 7, ok: false, hostKeyChanged: false },
    ]);
    expect(fake.emitted.at(-1)?.payload).toMatchObject({
      state: "auth_failed",
    });
  });

  it("marks a changed host key", async () => {
    collectMetrics.mockRejectedValue(new Error("Host key changed"));
    const { fake, poller, state } = setup();

    poller.registerViewer(7, "viewer-a", "user-1");
    await flush();

    expect(fake.statusReports).toEqual([
      { hostId: 7, ok: false, hostKeyChanged: true },
    ]);
    expect(state.authFailures.shouldSkip(7)).toBe(true);
    poller.hostKeyAccepted(7);
    expect(state.authFailures.shouldSkip(7)).toBe(false);
  });

  it("stops with the last viewer", async () => {
    collectMetrics.mockResolvedValue(sample);
    const { fake, poller } = setup();

    poller.registerViewer(7, "a", "user-1");
    poller.registerViewer(7, "b", "user-1");
    await flush();
    const job = fake.scheduled.find((entry) => entry.kind === "every")!;

    poller.unregisterViewer(7, "a");
    expect(job.stopped).toBe(false);
    poller.unregisterViewer(7, "b");
    expect(job.stopped).toBe(true);
    expect(poller.isPolling(7)).toBe(false);
  });

  it("drops viewers that stop sending heartbeats", async () => {
    collectMetrics.mockResolvedValue(sample);
    const { poller } = setup();
    poller.registerViewer(7, "a", "user-1");
    await flush();

    poller.cleanupInactiveViewers(Date.now() + 121_000);
    expect(poller.hasViewers(7)).toBe(false);
  });

  it("skips a host with metrics turned off", async () => {
    const { fake, poller } = setup();
    await fake.ctx.settings.setHost(7, "metricsEnabled", false);

    poller.registerViewer(7, "a", "user-1");
    await flush();

    expect(poller.isPolling(7)).toBe(false);
    expect(collectMetrics).not.toHaveBeenCalled();
  });

  it("grows poll concurrency with the number of polled hosts", async () => {
    collectMetrics.mockResolvedValue(sample);
    const ids = Array.from({ length: 200 }, (_, index) => index + 1);
    const { poller, state } = setup(ids);
    expect(state.metricsLimiter.limit).toBe(5);

    for (const id of ids) poller.registerViewer(id, `v${id}`, "user-1");
    await flush();

    expect(state.metricsLimiter.limit).toBe(10);
  });

  it("drops a pooled connection when a host changes", async () => {
    collectMetrics.mockResolvedValue(sample);
    const { fake, poller } = setup();
    poller.registerViewer(7, "a", "user-1");
    await flush();

    await poller.hostUpdated(7);
    expect(fake.droppedPools).toEqual([{ pool: "stats", hostId: 7 }]);
    expect(poller.isPolling(7)).toBe(true);
  });

  it("forgets a deleted host", async () => {
    collectMetrics.mockResolvedValue(sample);
    const { poller } = setup();
    poller.registerViewer(7, "a", "user-1");
    await flush();

    poller.hostDeleted(7);
    expect(poller.isPolling(7)).toBe(false);
    expect(poller.getMetrics(7)).toBeUndefined();
    expect(poller.hasViewers(7)).toBe(false);
  });
});
