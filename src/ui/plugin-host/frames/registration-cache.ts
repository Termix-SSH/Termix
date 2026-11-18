/**
 * What a framed plugin registered last time, per user, plugin and asset
 * version, so the shell can replay it at boot without starting the plugin's
 * background frame. Kept in memory and in IndexedDB; when storage is blocked
 * (private windows, previews) it lives in memory only and the page still works.
 *
 * Registrations stay in wire form (functions are references, not code), and
 * answers and values are kept only when they are plain JSON.
 *
 * Registrations and live keys also go to the server, per user, so a new
 * browser or device starts warm. Answers and values stay in this browser.
 */

import { authApi } from "@/main-axios";
import { isElectron } from "@/lib/electron";

export interface CachedRegistration {
  rid: string;
  kind: string;
  raw: unknown;
}

export interface CachedPlugin {
  version: string;
  /** Work the frame keeps doing by itself; any entry keeps it running. */
  live: string[];
  registrations: CachedRegistration[];
  /** Function answers, keyed by registration, field and arguments. */
  answers: Record<string, unknown>;
  /** The last value the frame sent for each hook key. */
  values: Record<string, unknown>;
}

const DB_NAME = "termix-frame-cache";
const STORE = "plugins";
const DB_TIMEOUT_MS = 1_500;
const WRITE_DELAY_MS = 1_000;
const MAX_ANSWERS = 2_000;

/** Longest boot waits for the server copy before going on without it. */
const SERVER_TIMEOUT_MS = 3_000;
const UPLOAD_DELAY_MS = 3_000;
/** Under the server's 2 MB body limit. */
const UPLOAD_MAX_BYTES = 1_500_000;

interface ServerEntry {
  version: string;
  live: string[];
  registrations: CachedRegistration[];
}

const memory = new Map<string, CachedPlugin>();
const writes = new Map<string, ReturnType<typeof setTimeout>>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

export function cacheKey(user: string, pluginId: string): string {
  return `${user}\u0000${pluginId}`;
}

