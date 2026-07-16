/**
 * Short-lived in-memory cache with in-flight request deduplication.
 * Concurrent callers share one loader promise; failures are not cached.
 */
export type TtlRequestCache<T> = {
  get(loader: () => Promise<T>): Promise<T>;
  invalidate(): void;
  peek(): T | null;
};

export function createTtlRequestCache<T>(ttlMs: number): TtlRequestCache<T> {
  let cached: { value: T; expiresAt: number } | null = null;
  let inflight: Promise<T> | null = null;

  return {
    get(loader: () => Promise<T>): Promise<T> {
      if (cached && Date.now() < cached.expiresAt) {
        return Promise.resolve(cached.value);
      }
      if (inflight) {
        return inflight;
      }

      inflight = (async () => {
        try {
          const value = await loader();
          cached = { value, expiresAt: Date.now() + ttlMs };
          return value;
        } finally {
          inflight = null;
        }
      })();

      return inflight;
    },

    invalidate(): void {
      cached = null;
    },

    peek(): T | null {
      if (cached && Date.now() < cached.expiresAt) {
        return cached.value;
      }
      return null;
    },
  };
}
