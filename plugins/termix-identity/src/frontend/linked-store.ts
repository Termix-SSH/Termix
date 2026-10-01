import type { TermixIdApi } from "./api";

/**
 * Which credentials have a published key, shared by every credential badge
 * so the list fetches once instead of once per row. The panel calls
 * refresh() after it publishes or removes a key.
 */
export function createLinkedStore(
  api: TermixIdApi,
  allowed: () => Promise<boolean>,
) {
  let ids = new Set<number>();
  let loading: Promise<void> | null = null;
  let loaded = false;
  const listeners = new Set<() => void>();

  const refresh = (): Promise<void> => {
    loading = (async () => {
      try {
        ids = (await allowed())
          ? new Set((await api.linkedCredentialIds()).credentialIds)
          : new Set();
      } catch {
        // Badges are a hint; a failed lookup just shows none.
      }
      loaded = true;
      listeners.forEach((listener) => listener());
    })();
    return loading;
  };

  return {
    has: (id: number) => ids.has(id),
    ids: () => ids,
    ensure: () => {
      if (!loaded && !loading) void refresh();
    },
    refresh,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type LinkedStore = ReturnType<typeof createLinkedStore>;
