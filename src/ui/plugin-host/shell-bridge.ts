import { useSyncExternalStore } from "react";
import type { Host } from "@/types/ui-types";
import type { TabShellCallbacks } from "@/shell/tab-registry";

/**
 * The live shell, as plugins see it.
 *
 * AppShell owns tabs and hosts in React state. It publishes callbacks and
 * the host list here on every render, and plugin code (the app object, the
 * SDK hooks, registered host actions) calls through this module, so nothing
 * has to be threaded through props into a plugin.
 */
type Layout = { version: number; [key: string]: unknown };

export interface ShellLayoutProvider {
  getLayout: () => Layout | null;
  applyLayout: (
    layout: Layout,
    options?: { name?: string },
  ) => Promise<{ skipped: string[] }>;
}

let callbacks: TabShellCallbacks | null = null;
let layoutProvider: ShellLayoutProvider | null = null;
let hosts: Host[] = [];
let hostsLoaded = false;
let ready = false;

const hostListeners = new Set<() => void>();
const changeListeners = new Set<() => void>();
const readyListeners = new Set<() => void>();

export function setShellCallbacks(next: TabShellCallbacks | null): void {
  callbacks = next;
}

export function setShellLayoutProvider(next: ShellLayoutProvider | null): void {
  layoutProvider = next;
}

export function setShellHosts(next: Host[], loaded = true): void {
  if (next === hosts && loaded === hostsLoaded) return;
  hosts = next;
  hostsLoaded = loaded;
  hostSnapshot = { hosts, loaded: hostsLoaded };
  for (const listener of hostListeners) listener();
}

let hostSnapshot = { hosts, loaded: hostsLoaded };

export function useShellHosts(): { hosts: Host[]; loaded: boolean } {
  return useSyncExternalStore(
    (listener) => {
      hostListeners.add(listener);
      return () => hostListeners.delete(listener);
    },
    () => hostSnapshot,
    () => hostSnapshot,
  );
}

export function getShellHosts(): Host[] {
  return hosts;
}

export function notifyTabsChanged(): void {
  for (const listener of changeListeners) listener();
}

/** Called once the shell has restored its tabs. Late listeners fire at once. */
export function notifyShellReady(): void {
  if (ready) return;
  ready = true;
  for (const listener of readyListeners) listener();
}

function subscribe(set: Set<() => void>, listener: () => void): () => void {
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

const noop = () => {};

/** Forwards to the mounted shell; a no-op before it mounts or after logout. */
export const shell: TabShellCallbacks = {
  openTab: (...args) => callbacks?.openTab(...args),
  openSingletonTab: (...args) => callbacks?.openSingletonTab(...args),
  closeTab: (...args) => callbacks?.closeTab(...args),
  renameTab: (...args) => callbacks?.renameTab(...args),
  openRailView: (...args) => callbacks?.openRailView(...args),
  closeRailView: (...args) => callbacks?.closeRailView(...args),
  saveQuickConnect: (...args) =>
    callbacks?.saveQuickConnect?.(...args) ?? Promise.resolve(),
};

export const tabsApi = {
  openTab: shell.openTab,
  openSingletonTab: shell.openSingletonTab,
  closeTab: shell.closeTab,
  openRailView: shell.openRailView,
  getLayout: () => layoutProvider?.getLayout() ?? null,
  applyLayout: (layout: Layout, options?: { name?: string }) =>
    layoutProvider
      ? layoutProvider.applyLayout(layout, options)
      : Promise.resolve({ skipped: [] as string[] }),
  onChange: (listener: () => void) => subscribe(changeListeners, listener),
  onReady: (listener: () => void) => {
    if (ready) {
      listener();
      return noop;
    }
    return subscribe(readyListeners, listener);
  },
};

/** Test seam, and on logout. */
export function resetShellBridge(): void {
  callbacks = null;
  layoutProvider = null;
  ready = false;
  setShellHosts([], false);
}
