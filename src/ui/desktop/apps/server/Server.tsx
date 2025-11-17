import React from "react";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { Status, StatusIndicator } from "@/components/ui/shadcn-io/status";
import { Separator } from "@/components/ui/separator.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Tunnel } from "@/ui/desktop/apps/tunnel/Tunnel.tsx";
import {
  getServerStatusById,
  getServerMetricsById,
  executeSnippet,
  type ServerMetrics,
} from "@/ui/main-axios.ts";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
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
  LoginStatsWidget,
} from "./widgets";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";

interface QuickAction {
  name: string;
  snippetId: number;
}

interface HostConfig {
  id: number;
  name: string;
  ip: string;
  username: string;
  folder?: string;
  enableFileManager?: boolean;
  tunnelConnections?: unknown[];
  quickActions?: QuickAction[];
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
  const [executingActions, setExecutingActions] = React.useState<Set<number>>(
    new Set(),
  );

  const statsConfig = React.useMemo((): StatsConfig => {
    if (!currentHostConfig?.statsConfig) {
      return DEFAULT_STATS_CONFIG;
    }
    try {
      const parsed =
        typeof currentHostConfig.statsConfig === "string"
          ? JSON.parse(currentHostConfig.statsConfig)
          : currentHostConfig.statsConfig;
      return { ...DEFAULT_STATS_CONFIG, ...parsed };
    } catch (error) {
      console.error("Failed to parse statsConfig:", error);
      return DEFAULT_STATS_CONFIG;
    }
  }, [currentHostConfig?.statsConfig]);

  const enabledWidgets = statsConfig.enabledWidgets;
  const statusCheckEnabled = statsConfig.statusCheckEnabled !== false;
  const metricsEnabled = statsConfig.metricsEnabled !== false;

  React.useEffect(() => {
    if (hostConfig?.id !== currentHostConfig?.id) {
      setServerStatus("offline");
      setMetrics(null);
      setMetricsHistory([]);
      setShowStatsUI(true);
    }
    setCurrentHostConfig(hostConfig);
  }, [hostConfig?.id]);

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

      case "login_stats":
        return (
          <LoginStatsWidget metrics={metrics} metricsHistory={metricsHistory} />
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
    if (!statusCheckEnabled || !currentHostConfig?.id || !isVisible) {
      setServerStatus("offline");
      return;
    }

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
        }
      }
    };

    fetchStatus();
    intervalId = window.setInterval(fetchStatus, 10000);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [currentHostConfig?.id, isVisible, statusCheckEnabled]);

  React.useEffect(() => {
    if (!metricsEnabled || !currentHostConfig?.id || !isVisible) {
      setShowStatsUI(false);
      return;
    }

    let cancelled = false;
    let intervalId: number | undefined;

    const fetchMetrics = async () => {
      if (!currentHostConfig?.id) return;
      try {
        setIsLoadingMetrics(true);
        const data = await getServerMetricsById(currentHostConfig.id);
        if (!cancelled) {
          setMetrics(data);
          setMetricsHistory((prev) => {
            const newHistory = [...prev, data];
            return newHistory.slice(-20);
          });
          setShowStatsUI(true);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          const err = error as {
            code?: string;
            response?: { status?: number; data?: { error?: string } };
          };
          if (err?.response?.status === 404) {
            setMetrics(null);
            setShowStatsUI(false);
          } else if (
            err?.code === "TOTP_REQUIRED" ||
            (err?.response?.status === 403 &&
              err?.response?.data?.error === "TOTP_REQUIRED")
          ) {
            setMetrics(null);
            setShowStatsUI(false);
            toast.error(t("serverStats.totpUnavailable"));
          } else {
            setMetrics(null);
            setShowStatsUI(false);
            toast.error(t("serverStats.failedToFetchMetrics"));
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoadingMetrics(false);
        }
      }
    };

    fetchMetrics();
    intervalId = window.setInterval(fetchMetrics, 10000);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [currentHostConfig?.id, isVisible, metricsEnabled]);

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
            {statusCheckEnabled && (
              <Status
                status={serverStatus}
                className="!bg-transparent !p-0.75 flex-shrink-0"
              >
                <StatusIndicator />
              </Status>
            )}
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
          {(metricsEnabled && showStatsUI) ||
          (currentHostConfig?.quickActions &&
            currentHostConfig.quickActions.length > 0) ? (
            <div className="rounded-lg border-2 border-dark-border m-3 bg-dark-bg-darker p-4 overflow-y-auto relative flex-1 flex flex-col">
              {currentHostConfig?.quickActions &&
                currentHostConfig.quickActions.length > 0 && (
                  <div className={metricsEnabled && showStatsUI ? "mb-4" : ""}>
                    <h3 className="text-sm font-semibold text-gray-400 mb-2">
                      {t("serverStats.quickActions")}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {currentHostConfig.quickActions.map((action, index) => {
                        const isExecuting = executingActions.has(
                          action.snippetId,
                        );
                        return (
                          <Button
                            key={index}
                            variant="outline"
                            size="sm"
                            className="font-semibold"
                            disabled={isExecuting}
                            onClick={async () => {
                              if (!currentHostConfig) return;

                              setExecutingActions((prev) =>
                                new Set(prev).add(action.snippetId),
                              );
                              toast.loading(
                                t("serverStats.executingQuickAction", {
                                  name: action.name,
                                }),
                                { id: `quick-action-${action.snippetId}` },
                              );

                              try {
                                const result = await executeSnippet(
                                  action.snippetId,
                                  currentHostConfig.id,
                                );

                                if (result.success) {
                                  toast.success(
                                    t("serverStats.quickActionSuccess", {
                                      name: action.name,
                                    }),
                                    {
                                      id: `quick-action-${action.snippetId}`,
                                      description: result.output
                                        ? result.output.substring(0, 200)
                                        : undefined,
                                      duration: 5000,
                                    },
                                  );
                                } else {
                                  toast.error(
                                    t("serverStats.quickActionFailed", {
                                      name: action.name,
                                    }),
                                    {
                                      id: `quick-action-${action.snippetId}`,
                                      description:
                                        result.error ||
                                        result.output ||
                                        undefined,
                                      duration: 5000,
                                    },
                                  );
                                }
                              } catch (error: any) {
                                toast.error(
                                  t("serverStats.quickActionError", {
                                    name: action.name,
                                  }),
                                  {
                                    id: `quick-action-${action.snippetId}`,
                                    description:
                                      error?.message || "Unknown error",
                                    duration: 5000,
                                  },
                                );
                              } finally {
                                setExecutingActions((prev) => {
                                  const next = new Set(prev);
                                  next.delete(action.snippetId);
                                  return next;
                                });
                              }
                            }}
                            title={t("serverStats.executeQuickAction", {
                              name: action.name,
                            })}
                          >
                            {isExecuting ? (
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin"></div>
                                {action.name}
                              </div>
                            ) : (
                              action.name
                            )}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}
              {metricsEnabled &&
                showStatsUI &&
                (!metrics && serverStatus === "offline" ? (
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
                ))}

              {metricsEnabled && showStatsUI && (
                <SimpleLoader
                  visible={isLoadingMetrics && !metrics}
                  message={t("serverStats.loadingMetrics")}
                />
              )}
            </div>
          ) : null}

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
      </div>
    </div>
  );
}
