import React from "react";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { Status, StatusIndicator } from "@/components/ui/shadcn-io/status";
import { Separator } from "@/components/ui/separator.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Tunnel } from "@/ui/Desktop/Apps/Tunnel/Tunnel.tsx";
import {
  getServerStatusById,
  getServerMetricsById,
  type ServerMetrics,
} from "@/ui/main-axios.ts";
import { useTabs } from "@/ui/Desktop/Navigation/Tabs/TabContext.tsx";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  type WidgetType,
  type StatsConfig,
  DEFAULT_STATS_CONFIG,
} from "@/types/stats-widgets";
import {
  CpuWidget,
  MemoryWidget,
  DiskWidget,
  NetworkWidget,
  UptimeWidget,
  ProcessesWidget,
  SystemWidget,
} from "./widgets";

interface HostConfig {
  id: number;
  name: string;
  ip: string;
  username: string;
  folder?: string;
  enableFileManager?: boolean;
  tunnelConnections?: unknown[];
  statsConfig?: string | StatsConfig;
  [key: string]: unknown;
}

interface TabData {
  id: number;
  type: string;
  title?: string;
  hostConfig?: HostConfig;
  [key: string]: unknown;
}

interface ServerProps {
  hostConfig?: HostConfig;
  title?: string;
  isVisible?: boolean;
  isTopbarOpen?: boolean;
  embedded?: boolean;
}

