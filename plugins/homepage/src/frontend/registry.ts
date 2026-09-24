import { useSyncExternalStore } from "react";

/**
 * A keyed, reactive list of contributions.
 *
 * Widgets register on import, so anything rendered from a registry has to
 * re-render when it changes. The snapshot array is cached until the next
 * change because useSyncExternalStore compares by identity and loops forever
 * on a fresh array.
 */
export interface Registry<T extends { id: string }> {
  /** Adds or replaces by id. The disposer only removes this exact entry. */
  register: (item: T) => () => void;
  unregister: (id: string) => void;
  get: (id: string) => T | undefined;
  list: () => T[];
  subscribe: (listener: () => void) => () => void;
  /** React hook over list(). */
  useList: () => T[];
  reset: () => void;
}

export function createRegistry<T extends { id: string }>(
  sort?: (a: T, b: T) => number,
): Registry<T> {
  const items = new Map<string, T>();
  const listeners = new Set<() => void>();
  let snapshot: T[] | null = null;

  const emit = () => {
    snapshot = null;
    for (const listener of listeners) listener();
  };

  const list = () => {
    if (!snapshot) {
      snapshot = [...items.values()];
      if (sort) snapshot.sort(sort);
    }
    return snapshot;
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    register(item) {
      items.set(item.id, item);
      emit();
      return () => {
        if (items.get(item.id) === item) {
          items.delete(item.id);
          emit();
        }
      };
    },
    unregister(id) {
      if (items.delete(id)) emit();
    },
    get(id) {
      return items.get(id);
    },
    list,
    subscribe,
    useList() {
      return useSyncExternalStore(subscribe, list, list);
    },
    reset() {
      items.clear();
      emit();
    },
  };
}
