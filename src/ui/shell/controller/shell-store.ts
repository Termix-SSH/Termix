import { useSyncExternalStore } from "react";
import type { ShellController } from "./types";

/**
 * The last rendered shell, for code that renders outside the shell's React
 * tree (a plugin component in an overlay, the plugin bridge). Inside the
 * shell, the context in ShellControllerProvider is the same value without the
 * one render of lag.
 */
let current: ShellController | null = null;
const listeners = new Set<() => void>();

export function publishShellController(next: ShellController | null): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function getShellController(): ShellController | null {
  return current;
}

export function useShellSnapshot(): ShellController | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current,
  );
}
