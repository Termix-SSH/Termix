class RequestQueue {
  private queues = new Map<number, Array<() => Promise<unknown>>>();
  private processing = new Set<number>();
  private requestTimeout = 60000;

  async queueRequest<T>(hostId: number, request: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const wrappedRequest = async () => {
        try {
          const result = await Promise.race<T>([
            request(),
            new Promise<never>((_, rej) =>
              setTimeout(
                () =>
                  rej(
                    new Error(
                      `Request timeout after ${this.requestTimeout}ms for host ${hostId}`,
                    ),
                  ),
                this.requestTimeout,
              ),
            ),
          ]);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      const queue = this.queues.get(hostId) || [];
      queue.push(wrappedRequest);
      this.queues.set(hostId, queue);
      this.processQueue(hostId);
    });
  }

  private async processQueue(hostId: number): Promise<void> {
    if (this.processing.has(hostId)) return;

    this.processing.add(hostId);
    const queue = this.queues.get(hostId) || [];

    while (queue.length > 0) {
      const request = queue.shift();
      if (request) {
        try {
          await request();
        } catch {
          // expected
        }
      }
    }

    this.processing.delete(hostId);
    const currentQueue = this.queues.get(hostId);
    if (currentQueue && currentQueue.length > 0) {
      this.processQueue(hostId);
    }
  }
}

interface CachedMetrics {
  data: unknown;
  timestamp: number;
  hostId: number;
}

class MetricsCache {
  private cache = new Map<number, CachedMetrics>();
  private ttl = 30000;

  get(hostId: number): unknown | null {
    const cached = this.cache.get(hostId);
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.data;
    }
    return null;
  }

  set(hostId: number, data: unknown): void {
    this.cache.set(hostId, {
      data,
      timestamp: Date.now(),
      hostId,
    });
  }

  clear(hostId?: number): void {
    if (hostId) {
      this.cache.delete(hostId);
    } else {
      this.cache.clear();
    }
  }
}

interface AuthFailureRecord {
  count: number;
  lastFailure: number;
  reason: "TOTP" | "AUTH" | "TIMEOUT";
  permanent: boolean;
}

class AuthFailureTracker {
  private failures = new Map<number, AuthFailureRecord>();
  private maxRetries = 3;
  private backoffBase = 5000;

  recordFailure(
    hostId: number,
    reason: "TOTP" | "AUTH" | "TIMEOUT",
    permanent = false,
  ): void {
    const existing = this.failures.get(hostId);
    if (existing) {
      existing.count++;
      existing.lastFailure = Date.now();
      existing.reason = reason;
      if (permanent) existing.permanent = true;
    } else {
      this.failures.set(hostId, {
        count: 1,
        lastFailure: Date.now(),
        reason,
        permanent,
      });
    }
  }

  shouldSkip(hostId: number): boolean {
    const record = this.failures.get(hostId);
    if (!record) return false;

    if (record.reason === "TOTP" || record.permanent) {
      return true;
    }

    if (record.count >= this.maxRetries) {
      return true;
    }

    const backoffTime = this.backoffBase * Math.pow(2, record.count - 1);
    const timeSinceFailure = Date.now() - record.lastFailure;

    return timeSinceFailure < backoffTime;
  }

  getSkipReason(hostId: number): string | null {
    const record = this.failures.get(hostId);
    if (!record) return null;

    if (record.reason === "TOTP") {
      return "TOTP authentication required (metrics unavailable)";
    }

    if (record.permanent) {
      return "Authentication permanently failed";
    }

    if (record.count >= this.maxRetries) {
      return `Too many authentication failures (${record.count} attempts)`;
    }

    const backoffTime = this.backoffBase * Math.pow(2, record.count - 1);
    const timeSinceFailure = Date.now() - record.lastFailure;
    const remainingTime = Math.ceil((backoffTime - timeSinceFailure) / 1000);

    if (timeSinceFailure < backoffTime) {
      return `Retry in ${remainingTime}s (attempt ${record.count}/${this.maxRetries})`;
    }

    return null;
  }

  reset(hostId: number): void {
    this.failures.delete(hostId);
  }

  cleanup(): void {
    const maxAge = 60 * 60 * 1000;
    const now = Date.now();

    for (const [hostId, record] of this.failures.entries()) {
      if (!record.permanent && now - record.lastFailure > maxAge) {
        this.failures.delete(hostId);
      }
    }
  }
}

