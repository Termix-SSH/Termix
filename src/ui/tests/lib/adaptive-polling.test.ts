import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeAdaptivePollDelay,
  runAdaptivePolling,
} from "../../lib/adaptive-polling.ts";

describe("adaptive polling", () => {
  afterEach(() => vi.useRealTimers());

  it("slows down after stable results and backs off after failures", () => {
    const policy = {
      minIntervalMs: 1000,
      maxIntervalMs: 16000,
      stablePollsPerStep: 2,
      jitterRatio: 0,
    };
    expect(
      computeAdaptivePollDelay(policy, {
        stablePolls: 4,
        consecutiveFailures: 0,
      }),
    ).toBe(4000);
    expect(
      computeAdaptivePollDelay(policy, {
        stablePolls: 0,
        consecutiveFailures: 3,
      }),
    ).toBe(8000);
  });

  it("adds bounded jitter", () => {
    const policy = {
      minIntervalMs: 1000,
      maxIntervalMs: 10000,
      jitterRatio: 0.1,
    };
    const state = { stablePolls: 0, consecutiveFailures: 2 };
    expect(computeAdaptivePollDelay(policy, state, () => 0)).toBe(3600);
    expect(computeAdaptivePollDelay(policy, state, () => 1)).toBe(4400);
  });

  it("never overlaps requests", async () => {
    vi.useFakeTimers();
    let resolvePoll!: () => void;
    const poll = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePoll = resolve;
        }),
    );
    const stop = runAdaptivePolling(
      poll,
      { minIntervalMs: 1000, maxIntervalMs: 4000, jitterRatio: 0 },
      { runImmediately: true },
    );

    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(poll).toHaveBeenCalledTimes(1);
    resolvePoll();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
  });

  it("slows stable data and resets when data changes", async () => {
    vi.useFakeTimers();
    const poll = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const stop = runAdaptivePolling(
      poll,
      {
        minIntervalMs: 1000,
        maxIntervalMs: 8000,
        stablePollsPerStep: 1,
        jitterRatio: 0,
      },
      { runImmediately: true },
    );

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2000);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(poll).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(poll).toHaveBeenCalledTimes(4);
    stop();
  });
});
