/* eslint-disable react-hooks/exhaustive-deps */
import React from "react";
import { Button } from "@/components/button.tsx";
import {
  getProxmoxStats,
  startProxmoxStatsPolling,
  stopProxmoxStatsPolling,
  sendProxmoxStatsHeartbeat,
  getSSHHosts,
} from "@/main-axios.ts";
import type { ProxmoxStatsSnapshot } from "@/types/proxmox";
import type { ProxmoxStatsConfig } from "@/types";
import { useTranslation } from "react-i18next";
import { SimpleLoader } from "@/lib/SimpleLoader.tsx";
import { RefreshCw, Server } from "lucide-react";
import { NodeSummaryStrip } from "./NodeSummaryStrip";
import { GuestTable } from "./GuestTable";
import { NodeNetworkCard } from "./cards/NodeNetworkCard";
import { StoragePoolsCard } from "./cards/StoragePoolsCard";
import { ClusterHealthCard } from "./cards/ClusterHealthCard";

const HISTORY_LEN = 30;
const DEFAULT_POLL_INTERVAL = 60;

interface HostConfig {
  id: number;
  name: string;
  ip: string;
  username: string;
  enableProxmoxStats?: boolean;
  proxmoxStatsConfig?: string | ProxmoxStatsConfig | null;
  authType?: string;
  port?: number;
  [key: string]: unknown;
}

interface ProxmoxStatsProps {
  hostConfig?: HostConfig;
  title?: string;
  isVisible?: boolean;
  isTopbarOpen?: boolean;
  embedded?: boolean;
}

interface ProxmoxStatsHistories {
  cpu: number[];
  memory: number[];
  disk: number[];
}