function withTimeout<T>(
  promise: Promise<T>,
  fallback: T,
  ms = DB_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = withTimeout(
    new Promise<IDBDatabase | null>((resolve) => {
      try {
        if (typeof indexedDB === "undefined") {
          resolve(null);
          return;
        }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }),
    null,
  );
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  return withTimeout(
    openDb().then(
      (db) =>
        new Promise<T | undefined>((resolve) => {
          if (!db) {
            resolve(undefined);
            return;
          }
          try {
            const request = action(
              db.transaction(STORE, mode).objectStore(STORE),
            );
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(undefined);
          } catch {
            resolve(undefined);
          }
        }),
    ),
    undefined,
  );
}

function isEntry(value: unknown): value is CachedPlugin {
  const entry = value as CachedPlugin | null;
  return (
    !!entry &&
    typeof entry.version === "string" &&
    Array.isArray(entry.live) &&
    Array.isArray(entry.registrations) &&
    !!entry.answers &&
    typeof entry.answers === "object" &&
    !!entry.values &&
    typeof entry.values === "object"
  );
}

let serverSeed: Promise<Map<string, ServerEntry>> | null = null;
/** What the server holds per plugin, as sent or read, to skip same uploads. */
const serverSent = new Map<string, string>();
const uploads = new Map<string, ServerEntry>();
let uploadTimer: ReturnType<typeof setTimeout> | null = null;

const clientKind = () => (isElectron() ? "desktop" : "web");

/**
 * The user key ends with a hash of the user's grants. The server copy keeps
 * it in the version, so a grant change never replays another set.
 */
function serverVersion(user: string, version: string): string {
  return `${version}:${user.slice(user.lastIndexOf(":") + 1)}`;
}

function serverText(entry: ServerEntry): string {
  return JSON.stringify([entry.version, entry.live, entry.registrations]);
}

function isServerEntry(value: unknown): value is ServerEntry {
  const entry = value as ServerEntry | null;
  return (
    !!entry &&
    typeof entry.version === "string" &&
    Array.isArray(entry.live) &&
    Array.isArray(entry.registrations)
  );
}

function loadServerSeed(): Promise<Map<string, ServerEntry>> {
  serverSeed ??= withTimeout(
    Promise.resolve()
      .then(() =>
        authApi.get<{ entries?: Record<string, unknown> }>(
          "/plugins/frame-registrations",
          { params: { client: clientKind() } },
        ),
      )
      .then((response) => {
        const map = new Map<string, ServerEntry>();
        for (const [pluginId, entry] of Object.entries(
          response.data?.entries ?? {},
        )) {
          if (!isServerEntry(entry)) continue;
          map.set(pluginId, entry);
          serverSent.set(pluginId, serverText(entry));
        }
        return map;
      })
      .catch(() => new Map<string, ServerEntry>()),
    new Map<string, ServerEntry>(),
    SERVER_TIMEOUT_MS,
  );
  return serverSeed;
}

/** The cached entry for this asset version, or null. */
export async function readCachedPlugin(
  user: string,
  pluginId: string,
  version: string,
): Promise<CachedPlugin | null> {
  const key = cacheKey(user, pluginId);
  // Asked alongside this browser's store, used only when it has nothing.
  const seed = loadServerSeed();
  let entry: unknown = memory.get(key);
  if (!entry) {
    entry = await run<unknown>("readonly", (store) => store.get(key));
    if (isEntry(entry)) memory.set(key, entry);
  }
  if (isEntry(entry) && entry.version === version) return entry;

  const remote = (await seed).get(pluginId);
  if (!remote || remote.version !== serverVersion(user, version)) return null;
  const seeded: CachedPlugin = {
    version,
    live: remote.live,
    registrations: remote.registrations,
    answers: {},
    values: {},
  };
  memory.set(key, seeded);
  void run("readwrite", (store) => store.put(seeded, key));
  return seeded;
}

async function flushUploads(): Promise<void> {
  uploadTimer = null;
  await loadServerSeed();
  const batches: Array<Record<string, ServerEntry>> = [];
  let batch: Record<string, ServerEntry> = {};
  let size = 0;
  for (const [pluginId, entry] of uploads) {
    const text = serverText(entry);
    if (serverSent.get(pluginId) === text) continue;
    if (size > 0 && size + text.length > UPLOAD_MAX_BYTES) {
      batches.push(batch);
      batch = {};
      size = 0;
    }
    batch[pluginId] = entry;
    size += text.length;
  }
  uploads.clear();
  if (size > 0) batches.push(batch);
  for (const entries of batches) {
    try {
      await authApi.put("/plugins/frame-registrations", {
        client: clientKind(),
        entries,
      });
      for (const [pluginId, entry] of Object.entries(entries)) {
        serverSent.set(pluginId, serverText(entry));
      }
    } catch {
      // The next change tries again; this browser's copy still works.
    }
  }
}

function queueUpload(user: string, pluginId: string, entry: CachedPlugin) {
  uploads.set(pluginId, {
    version: serverVersion(user, entry.version),
    live: entry.live,
    registrations: entry.registrations,
  });
  uploadTimer ??= setTimeout(() => void flushUploads(), UPLOAD_DELAY_MS);
}

/** Saves an entry; the stored copy is written a moment later. */
export function writeCachedPlugin(
  user: string,
  pluginId: string,
  entry: CachedPlugin,
): void {
  const key = cacheKey(user, pluginId);
  memory.set(key, entry);
  queueUpload(user, pluginId, entry);
  const pending = writes.get(key);
  if (pending) clearTimeout(pending);
  writes.set(
    key,
    setTimeout(() => {
      writes.delete(key);
      const latest = memory.get(key);
      if (!latest) return;
      void run("readwrite", (store) => store.put(latest, key));
    }, WRITE_DELAY_MS),
  );
}

/** Only plain JSON (no functions, elements or class instances) is kept. */
export function isPlainValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null) return true;
  const type = typeof value;
  if (type === "string" || type === "boolean") return true;
  if (type === "number") return Number.isFinite(value as number);
  if (type !== "object") return false;
  if (Array.isArray(value)) {
    return (
      value.length <= 500 && value.every((v) => isPlainValue(v, depth + 1))
    );
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    entries.length <= 200 &&
    entries.every(([, v]) => v === undefined || isPlainValue(v, depth + 1))
  );
}

/** Keeps the newest answers when there are too many. */
export function trimAnswers(
  answers: Record<string, unknown>,
): Record<string, unknown> {
  const keys = Object.keys(answers);
  if (keys.length <= MAX_ANSWERS) return answers;
  return Object.fromEntries(
    keys.slice(keys.length - MAX_ANSWERS).map((key) => [key, answers[key]]),
  );
}

/** Answers may depend on grants, so a permission change drops them all. */
export function dropCachedAnswers(): void {
  for (const [key, entry] of memory) {
    memory.set(key, { ...entry, answers: {} });
  }
  void run("readwrite", (store) => store.clear()).then(() => {
    for (const [key, entry] of memory) {
      void run("readwrite", (store) => store.put(entry, key));
    }
  });
}

function forgetServer(): void {
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = null;
  uploads.clear();
  serverSent.clear();
  serverSeed = null;
}

/** Logout: nothing of the last user stays behind. */
export function clearRegistrationCache(): void {
  for (const timer of writes.values()) clearTimeout(timer);
  writes.clear();
  memory.clear();
  forgetServer();
  void run("readwrite", (store) => store.clear());
}

/** Test seam. */
export function resetRegistrationCache(): void {
  for (const timer of writes.values()) clearTimeout(timer);
  writes.clear();
  memory.clear();
  forgetServer();
  dbPromise = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("termix:logout", clearRegistrationCache);
  window.addEventListener("permissionsChanged", dropCachedAnswers);
}
