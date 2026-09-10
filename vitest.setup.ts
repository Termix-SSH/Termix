import { afterEach, vi } from "vitest";

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/**
 * jsdom in this project ships without a `localStorage` global, and Node only
 * provides one when started with --localstorage-file (which persists to disk
 * and is shared across test files -- both wrong for tests). Suites that touch
 * storage therefore threw `Cannot read properties of undefined`, taking out
 * every test in the file rather than just the ones that used it.
 *
 * A per-process in-memory implementation is enough: it satisfies the Storage
 * interface the app uses and keeps nothing on disk.
 */
if (typeof globalThis.localStorage === "undefined") {
  const createMemoryStorage = (): Storage => {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    } as Storage;
  };

  Object.defineProperty(globalThis, "localStorage", {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});
