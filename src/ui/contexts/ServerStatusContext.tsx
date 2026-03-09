import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { getAllServerStatuses, getSSHHosts } from "@/ui/main-axios";
import { DEFAULT_STATS_CONFIG } from "@/types/stats-widgets";

type StatusValue = "online" | "offline" | "degraded";

interface ServerStatusEntry {
  status: StatusValue;
  lastChecked: string;
}

interface ServerStatusContextType {
  statuses: Map<number, ServerStatusEntry>;
  isLoading: boolean;
  refreshStatuses: () => Promise<void>;
  getStatus: (hostId: number) => StatusValue;
}

const ServerStatusContext = createContext<ServerStatusContextType | null>(null);

const POLL_INTERVAL = 30000;

export function ServerStatusProvider({
  children,
  isAuthenticated = false,
}: {
  children: React.ReactNode;
  isAuthenticated?: boolean;
}) {
  const [statuses, setStatuses] = useState<Map<number, ServerStatusEntry>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [enabledHostIds, setEnabledHostIds] = useState<Set<number>>(new Set());
  const mountedRef = useRef(true);
  const enabledHostIdsRef = useRef(enabledHostIds);

  useEffect(() => {
    enabledHostIdsRef.current = enabledHostIds;
  }, [enabledHostIds]);

  const fetchEnabledHosts = useCallback(async () => {
    if (!isAuthenticated) {
      return new Set<number>();
    }

    try {
      const hosts = await getSSHHosts();
      const enabled = new Set<number>();

      hosts.forEach((host) => {
        const statsConfig = (() => {
          try {
            return host.statsConfig
              ? JSON.parse(host.statsConfig)
              : DEFAULT_STATS_CONFIG;
          } catch {
            return DEFAULT_STATS_CONFIG;
          }
        })();

        if (statsConfig.statusCheckEnabled !== false) {
          enabled.add(host.id);
        }
      });

      setEnabledHostIds(enabled);
      return enabled;
    } catch (error) {
      return new Set<number>();
    }
  }, [isAuthenticated]);

  const refreshStatuses = useCallback(async () => {
    if (!mountedRef.current || !isAuthenticated) return;

    setIsLoading(true);
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

      setStatuses(newStatuses);
    } catch (error) {
      if (mountedRef.current) {
        setStatuses((prev) => {
          const updated = new Map(prev);
          enabledHostIdsRef.current.forEach((id) => {
            const existing = updated.get(id);
            updated.set(id, {
              status: "degraded",
              lastChecked: existing?.lastChecked || new Date().toISOString(),
            });
          });
          return updated;
        });
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [isAuthenticated]);

  const getStatus = useCallback(
    (hostId: number): StatusValue => {
      if (!enabledHostIds.has(hostId)) {
        return "offline";
      }
      return statuses.get(hostId)?.status || "degraded";
    },
    [statuses, enabledHostIds],
  );

  useEffect(() => {
    mountedRef.current = true;

    const init = async () => {
      await fetchEnabledHosts();
      await refreshStatuses();
    };

    init();

    const intervalId = setInterval(refreshStatuses, POLL_INTERVAL);

    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
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

  return (
    <ServerStatusContext.Provider
      value={{
        statuses,
        isLoading,
        refreshStatuses,
        getStatus,
      }}
    >
      {children}
    </ServerStatusContext.Provider>
  );
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

export function useHostStatus(
  hostId: number,
  statusCheckEnabled: boolean = true,
) {
  const { getStatus } = useServerStatus();

  if (!statusCheckEnabled) {
    return "offline" as StatusValue;
  }

  return getStatus(hostId);
}
