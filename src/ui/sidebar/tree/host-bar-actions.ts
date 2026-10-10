import { useSyncExternalStore } from "react";

/**
 * Which host actions the user put in or took out of the row's connect bar.
 * The hosts panel owns the preference and mirrors it here, so every row can
 * read it without its own fetch.
 */
let current: Record<string, boolean> = {};
const listeners = new Set<() => void>();

export function setBarActions(next: Record<string, boolean>): void {
  const same =
    Object.keys(next).length === Object.keys(current).length &&
    Object.entries(next).every(([id, value]) => current[id] === value);
  if (same) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBarActions(): Record<string, boolean> {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}

/** Whether an action shows in the bar: the user's choice, else its own. */
export function showsInBar(
  barActions: Record<string, boolean>,
  action: { id: string; tray?: boolean },
): boolean {
  return barActions[action.id] ?? action.tray !== false;
}
