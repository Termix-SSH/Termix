import { describe, expect, it, vi } from "vitest";
import {
  canStartInitialMetrics,
  ConcurrentLimiter,
  HostPollCache,
  metricsConcurrencyFor,
} from "../../../hosts/metrics/state.js";

describe("initial metrics admission", () => {
  it("requires both an active viewer and a confirmed online status", () => {
    expect(canStartInitialMetrics("online", true)).toBe(true);
    expect(canStartInitialMetrics("reachable", true)).toBe(true);
    expect(canStartInitialMetrics("offline", true)).toBe(false);
    expect(canStartInitialMetrics(undefined, true)).toBe(false);
    expect(canStartInitialMetrics("online", false)).toBe(false);
    expect(canStartInitialMetrics(undefined, true, false)).toBe(true);
  });
});

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

  describe("setLimit", () => {
    it("releases queued waiters as soon as the ceiling is raised", async () => {
      const limiter = new ConcurrentLimiter(1);
      let running = 0;
      let peak = 0;
      const release: Array<() => void> = [];

      const job = () =>
        limiter.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise<void>((r) => release.push(r));
          running -= 1;
        });

      const jobs = [job(), job(), job(), job()];
      await new Promise((r) => setTimeout(r, 10));
      expect(peak).toBe(1);
      expect(limiter.pendingCount).toBe(3);

      // Widening must drain the backlog without waiting for the running job.
      limiter.setLimit(4);
      await new Promise((r) => setTimeout(r, 10));
      expect(peak).toBe(4);
      expect(limiter.pendingCount).toBe(0);

      release.forEach((fn) => fn());
      await Promise.all(jobs);
      expect(limiter.activeCount).toBe(0);
    });

    it("does not over-release beyond the new ceiling", async () => {
      const limiter = new ConcurrentLimiter(1);
      let running = 0;
      let peak = 0;
      const release: Array<() => void> = [];
      // Later waves of woken jobs enqueue their own resolvers, so draining has
      // to keep going until nothing is left rather than flushing a snapshot.
      const drain = async () => {
        while (release.length > 0) {
          release.splice(0).forEach((fn) => fn());
          await new Promise((r) => setTimeout(r, 5));
        }
      };

      const job = () =>
        limiter.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise<void>((r) => release.push(r));
          running -= 1;
        });

      const jobs = [job(), job(), job(), job(), job()];
      await new Promise((r) => setTimeout(r, 10));

      limiter.setLimit(3);
      await new Promise((r) => setTimeout(r, 10));
      expect(peak).toBe(3);
      expect(limiter.pendingCount).toBe(2);

      await drain();
      await Promise.all(jobs);
      expect(limiter.activeCount).toBe(0);
      expect(limiter.pendingCount).toBe(0);
    });

    it("lets running work finish when the ceiling shrinks", async () => {
      const limiter = new ConcurrentLimiter(4);
      let running = 0;
      let peak = 0;
      const release: Array<() => void> = [];
      const drain = async () => {
        while (release.length > 0) {
          release.splice(0).forEach((fn) => fn());
          await new Promise((r) => setTimeout(r, 5));
        }
      };

      const job = () =>
        limiter.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise<void>((r) => release.push(r));
          running -= 1;
        });

      const jobs = [job(), job(), job(), job(), job(), job()];
      await new Promise((r) => setTimeout(r, 10));
      expect(peak).toBe(4);

      // Shrinking never kills in-flight work; it applies to later releases.
      limiter.setLimit(2);
      expect(limiter.activeCount).toBe(4);

      await drain();
      await Promise.all(jobs);
      expect(limiter.activeCount).toBe(0);
      expect(limiter.pendingCount).toBe(0);
      // The two queued jobs ran only after the shrink, so they never pushed
      // occupancy back up to the old width.
      expect(peak).toBe(4);
    });

    it("rejects an invalid new limit", () => {
      const limiter = new ConcurrentLimiter(2);
      expect(() => limiter.setLimit(0)).toThrow(/maxConcurrent/);
      expect(limiter.limit).toBe(2);
    });
  });
});

describe("metricsConcurrencyFor", () => {
  it("keeps a floor for small installs", () => {
    expect(metricsConcurrencyFor(0, {})).toBe(5);
    expect(metricsConcurrencyFor(1, {})).toBe(5);
    expect(metricsConcurrencyFor(60, {})).toBe(5);
  });

  it("scales up with the fleet", () => {
    expect(metricsConcurrencyFor(200, {})).toBe(10);
    expect(metricsConcurrencyFor(500, {})).toBe(25);
  });

  it("caps so a huge fleet cannot exhaust the host", () => {
    expect(metricsConcurrencyFor(100000, {})).toBe(50);
  });

  it("lets an operator override the sizing", () => {
    expect(metricsConcurrencyFor(1000, { METRICS_POLL_CONCURRENCY: "8" })).toBe(
      8,
    );
  });

  it("still caps an oversized override", () => {
    expect(
      metricsConcurrencyFor(10, { METRICS_POLL_CONCURRENCY: "9999" }),
    ).toBe(50);
  });

  it("ignores a nonsense override", () => {
    expect(
      metricsConcurrencyFor(500, { METRICS_POLL_CONCURRENCY: "abc" }),
    ).toBe(25);
  });

  it("sweeps 500 hosts inside a 30s interval, which the old fixed 5 could not", () => {
    const POLL_MS = 400;
    const hosts = 500;
    const sweepAt = (c: number) => Math.ceil(hosts / c) * POLL_MS;

    expect(sweepAt(5)).toBeGreaterThan(30_000);
    expect(sweepAt(metricsConcurrencyFor(hosts, {}))).toBeLessThan(30_000);
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