class PollingBackoff {
  private failures = new Map<number, { count: number; nextRetry: number }>();
  private baseDelay = 30000;
  private maxDelay = 600000;
  private maxRetries = 5;

  recordFailure(hostId: number): void {
    const existing = this.failures.get(hostId) || { count: 0, nextRetry: 0 };
    const delay = Math.min(
      this.baseDelay * Math.pow(2, existing.count),
      this.maxDelay,
    );
    this.failures.set(hostId, {
      count: existing.count + 1,
      nextRetry: Date.now() + delay,
    });
  }

  shouldSkip(hostId: number): boolean {
    const backoff = this.failures.get(hostId);
    if (!backoff) return false;

    if (backoff.count >= this.maxRetries) {
      return true;
    }

    return Date.now() < backoff.nextRetry;
  }

  getBackoffInfo(hostId: number): string | null {
    const backoff = this.failures.get(hostId);
    if (!backoff) return null;

    if (backoff.count >= this.maxRetries) {
      return `Max retries exceeded (${backoff.count} failures) - polling suspended`;
    }

    const remainingMs = backoff.nextRetry - Date.now();
    if (remainingMs > 0) {
      const remainingSec = Math.ceil(remainingMs / 1000);
      return `Retry in ${remainingSec}s (attempt ${backoff.count}/${this.maxRetries})`;
    }

    return null;
  }

  reset(hostId: number): void {
    this.failures.delete(hostId);
  }

  cleanup(): void {
    const maxAge = 60 * 60 * 1000;
    const now = Date.now();

    for (const [hostId, backoff] of this.failures.entries()) {
      if (backoff.count < this.maxRetries && now - backoff.nextRetry > maxAge) {
        this.failures.delete(hostId);
      }
    }
  }
}

/**
 * Limits how many async jobs run at once. Extra callers wait in FIFO order.
 * Used to stop host-metrics status/metrics polls from stampeding under load.
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

/**
 * How many metrics polls may run at once for a given number of polled hosts.
 *
 * A metrics poll is an SSH exec, so this cannot simply be unbounded — but the
 * old fixed ceiling of 5 meant a sweep of 500 hosts took ~40s against a 30s
 * interval, so polling fell permanently behind and a host could wait over a
 * minute for a "30 second" metric. Scaling with the fleet keeps a sweep inside
 * its interval; the cap keeps file descriptors and CPU bounded.
 */
export const METRICS_CONCURRENCY_ENV = "METRICS_POLL_CONCURRENCY";
const MIN_METRICS_CONCURRENCY = 5;
const MAX_METRICS_CONCURRENCY = 50;
/** Aim to spend about a twentieth of the interval per sweep wave. */
const HOSTS_PER_WORKER = 20;

export function metricsConcurrencyFor(
  hostCount: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const override = Number(env[METRICS_CONCURRENCY_ENV]);
  if (Number.isFinite(override) && override >= 1) {
    return Math.min(Math.floor(override), MAX_METRICS_CONCURRENCY);
  }

  const scaled = Math.ceil(Math.max(0, hostCount) / HOSTS_PER_WORKER);
  return Math.min(
    Math.max(scaled, MIN_METRICS_CONCURRENCY),
    MAX_METRICS_CONCURRENCY,
  );
}

/** Short-lived host snapshots for polling — avoids decrypting host rows every tick. */
export class HostPollCache<THost extends { id: number } = { id: number }> {
  private cache = new Map<
    number,
    { host: THost; userId: string; expiresAt: number }
  >();

  constructor(private readonly ttlMs = 30_000) {}

  get(hostId: number, userId: string): THost | null {
    const entry = this.cache.get(hostId);
    if (!entry) return null;
    if (entry.userId !== userId || Date.now() >= entry.expiresAt) {
      this.cache.delete(hostId);
      return null;
    }
    return entry.host;
  }

  set(hostId: number, userId: string, host: THost): void {
    this.cache.set(hostId, {
      host,
      userId,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  invalidate(hostId?: number): void {
    if (hostId === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(hostId);
  }
}

/** TCP status checks are cheap relative to SSH metrics collection. */
export const statusPollLimiter = new ConcurrentLimiter(20);
/** SSH metrics execs are expensive; keep concurrency tight. */
export const metricsPollLimiter = new ConcurrentLimiter(5);
export const hostPollCache = new HostPollCache(30_000);

export const requestQueue = new RequestQueue();
export const metricsCache = new MetricsCache();
export const authFailureTracker = new AuthFailureTracker();
export const pollingBackoff = new PollingBackoff();
