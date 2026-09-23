import { useSyncExternalStore } from "react";
import type { PluginSummary } from "@/api/plugins-api";

/**
 * What the browser knows about each plugin: the server's summary plus how
 * far its frontend got.
 *
 * `frontend` is separate from the server state on purpose. A plugin can be
 * enabled and healthy on the server while its bundle failed to import, and
 * the shell has to show that as failed rather than as missing.
 */
export type FrontendState =
  "none" | "loading" | "active" | "failed" | "blocked" | "inactive";

export interface PluginRecord {
  summary: PluginSummary;
  frontend: FrontendState;
  error?: string;
}

interface StoreState {
  /** False until the first GET /plugins answers. */
  loaded: boolean;
  /**
   * True once every enabled frontend has been tried at least once. The shell
   * restores saved tabs only after this, so plugin tabs come back as
   * themselves rather than as placeholders.
   */
  settled: boolean;
  records: ReadonlyMap<string, PluginRecord>;
}

let state: StoreState = { loaded: false, settled: false, records: new Map() };
const listeners = new Set<() => void>();

function commit(next: StoreState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribePluginStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPluginStoreState(): StoreState {
  return state;
}

export function usePluginStore(): StoreState {
  return useSyncExternalStore(
    subscribePluginStore,
    getPluginStoreState,
    getPluginStoreState,
  );
}

/** Replaces the summaries, keeping each plugin's frontend state. */
export function setPluginSummaries(summaries: PluginSummary[]): void {
  const records = new Map<string, PluginRecord>();
  for (const summary of summaries) {
    const previous = state.records.get(summary.id);
    records.set(summary.id, {
      summary,
      frontend: previous?.frontend ?? "none",
      error: previous?.error,
    });
  }
  commit({ ...state, loaded: true, records });
}

export function markPluginsSettled(): void {
  if (!state.settled) commit({ ...state, settled: true });
}

export function setFrontendState(
  pluginId: string,
  frontend: FrontendState,
  error?: string,
): void {
  const record = state.records.get(pluginId);
  if (!record) return;
  if (record.frontend === frontend && record.error === error) return;
  const records = new Map(state.records);
  records.set(pluginId, { ...record, frontend, error });
  commit({ ...state, records });
}

export function getPluginRecord(pluginId: string): PluginRecord | undefined {
  return state.records.get(pluginId);
}

/** Resolves once plugins have settled; at once if they already have. */
export function settledPromise(): Promise<void> {
  if (state.settled) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = subscribePluginStore(() => {
      if (!state.settled) return;
      unsubscribe();
      resolve();
    });
  });
}

/** Plugin ids known to the server, used to resolve permission namespaces. */
export function knownPluginIds(): string[] {
  return [...state.records.keys()];
}

/** Test seam. */
export function resetPluginStore(): void {
  commit({ loaded: false, settled: false, records: new Map() });
}
