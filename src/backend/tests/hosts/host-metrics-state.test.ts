import { describe, expect, it, vi } from "vitest";
import {
  ConcurrentLimiter,
  HostPollCache,
} from "../../hosts/host-metrics-state.js";

describe("ConcurrentLimiter", () => {
  it("never exceeds max concurrent runners", async () => {
    const limiter = new ConcurrentLimiter(2);
    let peak = 0;
    let current = 0;

    const job = async () => {
      current += 1;
      peak = Math.max(peak, current);
      await new Promise((r) => setTimeout(r, 30));
      current -= 1;
    };

    await Promise.all([
      limiter.run(job),
      limiter.run(job),
      limiter.run(job),
      limiter.run(job),
    ]);

    expect(peak).toBeLessThanOrEqual(2);
    expect(limiter.activeCount).toBe(0);
    expect(limiter.pendingCount).toBe(0);
  });

  it("runs waiters in FIFO order after a slot frees", async () => {
    const limiter = new ConcurrentLimiter(1);
    const order: number[] = [];

    const first = limiter.run(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 20));
    });
    const second = limiter.run(async () => {
      order.push(2);
    });
    const third = limiter.run(async () => {
      order.push(3);
    });

    await Promise.all([first, second, third]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("rejects invalid maxConcurrent", () => {
    expect(() => new ConcurrentLimiter(0)).toThrow(/maxConcurrent/);
  });
});

describe("HostPollCache", () => {
  it("returns cached host within TTL for the same user", () => {
    const cache = new HostPollCache<{ id: number; name: string }>(60_000);
    cache.set(1, "user-a", { id: 1, name: "alpha" });
    expect(cache.get(1, "user-a")).toEqual({ id: 1, name: "alpha" });
    expect(cache.get(1, "user-b")).toBeNull();
  });

  it("expires entries after TTL", () => {
    vi.useFakeTimers();
    const cache = new HostPollCache<{ id: number }>(1_000);
    cache.set(7, "u", { id: 7 });
    expect(cache.get(7, "u")).toEqual({ id: 7 });
    vi.advanceTimersByTime(1_001);
    expect(cache.get(7, "u")).toBeNull();
    vi.useRealTimers();
  });

  it("invalidate drops a host or the whole cache", () => {
    const cache = new HostPollCache<{ id: number }>(60_000);
    cache.set(1, "u", { id: 1 });
    cache.set(2, "u", { id: 2 });
    cache.invalidate(1);
    expect(cache.get(1, "u")).toBeNull();
    expect(cache.get(2, "u")).toEqual({ id: 2 });
    cache.invalidate();
    expect(cache.get(2, "u")).toBeNull();
  });
});
