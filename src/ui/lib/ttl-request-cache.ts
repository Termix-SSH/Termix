/**
 * Short-lived in-memory cache with in-flight request deduplication.
 * Concurrent callers share one loader promise; failures are not cached.
 * A load still running when invalidate() is called may hold data from before
 * the change, so it is neither cached nor shared: its callers get a fresh read.
 */
export type TtlRequestCache<T> = {
  get(loader: () => Promise<T>): Promise<T>;
  invalidate(): void;
  peek(): T | null;
};

export function createTtlRequestCache<T>(ttlMs: number): TtlRequestCache<T> {
  let cached: { value: T; expiresAt: number } | null = null;
  let inflight: Promise<T> | null = null;
  let generation = 0;

  const get = (loader: () => Promise<T>): Promise<T> => {
    if (cached && Date.now() < cached.expiresAt) {
      return Promise.resolve(cached.value);
    }
    if (inflight) {
      return inflight;
    }

    const started = generation;
    inflight = (async () => {
      try {
        const value = await loader();
        if (started !== generation) return get(loader);
        cached = { value, expiresAt: Date.now() + ttlMs };
        return value;
      } finally {
        if (started === generation) inflight = null;
      }
    })();

    return inflight;
  };

  return {
    get,

    invalidate(): void {
      generation += 1;
      cached = null;
      inflight = null;
    },

    peek(): T | null {
      if (cached && Date.now() < cached.expiresAt) {
        return cached.value;
      }
      return null;
    },
  };
}
