import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { pluginLogger: log };
});

const { createPluginSchedule } = await import("../../plugins/schedule.js");
const { DisposableBag } = await import("../../plugins/disposables.js");

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ctx.schedule", () => {
  it("repeats a job and stops it", async () => {
    const bag = new DisposableBag("fixture");
    const schedule = createPluginSchedule(bag, vi.fn());
    const job = vi.fn();

    const stop = schedule.every(1000, job);
    await vi.advanceTimersByTimeAsync(3000);
    expect(job).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(job).toHaveBeenCalledTimes(3);
    expect(bag.size).toBe(0);
  });

  it("runs straight away when asked", async () => {
    const schedule = createPluginSchedule(
      new DisposableBag("fixture"),
      vi.fn(),
    );
    const job = vi.fn();
    schedule.every(1000, job, { runNow: true });
    expect(job).toHaveBeenCalledTimes(1);
  });

  it("never overlaps a slow run with the next tick", async () => {
    const schedule = createPluginSchedule(
      new DisposableBag("fixture"),
      vi.fn(),
    );
    let running = 0;
    let peak = 0;
    schedule.every(100, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 350));
      running--;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(peak).toBe(1);
  });

  it("logs a failing job instead of throwing", async () => {
    const log = vi.fn();
    const schedule = createPluginSchedule(new DisposableBag("fixture"), log);
    schedule.every(100, () => {
      throw new Error("boom");
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(log).toHaveBeenCalledWith("Scheduled job failed", expect.any(Error));
  });

  it("clears every timer when the plugin is disposed", async () => {
    const bag = new DisposableBag("fixture");
    const schedule = createPluginSchedule(bag, vi.fn());
    const repeating = vi.fn();
    const once = vi.fn();
    schedule.every(100, repeating, { jitterMs: 50 });
    schedule.after(500, once);

    await bag.disposeAll();
    await vi.advanceTimersByTimeAsync(2000);
    expect(repeating).not.toHaveBeenCalled();
    expect(once).not.toHaveBeenCalled();
  });

  it("runs a one-off job once and can cancel it", async () => {
    const bag = new DisposableBag("fixture");
    const schedule = createPluginSchedule(bag, vi.fn());
    const once = vi.fn();
    schedule.after(100, once);
    const cancelled = vi.fn();
    const cancel = schedule.after(100, cancelled);
    cancel();

    await vi.advanceTimersByTimeAsync(500);
    expect(once).toHaveBeenCalledOnce();
    expect(cancelled).not.toHaveBeenCalled();
    expect(bag.size).toBe(0);
  });
});
