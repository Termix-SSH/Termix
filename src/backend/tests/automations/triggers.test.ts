import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AutomationDefinition,
  Trigger,
} from "../../../types/automations.js";

/**
 * Trigger matching, dwell windows and cooldowns. The repository and the engine
 * are mocked so these tests only exercise the decision of whether to fire.
 */

interface FakeRow {
  id: number;
  userId: string;
  name: string;
  enabled: boolean;
  definition: string;
  concurrencyPolicy: string;
  maxRunSeconds: number;
  dryRun: boolean;
}

const rows: FakeRow[] = [];
const triggerState = new Map<string, Record<string, unknown>>();

const repository = {
  listEnabledForUser: vi.fn(async (userId: string) =>
    rows.filter((row) => row.userId === userId && row.enabled),
  ),
  listAllEnabled: vi.fn(async () => rows.filter((row) => row.enabled)),
  getTriggerState: vi.fn(async (automationId: number, stateKey: string) => {
    return triggerState.get(`${automationId}:${stateKey}`) ?? null;
  }),
  upsertTriggerState: vi.fn(async (input: Record<string, unknown>) => {
    const key = `${input.automationId}:${input.stateKey}`;
    triggerState.set(key, { ...(triggerState.get(key) ?? {}), ...input });
  }),
  clearBreach: vi.fn(async (automationId: number, stateKey: string) => {
    const key = `${automationId}:${stateKey}`;
    const existing = triggerState.get(key);
    if (existing) existing.breachStartedAt = null;
  }),
};

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentAutomationRepository: () => repository,
}));

const run = vi.fn(async () => ({ runId: 1, status: "success" as const }));
vi.mock("../../automations/engine.js", () => ({
  AutomationEngine: { getInstance: () => ({ run }) },
}));

const triggers = await import("../../automations/triggers.js");

function addAutomation(trigger: Trigger, overrides: Partial<FakeRow> = {}) {
  const definition: AutomationDefinition = { version: 1, trigger, steps: [] };
  const row: FakeRow = {
    id: overrides.id ?? rows.length + 1,
    userId: overrides.userId ?? "user-1",
    name: "Test",
    enabled: overrides.enabled ?? true,
    definition: JSON.stringify(definition),
    concurrencyPolicy: "skip",
    maxRunSeconds: 300,
    dryRun: false,
  };
  rows.push(row);
  return row;
}

const diskMetrics = {
  disk: {
    percent: 30,
    filesystems: [
      { mount: "/", percent: 30 },
      { mount: "/data", percent: 93 },
    ],
  },
};

beforeEach(() => {
  rows.length = 0;
  triggerState.clear();
  vi.clearAllMocks();
});