function parseProxmoxStatsConfig(
  raw?: string | ProxmoxStatsConfig | null,
): Required<Pick<ProxmoxStatsConfig, "pollInterval">> & ProxmoxStatsConfig {
  const defaults = { pollInterval: DEFAULT_POLL_INTERVAL, nodeName: null };
  if (!raw) return defaults;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function ProxmoxStatsTab({
  hostConfig,
  title,
  isVisible = true,
  isTopbarOpen = true,
  embedded = false,
}: ProxmoxStatsProps): React.ReactElement {
  const { t } = useTranslation();

  const [snapshot, setSnapshot] = React.useState<ProxmoxStatsSnapshot | null>(
    null,
  );
  const [histories, setHistories] = React.useState<ProxmoxStatsHistories>({
    cpu: [],
    memory: [],
    disk: [],
  });
  const [currentHostConfig, setCurrentHostConfig] = React.useState(hostConfig);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [isPageVisible, setIsPageVisible] = React.useState(!document.hidden);
  const [viewerSessionId, setViewerSessionId] = React.useState<string | null>(
    null,
  );
  const [hasConnectionError, setHasConnectionError] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const statsConfig = React.useMemo(
    () => parseProxmoxStatsConfig(currentHostConfig?.proxmoxStatsConfig),
    [currentHostConfig?.proxmoxStatsConfig],
  );

  React.useEffect(() => {
    const onVis = () => setIsPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const isActuallyVisible = isVisible && isPageVisible;

  React.useEffect(() => {
    if (!viewerSessionId || !isActuallyVisible) return;
    const interval = setInterval(() => {
      sendProxmoxStatsHeartbeat(viewerSessionId).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [viewerSessionId, isActuallyVisible]);

  React.useEffect(() => {
    if (hostConfig?.id !== currentHostConfig?.id) {
      setSnapshot(null);
      setHistories({ cpu: [], memory: [], disk: [] });
    }
    setCurrentHostConfig(hostConfig);
  }, [hostConfig?.id]);

  React.useEffect(() => {
    const fetchLatest = async () => {
      if (!hostConfig?.id) return;
      try {
        const hosts = await getSSHHosts();
        const updated = hosts.find((h) => h.id === hostConfig.id);
        if (updated) setCurrentHostConfig(updated as unknown as HostConfig);
      } catch {
        // keep previous config
      }
    };
    fetchLatest();
    const onChanged = () => fetchLatest();
    window.addEventListener("ssh-hosts:changed", onChanged);
    return () => window.removeEventListener("ssh-hosts:changed", onChanged);
  }, [hostConfig?.id]);

  const pushHistory = React.useCallback((data: ProxmoxStatsSnapshot) => {
    setHistories((prev) => {
      const add = (arr: number[], v: number | null | undefined) =>
        [...arr, v ?? 0].slice(-HISTORY_LEN);
      return {
        cpu: add(prev.cpu, data.node?.cpu?.percent),
        memory: add(prev.memory, data.node?.memory?.percent),
        disk: add(prev.disk, data.node?.disk?.percent),
      };
    });
  }, []);

  React.useEffect(() => {
    const enabled = currentHostConfig?.enableProxmoxStats === true;
    if (!enabled || !currentHostConfig?.id) return;

    let cancelled = false;
    let pollingId: number | undefined;
    if (isActuallyVisible && !snapshot) setIsLoading(true);
    else if (!isActuallyVisible) setIsLoading(false);

    const start = async () => {
      if (cancelled) return;
      const hadSnapshot = snapshot !== null;
      if (!hadSnapshot) setIsLoading(true);
      setHasConnectionError(false);
      setErrorMessage(null);

      try {
        const result = await startProxmoxStatsPolling(currentHostConfig.id);
        if (cancelled) return;
        if (result.viewerSessionId) setViewerSessionId(result.viewerSessionId);

        let retry = 0;
        let data: ProxmoxStatsSnapshot | null = null;
        const maxRetries = 30;
        while (retry < maxRetries && !cancelled) {
          try {
            data = await getProxmoxStats(currentHostConfig.id);
            if (data) break;
          } catch {
            // non-404 error - keep retrying
          }
          retry++;
          if (retry < maxRetries && !cancelled) {
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
        if (cancelled) return;

        if (data) {
          setSnapshot(data);
          if (!hadSnapshot) setIsLoading(false);
        } else {
          throw new Error(t("proxmoxStats.connectionFailed"));
        }

        const intervalMs =
          (statsConfig.pollInterval ?? DEFAULT_POLL_INTERVAL) * 1000;
        pollingId = window.setInterval(async () => {
          if (cancelled) return;
          try {
            const next = await getProxmoxStats(currentHostConfig.id);
            if (!cancelled && next) {
              setSnapshot(next);
              pushHistory(next);
            }
          } catch {
            /* keep prior */
          }
        }, intervalMs);
      } catch (error: unknown) {
        if (cancelled) return;
        setIsLoading(false);
        setHasConnectionError(true);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : t("proxmoxStats.connectionFailed"),
        );
      }
    };

    const stop = async () => {
      if (pollingId) {
        window.clearInterval(pollingId);
        pollingId = undefined;
      }
      if (currentHostConfig?.id) {
        await stopProxmoxStatsPolling(
          currentHostConfig.id,
          viewerSessionId || undefined,
        ).catch(() => {});
      }
    };

    const debounce = setTimeout(() => {
      if (isActuallyVisible) {
        if (!hasConnectionError) start();
      } else {
        stop();
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      if (pollingId) window.clearInterval(pollingId);
      if (currentHostConfig?.id) {
        stopProxmoxStatsPolling(currentHostConfig.id).catch(() => {});
      }
    };
  }, [
    currentHostConfig?.id,
    currentHostConfig?.enableProxmoxStats,
    isActuallyVisible,
    statsConfig.pollInterval,
    hasConnectionError,
  ]);

  const wrapperStyle: React.CSSProperties = embedded
    ? { opacity: isVisible ? 1 : 0, height: "100%", width: "100%" }
    : {
        opacity: isVisible ? 1 : 0,
        margin: isTopbarOpen ? "74px 17px 8px 8px" : "16px 17px 8px 8px",
        height: isTopbarOpen ? "calc(100vh - 82px)" : "calc(100vh - 24px)",
      };

  const handleRefresh = async () => {
    if (!currentHostConfig?.id) return;
    if (hasConnectionError) {
      setHasConnectionError(false);
      setErrorMessage(null);
      return;
    }
    try {
      setIsRefreshing(true);
      const data = await getProxmoxStats(currentHostConfig.id);
      if (data) {
        setSnapshot(data);
        pushHistory(data);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const notEnabled = currentHostConfig?.enableProxmoxStats !== true;
  const showContent =
    !notEnabled && !isLoading && snapshot && !hasConnectionError;

  return (
    <div
      style={wrapperStyle}
      className="relative flex flex-col overflow-hidden"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!isLoading && !hasConnectionError && !notEnabled && (
          <div className="mx-3 mt-3 flex shrink-0 items-center justify-between border border-border bg-card px-3 py-3">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center border border-border bg-muted">
                <Server className="size-5 text-accent-brand" />
              </div>
              <h1 className="text-lg font-bold md:text-2xl">{title}</h1>
            </div>
            <Button
              variant="outline"
              size="default"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="gap-2 font-semibold"
            >
              <RefreshCw
                className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              />
              {t("proxmoxStats.refresh")}
            </Button>
          </div>
        )}

        {notEnabled && (
          <div className="flex flex-1 items-center justify-center py-20">
            <div className="text-center opacity-40">
              <Server className="mx-auto mb-4 size-16" />
              <p className="text-xl font-bold uppercase tracking-widest">
                {t("proxmoxStats.noHostSelected")}
              </p>
            </div>
          </div>
        )}

        {hasConnectionError && !notEnabled && (
          <div className="flex flex-1 items-center justify-center py-20">
            <div className="text-center opacity-70">
              <Server className="mx-auto mb-4 size-16" />
              <p className="text-xl font-bold uppercase tracking-widest">
                {t("proxmoxStats.connectionFailed")}
              </p>
              {errorMessage && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {errorMessage}
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={handleRefresh}
              >
                <RefreshCw className="mr-2 size-3.5" />
                {t("proxmoxStats.refresh")}
              </Button>
            </div>
          </div>
        )}

        {showContent && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3 pt-3">
            <div className="shrink-0">
              <NodeSummaryStrip node={snapshot.node} histories={histories} />
            </div>

            <GuestTable guests={snapshot.guests.guests} />

            <div className="grid shrink-0 grid-cols-1 gap-3 pb-1 md:grid-cols-3">
              <NodeNetworkCard snapshot={snapshot} />
              <StoragePoolsCard snapshot={snapshot} />
              {snapshot.cluster.clustered && (
                <ClusterHealthCard snapshot={snapshot} />
              )}
            </div>
          </div>
        )}

        {!notEnabled && (
          <SimpleLoader
            visible={isLoading && !snapshot}
            message={t("proxmoxStats.connecting")}
          />
        )}
      </div>
    </div>
  );
}
