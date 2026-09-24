import { describe, expect, it } from "vitest";
import { ConcurrentLimiter } from "../../../hosts/status/limiter.js";

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
