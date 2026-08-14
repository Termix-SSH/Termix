import { beforeEach, describe, expect, it } from "vitest";
import {
  chooseLocalAdaptiveAction,
  clearLocalAdaptiveEngine,
  getLocalAdaptiveStats,
  LOCAL_ADAPTIVE_ENGINE_KEY,
  recordLocalAdaptiveChoice,
  recordLocalAdaptiveOutcome,
} from "../../lib/local-adaptive-engine";

describe("local adaptive engine", () => {
  beforeEach(clearLocalAdaptiveEngine);

  it("returns an explainable fallback until evidence is confident", () => {
    recordLocalAdaptiveChoice("surface", "files", 1_000);
    recordLocalAdaptiveChoice("surface", "files", 1_001);

    expect(
      chooseLocalAdaptiveAction({
        scope: "surface",
        candidates: ["terminal", "files"],
        fallback: "terminal",
        now: 1_002,
        ttlMs: 100,
      }),
    ).toEqual({
      action: "terminal",
      confidence: expect.any(Number),
      reason: "insufficient-evidence",
      expiresAt: 1_102,
    });

    recordLocalAdaptiveChoice("surface", "files", 1_003);
    expect(
      chooseLocalAdaptiveAction({
        scope: "surface",
        candidates: ["terminal", "files"],
        fallback: "terminal",
        now: 1_004,
      }),
    ).toMatchObject({ action: "files", confidence: 1, reason: "learned" });
  });

  it("aggregates outcomes and latency with an EWMA", () => {
    recordLocalAdaptiveOutcome(
      "transfer:large",
      "direct",
      { success: true, latencyMs: 100 },
      1_000,
    );
    recordLocalAdaptiveOutcome(
      "transfer:large",
      "direct",
      { success: false, fallback: true, latencyMs: 200 },
      1_001,
    );

    expect(getLocalAdaptiveStats("transfer:large").direct).toMatchObject({
      weight: 0,
      observations: 2,
      successes: 1,
      cancellations: 0,
      fallbacks: 1,
      latencyEwmaMs: 125,
    });
  });

  it("decays old choices and excludes unavailable candidates", () => {
    const month = 30 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < 8; i++) {
      recordLocalAdaptiveChoice("surface", "docker", i);
    }
    for (let i = 0; i < 4; i++) {
      recordLocalAdaptiveChoice("surface", "files", month + i);
    }

    expect(
      chooseLocalAdaptiveAction({
        scope: "surface",
        candidates: ["terminal", "files"],
        fallback: "terminal",
        now: month + 10,
      }).action,
    ).toBe("files");
  });

  it("bounds local storage and recovers from malformed data", () => {
    for (let i = 0; i < 140; i++) {
      recordLocalAdaptiveChoice(`scope:${i}`, "action", i);
    }
    const stored = JSON.parse(
      localStorage.getItem(LOCAL_ADAPTIVE_ENGINE_KEY) ?? "{}",
    );
    expect(Object.keys(stored.scopes)).toHaveLength(128);

    localStorage.setItem(LOCAL_ADAPTIVE_ENGINE_KEY, "broken");
    expect(
      chooseLocalAdaptiveAction({
        scope: "surface",
        candidates: ["terminal", "files"],
        fallback: "terminal",
      }),
    ).toMatchObject({ action: "terminal", confidence: 0, reason: "fallback" });
  });
});
