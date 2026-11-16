/**
 * One short lived cache for the core reads plugin frames repeat on every
 * page load (permissions, the user, preferences, plugin settings). Each frame
 * asked for its own copy before, so a login made dozens of identical calls.
 *
 * Entries live a few seconds and the whole cache is dropped on any write,
 * login, logout or permission change, so a frame never sees a value older
 * than the last thing the user changed.
 */

export const CORE_READ_TTL_MS = 5_000;

const CACHEABLE = [
  /^\/rbac\/permissions\/me$/,
  /^\/users\/me$/,
  /^\/user-preferences$/,
  /^\/plugins$/,
  /^\/plugins\/[a-z][a-z0-9-]{1,39}\/settings\/(admin|user|host\/\d+)$/,
];

export interface CachedCoreResponse {
  status: number;
  type: string;
  body: ArrayBuffer;
}

interface Entry {
  at: number;
  value: Promise<CachedCoreResponse>;
}

const entries = new Map<string, Entry>();
let generation = 0;

export function isCacheableCoreRead(method: string, path: string): boolean {
  return method === "GET" && CACHEABLE.some((pattern) => pattern.test(path));
}

/**
 * The cached answer for a read, or a fresh one from load. Only 200 answers
 * are kept; a failed or refused read is asked again next time.
 */
export function cachedCoreRead(
  key: string,
  load: () => Promise<CachedCoreResponse>,
  now: () => number = Date.now,
): Promise<CachedCoreResponse> {
  const hit = entries.get(key);
  if (hit && now() - hit.at < CORE_READ_TTL_MS) return hit.value;
  const started = generation;
  const value = load().then(
    (response) => {
      if (response.status !== 200 || started !== generation) {
        if (entries.get(key)?.value === value) entries.delete(key);
      }
      return response;
    },
    (error: unknown) => {
      if (entries.get(key)?.value === value) entries.delete(key);
      throw error;
    },
  );
  entries.set(key, { at: now(), value });
  return value;
}

/** Each caller gets its own copy, since a body may be transferred away. */
export function copyCoreResponse(
  response: CachedCoreResponse,
): CachedCoreResponse {
  return { ...response, body: response.body.slice(0) };
}

export function clearCoreReadCache(): void {
  generation++;
  entries.clear();
}

/** Called for every request the shell makes: a write drops the cache. */
export function noteCoreRequest(method: string | undefined): void {
  const verb = (method ?? "GET").toUpperCase();
  if (verb !== "GET" && verb !== "HEAD" && verb !== "OPTIONS") {
    clearCoreReadCache();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("termix:logout", clearCoreReadCache);
  window.addEventListener("permissionsChanged", clearCoreReadCache);
  window.addEventListener("termix:plugin-settings-changed", clearCoreReadCache);
}
