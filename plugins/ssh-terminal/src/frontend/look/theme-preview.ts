import { useSyncExternalStore } from "react";

/**
 * The terminal theme the host editor is previewing, so an open terminal for
 * that host can show it before the host is saved. Null when nothing is being
 * previewed.
 */
let preview: string | null = null;
const listeners = new Set<() => void>();

export function setThemePreview(theme: string | null): void {
  if (theme === preview) return;
  preview = theme;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useThemePreview(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => preview,
    () => preview,
  );
}