describe("onMetrics", () => {
  it("fires immediately when no dwell window is set", async () => {
    addAutomation({
      kind: "metric_threshold",
      hostSelector: { kind: "host", hostId: 7 },
      metric: { path: "disk.percent", mount: "/data" },
      operator: ">",
      value: 90,
      cooldownMinutes: 15,
    });

    await triggers.onMetrics({
      hostId: 7,
      ownerUserId: "user-1",
      metrics: diskMetrics,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toMatchObject({
      triggerType: "metric_threshold",
      triggerHostId: 7,
    });
  });

  it("watches the named mount rather than the aggregate", async () => {
    // Root is at 30%, so a rule on / must not fire at a 90% threshold.
    addAutomation({
      kind: "metric_threshold",
      hostSelector: { kind: "host", hostId: 7 },
      metric: { path: "disk.percent", mount: "/" },
      operator: ">",
      value: 90,
      cooldownMinutes: 15,
    });

    await triggers.onMetrics({
      hostId: 7,
      ownerUserId: "user-1",
      metrics: diskMetrics,
    });

    expect(run).not.toHaveBeenCalled();
  });

  it("opens a dwell window instead of firing on the first sample", async () => {
    const row = addAutomation({
      kind: "metric_threshold",
      hostSelector: { kind: "host", hostId: 7 },
      metric: { path: "disk.percent", mount: "/data" },
      operator: ">",
      value: 90,
      forSeconds: 600,
      cooldownMinutes: 15,
    });

    await triggers.onMetrics({
      hostId: 7,
      ownerUserId: "user-1",
      metrics: diskMetrics,
    });

    expect(run).not.toHaveBeenCalled();
    expect(triggerState.get(`${row.id}:7:/data`)).toMatchObject({
      breachStartedAt: expect.any(String),
    });
  });

  it("fires once the dwell window has elapsed", async () => {
    const row = addAutomation({
      kind: "metric_threshold",
      hostSelector: { kind: "host", hostId: 7 },
      metric: { path: "disk.percent", mount: "/data" },
      operator: ">",
      value: 90,
      forSeconds: 600,
      cooldownMinutes: 15,
    });
    triggerState.set(`${row.id}:7:/data`, {
      breachStartedAt: new Date(Date.now() - 700_000).toISOString(),
    });

    await triggers.onMetrics({
      hostId: 7,
      ownerUserId: "user-1",
      metrics: diskMetrics,
    });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("clears the window as soon as the value recovers", async () => {
    const row = addAutomation({
      kind: "metric_threshold",
      hostSelector: { kind: "host", hostId: 7 },
      metric: { path: "disk.percent", mount: "/data" },
      operator: ">",
      value: 95,
      forSeconds: 600,
      cooldownMinutes: 15,
    });
    triggerState.set(`${row.id}:7:/data`, {
      breachStartedAt: new Date(Date.now() - 700_000).toISOString(),
    });

    await triggers.onMetrics({
      hostId: 7,
      ownerUserId: "user-1",
      metrics: diskMetrics,
    });

    expect(run).not.toHaveBeenCalled();
    expect(repository.clearBreach).toHaveBeenCalled();
  });

  it("stays quiet while the cooldown is open", async () => {
    const row = addAutomation({
      kind: "metric_threshold",
      hostSelector: { kind: "host", hostId: 7 },
      metric: { path: "disk.percent", mount: "/data" },
      operator: ">",
      value: 90,
      cooldownMinutes: 15,
    });
    triggerState.set(`${row.id}:7:/data`, {
      lastFiredAt: new Date(Date.now() - 60_000).toISOString(),
      breachStartedAt: new Date(Date.now() - 700_000).toISOString(),
    });

    await triggers.onMetrics({
      hostId: 7,
      ownerUserId: "user-1",
      metrics: diskMetrics,
    });

    expect(run).not.toHaveBeenCalled();
  });

  it("ignores hosts outside the selector", async () => {
    addAutomation({
      kind: "metric_threshold",
      hostSelector: { kind: "host", hostId: 99 },
      metric: { path: "disk.percent", mount: "/data" },
      operator: ">",
      value: 90,
      cooldownMinutes: 15,
    });

    await triggers.onMetrics({
      hostId: 7,
      ownerUserId: "user-1",
      metrics: diskMetrics,
    });

    expect(run).not.toHaveBeenCalled();
  });

  it("never evaluates another user's automations", async () => {
    addAutomation(
      {
        kind: "metric_threshold",
        hostSelector: { kind: "all" },
        metric: { path: "disk.percent", mount: "/data" },
        operator: ">",
        value: 90,
        cooldownMinutes: 15,
      },
      { userId: "user-2" },
    );

    await triggers.onMetrics({
      hostId: 7,
      ownerUserId: "user-1",
      metrics: diskMetrics,
    });

    expect(run).not.toHaveBeenCalled();
  });
});

describe("onStatus", () => {
  it("treats the first observation as a baseline", async () => {
    addAutomation({
      kind: "host_status",
      hostSelector: { kind: "host", hostId: 7 },
      to: "offline",
      cooldownMinutes: 0,
    });

    await triggers.onStatus({
      hostId: 7,
      ownerUserId: "user-1",
      online: false,
    });

    // Otherwise every host would announce itself after a restart.
    expect(run).not.toHaveBeenCalled();
  });

  it("fires on a transition into the watched state", async () => {
    const row = addAutomation({
      kind: "host_status",
      hostSelector: { kind: "host", hostId: 7 },
      to: "offline",
      cooldownMinutes: 0,
    });
    triggerState.set(`${row.id}:7`, { lastObservedState: "online" });

    await triggers.onStatus({
      hostId: 7,
      ownerUserId: "user-1",
      online: false,
    });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not fire on a transition in the other direction", async () => {
    const row = addAutomation({
      kind: "host_status",
      hostSelector: { kind: "host", hostId: 7 },
      to: "offline",
      cooldownMinutes: 0,
    });
    triggerState.set(`${row.id}:7`, { lastObservedState: "offline" });

    await triggers.onStatus({ hostId: 7, ownerUserId: "user-1", online: true });

    expect(run).not.toHaveBeenCalled();
  });

  it("stays quiet while the state is unchanged", async () => {
    const row = addAutomation({
      kind: "host_status",
      hostSelector: { kind: "host", hostId: 7 },
      to: "offline",
      cooldownMinutes: 0,
    });
    triggerState.set(`${row.id}:7`, { lastObservedState: "offline" });

    await triggers.onStatus({
      hostId: 7,
      ownerUserId: "user-1",
      online: false,
    });

    expect(run).not.toHaveBeenCalled();
  });
});

describe("onHealthCheck", () => {
  it("fires when a check transitions to failing", async () => {
    const row = addAutomation({
      kind: "health_check",
      hostSelector: { kind: "host", hostId: 7 },
      to: "failing",
      cooldownMinutes: 0,
    });
    triggerState.set(`${row.id}:7:web`, { lastObservedState: "recovered" });

    await triggers.onHealthCheck({
      hostId: 7,
      userId: "user-1",
      checkId: "web",
      ok: false,
    });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores a different check id", async () => {
    const row = addAutomation({
      kind: "health_check",
      hostSelector: { kind: "host", hostId: 7 },
      checkId: "db",
      to: "failing",
      cooldownMinutes: 0,
    });
    triggerState.set(`${row.id}:7:web`, { lastObservedState: "recovered" });

    await triggers.onHealthCheck({
      hostId: 7,
      userId: "user-1",
      checkId: "web",
      ok: false,
    });

    expect(run).not.toHaveBeenCalled();
  });
});

describe("onDockerEvent", () => {
  it("fires for a matching container and event", async () => {
    addAutomation({
      kind: "docker_event",
      hostSelector: { kind: "host", hostId: 7 },
      container: "api",
      event: "exited",
      cooldownMinutes: 0,
    });

    await triggers.onDockerEvent({
      hostId: 7,
      ownerUserId: "user-1",
      container: "api",
      event: "exited",
    });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores a different container", async () => {
    addAutomation({
      kind: "docker_event",
      hostSelector: { kind: "host", hostId: 7 },
      container: "api",
      event: "exited",
      cooldownMinutes: 0,
    });

    await triggers.onDockerEvent({
      hostId: 7,
      ownerUserId: "user-1",
      container: "worker",
      event: "exited",
    });

    expect(run).not.toHaveBeenCalled();
  });
});

describe("listAutomationWatchedHosts", () => {
  it("collects hosts from metric triggers so they can be polled headlessly", async () => {
    addAutomation({
      kind: "metric_threshold",
      hostSelector: { kind: "hosts", hostIds: [3, 4] },
      metric: { path: "cpu.percent" },
      operator: ">",
      value: 90,
      cooldownMinutes: 15,
    });

    const watched = await triggers.listAutomationWatchedHosts();

    expect([...watched.keys()].sort()).toEqual([3, 4]);
  });

  it("ignores triggers that do not need heavy collection", async () => {
    addAutomation({
      kind: "host_status",
      hostSelector: { kind: "host", hostId: 3 },
      to: "offline",
      cooldownMinutes: 0,
    });

    expect((await triggers.listAutomationWatchedHosts()).size).toBe(0);
  });
});
