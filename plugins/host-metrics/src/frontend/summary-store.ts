import { useCallback, useSyncExternalStore } from "react";
import type { ServerMetrics } from "../shared/metrics.js";
import type { HostMetricsApi } from "./host-metrics-api";

const REFRESH_MS = 30_000;

interface Entry {
  refs: number;
  viewerSessionId?: string;
  data: ServerMetrics | null;
  listeners: Set<() => void>;
}

/**
 * Latest metrics for hosts shown outside the tab (dashboard rows, homepage
 * widgets). Each watched host holds one viewer, so polling runs while
 * something shows it and stops with the last one.
 */
export function createMetricsSummaryStore(api: HostMetricsApi) {
  const entries = new Map<number, Entry>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const notify = (entry: Entry) => {
    for (const listener of entry.listeners) listener();
  };

  async function refresh(hostId: number): Promise<void> {
    const entry = entries.get(hostId);
    if (!entry) return;
    try {
      if (
        entry.viewerSessionId &&
        !(await api.heartbeat(entry.viewerSessionId))
      ) {
        entry.viewerSessionId = undefined;
      }
      if (!entry.viewerSessionId) {
        const registered = await api.registerViewer(hostId);
        if (registered.viewerSessionId) {
          entry.viewerSessionId = registered.viewerSessionId;
        }
      }
      entry.data = await api.getMetrics(hostId);
    } catch {
      // Keep the last value; the next tick tries again.
    }
    if (entries.get(hostId) === entry) notify(entry);
  }

  function tick() {
    if (typeof document !== "undefined" && document.hidden) return;
    for (const hostId of entries.keys()) void refresh(hostId);
  }

  function release(hostId: number, entry: Entry) {
    entries.delete(hostId);
    if (entry.viewerSessionId) {
      void api.unregisterViewer(hostId, entry.viewerSessionId).catch(() => {});
    }
    if (entries.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    watch(hostId: number, listener: () => void): () => void {
      let entry = entries.get(hostId);
      if (!entry) {
        entry = { refs: 0, data: null, listeners: new Set() };
        entries.set(hostId, entry);
        void refresh(hostId);
      }
      entry.refs++;
      entry.listeners.add(listener);
      if (!timer) timer = setInterval(tick, REFRESH_MS);
      const held = entry;
      return () => {
        held.listeners.delete(listener);
        held.refs--;
        if (held.refs <= 0) release(hostId, held);
      };
    },

    get(hostId: number): ServerMetrics | null {
      return entries.get(hostId)?.data ?? null;
    },

    dispose() {
      for (const [hostId, entry] of [...entries.entries()]) {
        release(hostId, entry);
      }
    },
  };
}

export type MetricsSummaryStore = ReturnType<typeof createMetricsSummaryStore>;

/** The host's latest sample, polled while the calling component is shown. */
export function useMetricsSummary(
  store: MetricsSummaryStore,
  hostId: number | null | undefined,
): ServerMetrics | null {
  // Stable per host, or every render would drop and re-add the viewer.
  const subscribe = useCallback(
    (onChange: () => void) =>
      hostId ? store.watch(hostId, onChange) : () => {},
    [store, hostId],
  );
  return useSyncExternalStore(
    subscribe,
    () => (hostId ? store.get(hostId) : null),
    () => null,
  );
}
