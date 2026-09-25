import { describe, expect, it } from "vitest";
import { hostPayloadLegacy } from "../../src/backend/host-import.js";

describe("hostPayloadLegacy", () => {
  it("rebuilds the 2.8 statsConfig Termix-Mobile reads", () => {
    const { statsConfig } = hostPayloadLegacy(
      { metricsEnabled: false, metricsInterval: 45, enabledWidgets: ["cpu"] },
      { statusCheckEnabled: true, statusCheckInterval: null },
    ) as { statsConfig: Record<string, unknown> };

    expect(statsConfig).toMatchObject({
      enabledWidgets: ["cpu"],
      statusCheckEnabled: true,
      useGlobalStatusInterval: true,
      metricsEnabled: false,
      metricsInterval: 45,
      useGlobalMetricsInterval: false,
    });
  });

  it("carries a host's own status interval", () => {
    const { statsConfig } = hostPayloadLegacy(
      {},
      { statusCheckEnabled: false, statusCheckInterval: 120 },
    ) as { statsConfig: Record<string, unknown> };
    expect(statsConfig).toMatchObject({
      statusCheckEnabled: false,
      statusCheckInterval: 120,
      useGlobalStatusInterval: false,
    });
  });
});
