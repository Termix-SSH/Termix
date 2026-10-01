export interface KeyedRequestCache<T> {
  get(
    key: string,
    loader: () => Promise<T>,
    options?: { force?: boolean },
  ): Promise<T>;
  peek(key: string, maxAgeMs?: number): T | null;
  set(key: string, value: T): void;
  invalidate(key?: string): void;
}

/** Bounded per-key cache with in-flight request coalescing. */
export function createKeyedRequestCache<T>(
  ttlMs: number,
  maxEntries = 100,
): KeyedRequestCache<T> {
  const values = new Map<string, { value: T; storedAt: number }>();
  const inflight = new Map<string, Promise<T>>();
  const versions = new Map<string, number>();

  const store = (key: string, value: T) => {
    values.delete(key);
    values.set(key, { value, storedAt: Date.now() });
    while (values.size > Math.max(1, maxEntries)) {
      const oldest = values.keys().next().value;
      if (oldest === undefined) break;
      values.delete(oldest);
    }
  };

  return {
    get(key, loader, options = {}) {
      const cached = values.get(key);
      if (!options.force && cached && Date.now() - cached.storedAt < ttlMs) {
        return Promise.resolve(cached.value);
      }

      const pending = inflight.get(key);
      if (pending) return pending;

      const version = versions.get(key) ?? 0;
      const request = loader()
        .then((value) => {
          if ((versions.get(key) ?? 0) === version) store(key, value);
          return value;
        })
        .finally(() => {
          if (inflight.get(key) === request) inflight.delete(key);
        });
      inflight.set(key, request);
      return request;
    },

    peek(key, maxAgeMs = Number.POSITIVE_INFINITY) {
      const cached = values.get(key);
      if (!cached || Date.now() - cached.storedAt > maxAgeMs) return null;
      values.delete(key);
      values.set(key, cached);
      return cached.value;
    },

    set(key, value) {
      versions.set(key, (versions.get(key) ?? 0) + 1);
      inflight.delete(key);
      store(key, value);
    },

    invalidate(key) {
      if (key === undefined) {
        for (const activeKey of inflight.keys()) {
          versions.set(activeKey, (versions.get(activeKey) ?? 0) + 1);
        }
        values.clear();
        inflight.clear();
      } else {
        versions.set(key, (versions.get(key) ?? 0) + 1);
        values.delete(key);
        inflight.delete(key);
      }
    },
  };
}
