/**
 * Shared vitest setup for core and for every plugin suite.
 *
 * The root vitest.setup.ts re-exports this so there is one copy of the
 * polyfills rather than two that drift apart.
 */

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

/**
 * A plain plugin host for components a test renders on its own: keys come
 * back as text, every permission is held, and nothing reaches a server.
 * renderWithApp installs Termix's real host instead, which takes precedence.
 */
const noop = () => {};
const offline = () =>
  Promise.reject(new Error("No plugin API in a unit test; mock it"));
(globalThis as Record<string, unknown>).__termixTestPluginHost = {
  usePluginId: () => "test-plugin",
  useTranslation: () => ({
    t: (key: string) => key,
    language: "en",
  }),
  usePermission: () => true,
  useSettings: () => ({ values: {}, loaded: true, save: async () => {} }),
  useHost: () => null,
  useHosts: () => ({ hosts: [], loaded: true }),
  useCurrentUser: () => null,
  useTheme: () => ({ theme: "dark" }),
  toast: { success: noop, error: noop, info: noop, warning: noop },
  getApi: () => ({
    get: offline,
    delete: offline,
    post: offline,
    put: offline,
    patch: offline,
  }),
  useTabs: () => ({
    openTab: noop,
    openSingletonTab: noop,
    closeTab: noop,
    getLayout: () => null,
    applyLayout: async () => ({ skipped: [] }),
    onChange: () => noop,
    onReady: () => noop,
  }),
  invokeAction: async () => undefined,
  useSshAuthTypes: () => ({
    types: ["password", "key", "credential", "agent", "none"].map((type) => ({
      type,
      labelKey: type,
      pluginId: "core",
      credentialType: type === "password" || type === "key",
      supportsBackground: type !== "none",
    })),
    loaded: true,
  }),
  useSlotContributions: () => [],
};

afterEach(() => {
  vi.restoreAllMocks();
});
