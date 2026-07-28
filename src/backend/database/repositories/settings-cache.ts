/**
 * Synchronous read-through cache for the settings table.
 *
 * 27 call sites read settings synchronously — during startup, inside request
 * handlers, and from the guacd server bootstrap. On SQLite that works because
 * better-sqlite3 is synchronous; on Postgres or MySQL there is no synchronous
 * query at all, and making all 27 async would push `await` through code paths
 * that have no business being asynchronous.
 *
 * Settings are a handful of low-cardinality configuration rows that change
 * rarely and are read constantly, so they are cached in full. Writes go through
 * SettingsRepository, which updates the cache in the same call, and the cache is
 * primed once at startup.
 */

let cache: Map<string, string> | null = null;

export function isSettingsCachePrimed(): boolean {
  return cache !== null;
}

/** Loads the full settings table. Called once during startup. */
export function primeSettingsCache(
  rows: { key: string; value: string }[],
): void {
  cache = new Map(rows.map((row) => [row.key, row.value]));
}

/**
 * Reads a cached setting.
 *
 * Returns null both for "not set" and "cache not primed yet" — every caller
 * already treats a missing setting as "use the default", and startup ordering
 * means a read before priming should behave the same way rather than throw.
 */
export function readCachedSetting(key: string): string | null {
  return cache?.get(key) ?? null;
}

/** Keeps the cache in step with a write. */
export function updateCachedSetting(key: string, value: string): void {
  cache?.set(key, value);
}

export function forgetCachedSetting(key: string): void {
  cache?.delete(key);
}

/** Test seam. */
export function resetSettingsCache(): void {
  cache = null;
}
