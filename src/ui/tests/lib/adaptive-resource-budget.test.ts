import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeAdaptiveResourceBudget,
  runAdaptiveBackgroundTask,
} from "../../lib/adaptive-resource-budget";
import {
  clearLocalAdaptiveEngine,
  getLocalAdaptiveStats,
} from "../../lib/local-adaptive-engine";

describe("adaptive resource budget", () => {
  beforeEach(clearLocalAdaptiveEngine);

  it("uses hard environmental constraints before optional work", () => {
    expect(computeAdaptiveResourceBudget({ visible: false }).tier).toBe(
      "paused",
    );
    expect(
      computeAdaptiveResourceBudget({ visible: true, saveData: true }).tier,
    ).toBe("constrained");
    expect(
      computeAdaptiveResourceBudget({ visible: true, effectiveType: "3g" })
        .allowNetworkPrefetch,
    ).toBe(false);
  });

  it("scales eager work down on limited devices", () => {
    const eager = computeAdaptiveResourceBudget({
      visible: true,
      deviceMemoryGb: 8,
      hardwareConcurrency: 8,
    });
    expect(eager).toMatchObject({
      tier: "eager",
      maxPrefetchBytes: 512 * 1024,
      maxConcurrentNetworkPrefetches: 2,
    });

    const balanced = computeAdaptiveResourceBudget({
      visible: true,
      deviceMemoryGb: 4,
      hardwareConcurrency: 8,
    });
    expect(balanced).toMatchObject({
      tier: "balanced",
      maxPrefetchBytes: 128 * 1024,
      maxConcurrentNetworkPrefetches: 1,
    });
  });

  it("requires enough poor local feedback before degrading", () => {
    const environment = { visible: true, deviceMemoryGb: 8 };
    expect(
      computeAdaptiveResourceBudget(environment, {
        observations: 3,
        successes: 0,
        cancellations: 0,
        fallbacks: 0,
      }).tier,
    ).toBe("eager");
    expect(
      computeAdaptiveResourceBudget(environment, {
        observations: 4,
        successes: 2,
        cancellations: 0,
        fallbacks: 0,
      }),
    ).toMatchObject({ tier: "balanced", reason: "feedback" });
  });

  it("bounds concurrency and records aggregate task outcomes", async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = new Promise<void>((resolve) => (releaseFirst = resolve));
    const second = new Promise<void>((resolve) => (releaseSecond = resolve));

    expect(
      runAdaptiveBackgroundTask("module", "tab:terminal", () => first),
    ).toBe(true);
    expect(runAdaptiveBackgroundTask("module", "tab:files", () => second)).toBe(
      true,
    );
    expect(
      runAdaptiveBackgroundTask("module", "tab:docker", async () => {}),
    ).toBe(false);
    expect(
      runAdaptiveBackgroundTask(
        "network",
        "file-content:large",
        async () => {},
        {
          estimatedBytes: 512 * 1024 + 1,
        },
      ),
    ).toBe(false);

    releaseFirst();
    releaseSecond();
    await vi.waitFor(() => {
      expect(
        getLocalAdaptiveStats("resource-budget:module")["tab:terminal"]
          .successes,
      ).toBe(1);
      expect(
        getLocalAdaptiveStats("resource-budget:module")["tab:files"].successes,
      ).toBe(1);
    });
  });
});
