/**
 * Limits how many async jobs run at once. Extra callers wait in FIFO order.
 */
export class ConcurrentLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private maxConcurrent: number) {
    if (maxConcurrent < 1) {
      throw new Error("maxConcurrent must be >= 1");
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get pendingCount(): number {
    return this.waiters.length;
  }

  get limit(): number {
    return this.maxConcurrent;
  }

  /**
   * Changes the ceiling at runtime.
   *
   * Raising it wakes the waiters the new headroom allows, so a queue that built
   * up under the old limit drains at once instead of one job at a time as
   * running work finishes. Lowering it never interrupts work already running;
   * the new limit simply applies from the next release onward.
   */
  setLimit(maxConcurrent: number): void {
    if (maxConcurrent < 1) {
      throw new Error("maxConcurrent must be >= 1");
    }
    this.maxConcurrent = maxConcurrent;
    this.releaseWaiters();
  }

  /**
   * Wakes as many queued callers as there is now room for.
   *
   * `woken` counts callers that have been resumed but have not yet reached the
   * `active += 1` on the far side of their await. Without it the occupancy
   * looks lower than it really is for a microtask, and the loop would release
   * past the ceiling.
   */
  private releaseWaiters(): void {
    while (
      this.active + this.woken < this.maxConcurrent &&
      this.waiters.length > 0
    ) {
      this.woken += 1;
      this.waiters.shift()!();
    }
  }

  private woken = 0;

  async run<T>(fn: () => Promise<T>): Promise<T> {
    // Queue behind anything already woken, so a caller arriving mid-handoff
    // cannot jump the queue and push occupancy past the ceiling.
    if (this.active + this.woken >= this.maxConcurrent) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
      // Resumed by a slot handoff; that reservation is now consumed.
      this.woken = Math.max(0, this.woken - 1);
    }

    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.releaseWaiters();
    }
  }
}
