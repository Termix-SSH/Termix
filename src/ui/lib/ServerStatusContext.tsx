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
import { getAllServerStatuses, getSSHHosts } from "@/main-axios";
import { DEFAULT_STATS_CONFIG } from "@/types/stats-widgets";
import {
  ServerStatusStore,
  type ServerStatusEntry,
  type StatusValue,
} from "./server-status-store";

interface ServerStatusContextType {
  statuses: Map<number, ServerStatusEntry>;
  isLoading: boolean;
  initialLoadComplete: boolean;
  refreshStatuses: () => Promise<void>;
  getStatus: (hostId: number) => StatusValue;
}

/** Stable for the provider lifetime — fine-grained hooks only need this. */
const StatusStoreContext = createContext<ServerStatusStore | null>(null);
const ServerStatusContext = createContext<ServerStatusContextType | null>(null);

const POLL_INTERVAL = 30000;

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

  useEffect(() => {
    return store.subscribeAll(() => {
      setVersion((v) => v + 1);
    });
  }, [store]);

  useEffect(() => {
    return store.subscribeMeta(() => {
      setVersion((v) => v + 1);
    });
  }, [store]);

  const fetchEnabledHosts = useCallback(async () => {
    if (!isAuthenticated) {
      store.setEnabledHostIds(new Set());
      return new Set<number>();
    }

    try {
      const hosts = await getSSHHosts({ includeStatus: false });
      const enabled = new Set<number>();

      hosts.forEach((host) => {
        const statsConfig = (() => {
          try {
            if (!host.statsConfig) return DEFAULT_STATS_CONFIG;
            if (typeof host.statsConfig === "string") {
              return JSON.parse(host.statsConfig);
            }
            return host.statsConfig;
          } catch {
            return DEFAULT_STATS_CONFIG;
          }
        })();

        if (statsConfig.statusCheckEnabled !== false) {
          enabled.add(host.id);
        }
      });

      store.setEnabledHostIds(enabled);
      return enabled;
    } catch {
      return store.getEnabledHostIds();
    }
  }, [isAuthenticated, store]);

  const refreshStatuses = useCallback(async () => {
    if (!mountedRef.current || !isAuthenticated) return;
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return;
    }

    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const showLoading = !store.getInitialLoadComplete();
    if (showLoading) store.setLoading(true);

    const run = (async () => {
      try {
        const data = await getAllServerStatuses();
        if (!mountedRef.current) return;

        const newStatuses = new Map<number, ServerStatusEntry>();
        const now = new Date().toISOString();

        if (data && typeof data === "object") {
          Object.entries(data).forEach(([idStr, statusData]) => {
            const id = parseInt(idStr, 10);
            if (!isNaN(id)) {
              const status =
                statusData?.status === "online" ? "online" : "offline";
              newStatuses.set(id, {
                status,
                lastChecked: statusData?.lastChecked || now,
              });
            }
          });
        }

        store.applyStatuses(newStatuses);
      } catch {
        if (mountedRef.current) {
          store.markDegraded(store.getEnabledHostIds());
        }
      } finally {
        if (mountedRef.current) {
          if (showLoading) store.setLoading(false);
          store.setInitialLoadComplete(true);
        }
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

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        void refreshStatuses();
      }, POLL_INTERVAL);
    };

    const stopPolling = () => {
      if (intervalId === null) return;
      clearInterval(intervalId);
      intervalId = null;
    };

    const init = async () => {
      await fetchEnabledHosts();
      await refreshStatuses();
      if (
        mountedRef.current &&
        (typeof document === "undefined" ||
          document.visibilityState !== "hidden")
      ) {
        startPolling();
      }
    };

    void init();

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stopPolling();
        return;
      }
      void refreshStatuses();
      startPolling();
    };

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mountedRef.current = false;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchEnabledHosts, refreshStatuses]);

  useEffect(() => {
    const handleHostsChanged = async () => {
      await fetchEnabledHosts();
      await refreshStatuses();
    };

    window.addEventListener("ssh-hosts:changed", handleHostsChanged);
    window.addEventListener("hosts:refresh", handleHostsChanged);

    return () => {
      window.removeEventListener("ssh-hosts:changed", handleHostsChanged);
      window.removeEventListener("hosts:refresh", handleHostsChanged);
    };
  }, [fetchEnabledHosts, refreshStatuses]);

  const contextValue = useMemo(
    () => ({
      statuses: store.getStatuses(),
      isLoading: store.getIsLoading(),
      initialLoadComplete: store.getInitialLoadComplete(),
      refreshStatuses,
      getStatus,
    }),
    // version refreshes statuses/isLoading/initialLoadComplete snapshots
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
    throw new Error(
      "Server status store hooks require ServerStatusProvider",
    );
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
 * status value changes (or its enabled flag flips). Does not re-render when
 * other hosts update.
 */
export function useHostStatus(
  hostId: number,
  statusCheckEnabled: boolean = true,
): StatusValue | null {
  const store = useStatusStore();

  const status = useSyncExternalStore(
    (onChange) => store.subscribeHost(hostId, onChange),
    () => store.getHostSnapshot(hostId),
    () => store.getHostSnapshot(hostId),
  );

  if (!statusCheckEnabled) {
    return null;
  }
  return status;
}

/** Meta flags without depending on the full status map. */
export function useServerStatusMeta(): {
  initialLoadComplete: boolean;
  isLoading: boolean;
} {
  const store = useStatusStore();

  useSyncExternalStore(
    (onChange) => store.subscribeMeta(onChange),
    () => store.getMetaSnapshot(),
    () => store.getMetaSnapshot(),
  );

  return {
    initialLoadComplete: store.getInitialLoadComplete(),
    isLoading: store.getIsLoading(),
  };
}
