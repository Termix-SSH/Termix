/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useSyncExternalStore,
  useState,
} from "react";
import { getAllServerStatuses } from "@/main-axios";
import { invalidateServerStatusCache } from "./hosts-request-cache";
import {
  ServerStatusStore,
  type ServerStatusEntry,
  type StatusValue,
} from "./server-status-store";
import { runAdaptivePolling } from "./adaptive-polling";

interface ServerStatusContextType {
  statuses: Map<number, ServerStatusEntry>;
  initialLoadComplete: boolean;
  refreshStatuses: () => Promise<void>;
  /** "unknown" until the host has been checked. */
  getStatus: (hostId: number) => StatusValue;
}

/** Stable for the provider lifetime. Fine-grained hooks only need this. */
const StatusStoreContext = createContext<ServerStatusStore | null>(null);
const ServerStatusContext = createContext<ServerStatusContextType | null>(null);

/** The mounted provider's store, for code outside React (plugin host lists). */
let activeStore: ServerStatusStore | null = null;

/** A host's live status outside React. "unknown" with no provider mounted. */
export function getLiveHostStatus(hostId: number): StatusValue {
  return activeStore?.getStatus(hostId) ?? "unknown";
}

/** The backend keeps statuses in memory, so reading them often is cheap. */
const POLL_INTERVAL = 15_000;

export function ServerStatusProvider({
  children,
  isAuthenticated = false,
}: {
  children: React.ReactNode;
  isAuthenticated?: boolean;
}) {
  const storeRef = useRef<ServerStatusStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new ServerStatusStore();
  }
  const store = storeRef.current;

  // Bumps only full-context consumers (dashboard, folder counts, etc.).
  const [version, setVersion] = useState(0);
  const mountedRef = useRef(true);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => store.subscribeAll(() => setVersion((v) => v + 1)), [store]);

  useEffect(() => {
    activeStore = store;
    return () => {
      if (activeStore === store) activeStore = null;
    };
  }, [store]);

  const refreshStatuses = useCallback(async () => {
    if (!mountedRef.current || !isAuthenticated) return;
    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    const run = (async () => {
      try {
        const data = await getAllServerStatuses();
        if (!mountedRef.current || !data || typeof data !== "object") return;
        const next = new Map<number, ServerStatusEntry>();
        const now = new Date().toISOString();
        for (const [idStr, entry] of Object.entries(data)) {
          const id = parseInt(idStr, 10);
          if (isNaN(id)) continue;
          next.set(id, {
            status: entry?.status === "online" ? "online" : "offline",
            lastChecked: entry?.lastChecked || now,
          });
        }
        store.applyStatuses(next);
      } catch {
        // Keep the last known statuses rather than flipping every host.
      } finally {
        if (mountedRef.current) store.setInitialLoadComplete(true);
      }
    })();

    refreshInFlightRef.current = run.finally(() => {
      refreshInFlightRef.current = null;
    });
    return refreshInFlightRef.current;
  }, [isAuthenticated, store]);

  const getStatus = useCallback(
    (hostId: number): StatusValue => store.getStatus(hostId),
    [store],
  );

  useEffect(() => {
    mountedRef.current = true;
    if (!isAuthenticated) {
      store.clear();
      return () => {
        mountedRef.current = false;
      };
    }

    const stopPolling = runAdaptivePolling(refreshStatuses, {
      minIntervalMs: POLL_INTERVAL,
      maxIntervalMs: POLL_INTERVAL,
    });
    const onFocus = () => void refreshStatuses();
    window.addEventListener("focus", onFocus);

    return () => {
      mountedRef.current = false;
      stopPolling();
      window.removeEventListener("focus", onFocus);
    };
  }, [isAuthenticated, refreshStatuses, store]);

  useEffect(() => {
    const handleHostsChanged = () => {
      invalidateServerStatusCache();
      void refreshStatuses();
    };

    window.addEventListener("ssh-hosts:changed", handleHostsChanged);
    window.addEventListener("hosts:refresh", handleHostsChanged);

    return () => {
      window.removeEventListener("ssh-hosts:changed", handleHostsChanged);
      window.removeEventListener("hosts:refresh", handleHostsChanged);
    };
  }, [refreshStatuses]);

  const contextValue = useMemo(
    () => ({
      statuses: store.getStatuses(),
      initialLoadComplete: store.getInitialLoadComplete(),
      refreshStatuses,
      getStatus,
    }),
    // version refreshes the statuses/initialLoadComplete snapshots
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, refreshStatuses, getStatus],
  );

  return (
    <StatusStoreContext.Provider value={store}>
      <ServerStatusContext.Provider value={contextValue}>
        {children}
      </ServerStatusContext.Provider>
    </StatusStoreContext.Provider>
  );
}

function useStatusStore(): ServerStatusStore {
  const store = useContext(StatusStoreContext);
  if (!store) {
    throw new Error("Server status store hooks require ServerStatusProvider");
  }
  return store;
}

export function useServerStatus() {
  const context = useContext(ServerStatusContext);
  if (!context) {
    throw new Error(
      "useServerStatus must be used within a ServerStatusProvider",
    );
  }
  return context;
}

/**
 * Subscribe to a single host's status. Only re-renders when that host's
 * status changes. Null when status checks are off for the host.
 */
export function useHostStatus(
  hostId: number,
  statusCheckEnabled: boolean = true,
): StatusValue | null {
  const store = useStatusStore();
  const status = useSyncExternalStore(
    (onChange) => store.subscribeHost(hostId, onChange),
    () => store.getStatus(hostId),
    () => store.getStatus(hostId),
  );
  return statusCheckEnabled ? status : null;
}

/** Meta flags without depending on the full status map. */
export function useServerStatusMeta(): { initialLoadComplete: boolean } {
  const store = useStatusStore();
  useSyncExternalStore(
    (onChange) => store.subscribeMeta(onChange),
    () => store.getMetaSnapshot(),
    () => store.getMetaSnapshot(),
  );
  return { initialLoadComplete: store.getInitialLoadComplete() };
}

const noStatus = (): StatusValue => "unknown";

/**
 * One host's status for plugin views, which can render outside the app shell
 * (a standalone window). Null there, and while the host has not been checked.
 */
export function useOptionalHostStatusEntry(
  hostId: number | undefined,
): { status: "online" | "offline" } | null {
  const store = useContext(StatusStoreContext);
  const status = useSyncExternalStore(
    (onChange) =>
      store && hostId !== undefined
        ? store.subscribeHost(hostId, onChange)
        : () => {},
    () => (store && hostId !== undefined ? store.getStatus(hostId) : "unknown"),
    noStatus,
  );
  return status === "unknown" ? null : { status };
}
