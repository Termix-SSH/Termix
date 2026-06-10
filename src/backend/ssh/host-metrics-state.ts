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

export const requestQueue = new RequestQueue();
export const metricsCache = new MetricsCache();
export const authFailureTracker = new AuthFailureTracker();
export const pollingBackoff = new PollingBackoff();
