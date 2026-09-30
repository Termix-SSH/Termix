import { expect, it, vi } from "vitest";
import { createScheduler } from "../../src/backend/scheduler.js";

it("discards sustained breaches during maintenance but still runs scheduled work", async () => {
  const run = vi.fn(async () => ({ runId: 1, status: "success" as const }));
  const clearBreach = vi.fn(async () => {});
  const repository = {
    listDueSchedules: async () => [{ automationId: 2, intervalSeconds: 60 }],
    markScheduleTicked: vi.fn(),
    listOpenBreaches: async () => [
      {
        automationId: 1,
        stateKey: "7:cpu.percent",
        breachStartedAt: "2000-01-01T00:00:00Z",
      },
    ],
    findById: async () => ({
      id: 1,
      userId: "alice",
      enabled: true,
      definition: JSON.stringify({
        trigger: { kind: "metric_threshold", forSeconds: 60 },
      }),
    }),
    clearBreach,
    failStaleRunningRuns: vi.fn(),
    pruneRunsOlderThan: async () => 0,
  };
  const maintaining = vi.fn(async () => true);
  const scheduler = createScheduler({
    repository: repository as never,
    engine: { run },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    reconcile: [],
    isMaintaining: maintaining,
  });
  await scheduler.tick();
  expect(maintaining).toHaveBeenCalledWith("alice", 7);
  expect(clearBreach).toHaveBeenCalledWith(1, "7:cpu.percent");
  expect(run).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      automationId: 2,
      triggerType: "schedule",
    }),
  );
});