export function Server({
  hostConfig,
  title,
  isVisible = true,
  isTopbarOpen = true,
  embedded = false,
}: ServerProps): React.ReactElement {
  const { t } = useTranslation();
  const { state: sidebarState } = useSidebar();
  const { addTab, tabs } = useTabs() as {
    addTab: (tab: { type: string; [key: string]: unknown }) => number;
    tabs: TabData[];
  };
  const [serverStatus, setServerStatus] = React.useState<"online" | "offline">(
    "offline",
  );
  const [metrics, setMetrics] = React.useState<ServerMetrics | null>(null);
  const [metricsHistory, setMetricsHistory] = React.useState<ServerMetrics[]>(
    [],
  );
  const [currentHostConfig, setCurrentHostConfig] = React.useState(hostConfig);
  const [isLoadingMetrics, setIsLoadingMetrics] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [showStatsUI, setShowStatsUI] = React.useState(true);

  const enabledWidgets = React.useMemo((): WidgetType[] => {
    if (!currentHostConfig?.statsConfig) {
      return DEFAULT_STATS_CONFIG.enabledWidgets;
    }
    try {
      const parsed =
        typeof currentHostConfig.statsConfig === "string"
          ? JSON.parse(currentHostConfig.statsConfig)
          : currentHostConfig.statsConfig;
      return parsed?.enabledWidgets || DEFAULT_STATS_CONFIG.enabledWidgets;
    } catch (error) {
      console.error("Failed to parse statsConfig:", error);
      return DEFAULT_STATS_CONFIG.enabledWidgets;
    }
  }, [currentHostConfig?.statsConfig]);

  React.useEffect(() => {
    setCurrentHostConfig(hostConfig);
  }, [hostConfig]);

  const renderWidget = (widgetType: WidgetType) => {
    switch (widgetType) {
      case "cpu":
        return <CpuWidget metrics={metrics} metricsHistory={metricsHistory} />;

      case "memory":
        return (
          <MemoryWidget metrics={metrics} metricsHistory={metricsHistory} />
        );

      case "disk":
        return <DiskWidget metrics={metrics} metricsHistory={metricsHistory} />;

      case "network":
        return (
          <NetworkWidget metrics={metrics} metricsHistory={metricsHistory} />
        );

      case "uptime":
        return (
          <UptimeWidget metrics={metrics} metricsHistory={metricsHistory} />
        );

      case "processes":
        return (
          <ProcessesWidget metrics={metrics} metricsHistory={metricsHistory} />
        );

      case "system":
        return (
          <SystemWidget metrics={metrics} metricsHistory={metricsHistory} />
        );

      default:
        return null;
    }
  };

  React.useEffect(() => {
    const fetchLatestHostConfig = async () => {
      if (hostConfig?.id) {
        try {
          const { getSSHHosts } = await import("@/ui/main-axios.ts");
          const hosts = await getSSHHosts();
          const updatedHost = hosts.find((h) => h.id === hostConfig.id);
          if (updatedHost) {
            setCurrentHostConfig(updatedHost);
          }
        } catch {
          toast.error(t("serverStats.failedToFetchHostConfig"));
        }
      }
    };

    fetchLatestHostConfig();

    const handleHostsChanged = async () => {
      if (hostConfig?.id) {
        try {
          const { getSSHHosts } = await import("@/ui/main-axios.ts");
          const hosts = await getSSHHosts();
          const updatedHost = hosts.find((h) => h.id === hostConfig.id);
          if (updatedHost) {
            setCurrentHostConfig(updatedHost);
          }
        } catch {
          toast.error(t("serverStats.failedToFetchHostConfig"));
        }
      }
    };

    window.addEventListener("ssh-hosts:changed", handleHostsChanged);
    return () =>
      window.removeEventListener("ssh-hosts:changed", handleHostsChanged);
  }, [hostConfig?.id]);

  React.useEffect(() => {
    let cancelled = false;
    let intervalId: number | undefined;

    const fetchStatus = async () => {
      try {
        const res = await getServerStatusById(currentHostConfig?.id);
        if (!cancelled) {
          setServerStatus(res?.status === "online" ? "online" : "offline");
        }
      } catch (error: unknown) {
        if (!cancelled) {
          const err = error as {
            response?: { status?: number };
          };
          if (err?.response?.status === 503) {
            setServerStatus("offline");
          } else if (err?.response?.status === 504) {
            setServerStatus("offline");
          } else if (err?.response?.status === 404) {
            setServerStatus("offline");
          } else {
            setServerStatus("offline");
          }
          toast.error(t("serverStats.failedToFetchStatus"));
        }
      }
    };

    const fetchMetrics = async () => {
      if (!currentHostConfig?.id) return;
      try {
        setIsLoadingMetrics(true);
        const data = await getServerMetricsById(currentHostConfig.id);
        if (!cancelled) {
          setMetrics(data);
          setMetricsHistory((prev) => {
            const newHistory = [...prev, data];
            // Keep last 20 data points for chart
            return newHistory.slice(-20);
          });
          setShowStatsUI(true);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setMetrics(null);
          setShowStatsUI(false);
          const err = error as {
            code?: string;
            response?: { status?: number; data?: { error?: string } };
          };
          if (
            err?.code === "TOTP_REQUIRED" ||
            (err?.response?.status === 403 &&
              err?.response?.data?.error === "TOTP_REQUIRED")
          ) {
            toast.error(t("serverStats.totpUnavailable"));
          } else {
            toast.error(t("serverStats.failedToFetchMetrics"));
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMetrics(false);
        }
      }
    };

    if (currentHostConfig?.id && isVisible) {
      fetchStatus();
      fetchMetrics();
      intervalId = window.setInterval(() => {
        fetchStatus();
        fetchMetrics();
      }, 30000);
    }

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [currentHostConfig?.id, isVisible]);

  const topMarginPx = isTopbarOpen ? 74 : 16;
  const leftMarginPx = sidebarState === "collapsed" ? 16 : 8;
  const bottomMarginPx = 8;

  const isFileManagerAlreadyOpen = React.useMemo(() => {
    if (!currentHostConfig) return false;
    return tabs.some(
      (tab: TabData) =>
        tab.type === "file_manager" &&
        tab.hostConfig?.id === currentHostConfig.id,
    );
  }, [tabs, currentHostConfig]);

  const wrapperStyle: React.CSSProperties = embedded
    ? { opacity: isVisible ? 1 : 0, height: "100%", width: "100%" }
    : {
        opacity: isVisible ? 1 : 0,
        marginLeft: leftMarginPx,
        marginRight: 17,
        marginTop: topMarginPx,
        marginBottom: bottomMarginPx,
        height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
      };

  const containerClass = embedded
    ? "h-full w-full text-white overflow-hidden bg-transparent"
    : "bg-dark-bg text-white rounded-lg border-2 border-dark-border overflow-hidden";

  return (
    <div style={wrapperStyle} className={containerClass}>
      <div className="h-full w-full flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 pt-3 pb-3 gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <div className="min-w-0">
              <h1 className="font-bold text-lg truncate">
                {currentHostConfig?.folder} / {title}
              </h1>
            </div>
            <Status
              status={serverStatus}
              className="!bg-transparent !p-0.75 flex-shrink-0"
            >
              <StatusIndicator />
            </Status>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              disabled={isRefreshing}
              className="font-semibold"
              onClick={async () => {
                if (currentHostConfig?.id) {
                  try {
                    setIsRefreshing(true);
                    const res = await getServerStatusById(currentHostConfig.id);
                    setServerStatus(
                      res?.status === "online" ? "online" : "offline",
                    );
                    const data = await getServerMetricsById(
                      currentHostConfig.id,
                    );
                    setMetrics(data);
                    setShowStatsUI(true);
                  } catch (error: unknown) {
                    const err = error as {
                      code?: string;
                      status?: number;
                      response?: { status?: number; data?: { error?: string } };
                    };
                    if (
                      err?.code === "TOTP_REQUIRED" ||
                      (err?.response?.status === 403 &&
                        err?.response?.data?.error === "TOTP_REQUIRED")
                    ) {
                      toast.error(t("serverStats.totpUnavailable"));
                      setMetrics(null);
                      setShowStatsUI(false);
                    } else if (
                      err?.response?.status === 503 ||
                      err?.status === 503
                    ) {
                      setServerStatus("offline");
                      setMetrics(null);
                      setShowStatsUI(false);
                    } else if (
                      err?.response?.status === 504 ||
                      err?.status === 504
                    ) {
                      setServerStatus("offline");
                      setMetrics(null);
                      setShowStatsUI(false);
                    } else if (
                      err?.response?.status === 404 ||
                      err?.status === 404
                    ) {
                      setServerStatus("offline");
                      setMetrics(null);
                      setShowStatsUI(false);
                    } else {
                      setServerStatus("offline");
                      setMetrics(null);
                      setShowStatsUI(false);
                    }
                  } finally {
                    setIsRefreshing(false);
                  }
                }
              }}
              title={t("serverStats.refreshStatusAndMetrics")}
            >
              {isRefreshing ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin"></div>
                  {t("serverStats.refreshing")}
                </div>
              ) : (
                t("serverStats.refreshStatus")
              )}
            </Button>
            {currentHostConfig?.enableFileManager && (
              <Button
                variant="outline"
                className="font-semibold"
                disabled={isFileManagerAlreadyOpen}
                title={
                  isFileManagerAlreadyOpen
                    ? t("serverStats.fileManagerAlreadyOpen")
                    : t("serverStats.openFileManager")
                }
                onClick={() => {
                  if (!currentHostConfig || isFileManagerAlreadyOpen) return;
                  const titleBase =
                    currentHostConfig?.name &&
                    currentHostConfig.name.trim() !== ""
                      ? currentHostConfig.name.trim()
                      : `${currentHostConfig.username}@${currentHostConfig.ip}`;
                  addTab({
                    type: "file_manager",
                    title: titleBase,
                    hostConfig: currentHostConfig,
                  });
                }}
              >
                {t("nav.fileManager")}
              </Button>
            )}
          </div>
        </div>
        <Separator className="p-0.25 w-full" />

        <div className="flex-1 overflow-y-auto min-h-0">
          {showStatsUI && (
            <div className="rounded-lg border-2 border-dark-border m-3 bg-dark-bg-darker p-4 max-h-[50vh] overflow-y-auto">
              {isLoadingMetrics && !metrics ? (
                <div className="flex items-center justify-center py-8">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-gray-300">
                      {t("serverStats.loadingMetrics")}
                    </span>
                  </div>
                </div>
              ) : !metrics && serverStatus === "offline" ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-500/20 flex items-center justify-center">
                      <div className="w-6 h-6 border-2 border-red-400 rounded-full"></div>
                    </div>
                    <p className="text-gray-300 mb-1">
                      {t("serverStats.serverOffline")}
                    </p>
                    <p className="text-sm text-gray-500">
                      {t("serverStats.cannotFetchMetrics")}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {enabledWidgets.map((widgetType) => (
                    <div key={widgetType} className="h-[280px]">
                      {renderWidget(widgetType)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {currentHostConfig?.tunnelConnections &&
            currentHostConfig.tunnelConnections.length > 0 && (
              <div className="rounded-lg border-2 border-dark-border m-3 bg-dark-bg-darker h-[360px] overflow-hidden flex flex-col min-h-0">
                <Tunnel
                  filterHostKey={
                    currentHostConfig?.name &&
                    currentHostConfig.name.trim() !== ""
                      ? currentHostConfig.name
                      : `${currentHostConfig?.username}@${currentHostConfig?.ip}`
                  }
                />
              </div>
            )}
        </div>

        <p className="px-4 pt-2 pb-2 text-sm text-gray-500">
          {t("serverStats.feedbackMessage")}{" "}
          <a
            href="https://github.com/Termix-SSH/Termix/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            GitHub
          </a>
          !
        </p>
      </div>
    </div>
  );
}
