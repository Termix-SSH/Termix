import { useSyncExternalStore, type Ref, type RefObject } from "react";

/**
 * Lets the tab bar know when a tab's surface handle attaches. A ref filling
 * in renders nothing on its own, so a tab button whose `when` reads the
 * handle (like Share) would wait for some unrelated render to show up.
 */
let version = 0;
const listeners = new Set<() => void>();
const callbacks = new WeakMap<RefObject<unknown>, (value: unknown) => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A callback ref that fills `ref` and tells the tab bar. The same function
 * comes back for the same ref, so React never detaches and reattaches it.
 */
export function trackTabHandle(
  ref: RefObject<unknown> | undefined,
): Ref<unknown> | undefined {
  if (!ref) return undefined;
  let callback = callbacks.get(ref);
  if (!callback) {
    callback = (value: unknown) => {
      if (ref.current === value) return;
      (ref as { current: unknown }).current = value;
      version += 1;
      for (const listener of listeners) listener();
    };
    callbacks.set(ref, callback);
  }
  return callback;
}

/** Changes whenever any tab's handle attaches or goes away. */
export function useTabHandlesVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
}
