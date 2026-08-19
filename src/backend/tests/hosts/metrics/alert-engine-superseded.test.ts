import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Once the alert rules have been migrated into automations, both systems hold
 * a copy of every rule. If the old engine kept evaluating, every alert would
 * be delivered twice.
 */

const listEnabledRulesForHost = vi.fn();
const listEnabledRulesForHostUser = vi.fn();
const createFiring = vi.fn();

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentAlertRepository: () => ({
    listEnabledRulesForHost,
    listEnabledRulesForHostUser,
    createFiring,
    pruneFiringsOlderThan: vi.fn(),
    listEnabledChannelsForRule: vi.fn(async () => []),
    findRuleById: vi.fn(async () => null),
    getHostDisplayName: vi.fn(async () => "host"),
  }),
}));

vi.mock("../../../utils/logger.js", () => ({
  statsLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../utils/notification-sender.js", () => ({
  sendNotification: vi.fn(async () => undefined),
}));

vi.mock("../../../utils/discord-sender.js", () => ({
  sendDiscord: vi.fn(async () => undefined),
}));

const alertEngineModule =
  await import("../../../hosts/metrics/alert-engine.js");

const cpuRule = {
  id: 1,
  userId: "user-1",
  hostId: null,
  name: "CPU",
  enabled: true,
  triggerType: "cpu_threshold",
  thresholdValue: 50,
  thresholdDurationSeconds: 0,
  cooldownMinutes: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  listEnabledRulesForHost.mockResolvedValue([cpuRule]);
  listEnabledRulesForHostUser.mockResolvedValue([cpuRule]);
});

describe("AlertEngine before migration", () => {
  it("still evaluates rules", async () => {
    expect(alertEngineModule.isAlertEngineSuperseded()).toBe(false);

    await alertEngineModule.AlertEngine.getInstance().evaluateMetrics(7, {
      cpu: { percent: 90 },
    });

    expect(listEnabledRulesForHost).toHaveBeenCalled();
  });
});

describe("AlertEngine after migration", () => {
  it("stops evaluating every trigger type", async () => {
    alertEngineModule.markAlertEngineSuperseded();
    expect(alertEngineModule.isAlertEngineSuperseded()).toBe(true);

    const engine = alertEngineModule.AlertEngine.getInstance();
    await engine.evaluateMetrics(7, { cpu: { percent: 99 } });
    await engine.evaluateStatus(7, false);
    await engine.evaluateHealthCheck(7, "user-1", "web", false);
    await engine.evaluateUserLogin(7, "user-1", "root", "10.0.0.1");

    // Nothing is even loaded, so nothing can be delivered a second time.
    expect(listEnabledRulesForHost).not.toHaveBeenCalled();
    expect(listEnabledRulesForHostUser).not.toHaveBeenCalled();
    expect(createFiring).not.toHaveBeenCalled();
  });
});
