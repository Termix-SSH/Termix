import React from "react";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { Status, StatusIndicator } from "@/components/ui/shadcn-io/status";
import { Separator } from "@/components/ui/separator.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  getServerStatusById,
  getServerMetricsById,
  startMetricsPolling,
  stopMetricsPolling,
  submitMetricsTOTP,
  executeSnippet,
  type ServerMetrics,
} from "@/ui/main-axios.ts";
import { TOTPDialog } from "@/ui/desktop/navigation/TOTPDialog.tsx";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  type WidgetType,
  type StatsConfig,
  DEFAULT_STATS_CONFIG,
} from "@/types/stats-widgets.ts";
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

export function ServerStats({
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
  const [totpRequired, setTotpRequired] = React.useState(false);
  const [totpSessionId, setTotpSessionId] = React.useState<string | null>(null);
  const [totpPrompt, setTotpPrompt] = React.useState<string>("");
  const [isPageVisible, setIsPageVisible] = React.useState(!document.hidden);

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
    const handleVisibilityChange = () => {
      setIsPageVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const isActuallyVisible = isVisible && isPageVisible;

  React.useEffect(() => {
    if (hostConfig?.id !== currentHostConfig?.id) {
      setServerStatus("offline");
      setMetrics(null);
      setMetricsHistory([]);
      setShowStatsUI(true);
    }
    setCurrentHostConfig(hostConfig);
  }, [hostConfig?.id]);

  const handleTOTPSubmit = async (totpCode: string) => {
    if (!totpSessionId || !currentHostConfig) return;

    try {
      const result = await submitMetricsTOTP(totpSessionId, totpCode);
      if (result.success) {
        setTotpRequired(false);
        toast.success(t("serverStats.totpVerified"));
        const data = await getServerMetricsById(currentHostConfig.id);
        setMetrics(data);
        setShowStatsUI(true);
      }
    } catch (error) {
      toast.error(t("serverStats.totpFailed"));
      console.error("TOTP verification failed:", error);
    }
  };

  const handleTOTPCancel = async () => {
    setTotpRequired(false);
    if (currentHostConfig?.id) {
      try {
        await stopMetricsPolling(currentHostConfig.id);
      } catch (error) {
        console.error("Failed to stop metrics polling:", error);
      }
    }
  };

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
    if (!statusCheckEnabled || !currentHostConfig?.id) {
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
    intervalId = window.setInterval(
      fetchStatus,
      statsConfig.statusCheckInterval * 1000,
    );

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [
    currentHostConfig?.id,
    statusCheckEnabled,
    statsConfig.statusCheckInterval,
  ]);

  React.useEffect(() => {
    if (!metricsEnabled || !currentHostConfig?.id) {
      setShowStatsUI(false);
      return;
    }

    let cancelled = false;
    let pollingIntervalId: number | undefined;
    let debounceTimeout: NodeJS.Timeout | undefined;

    const startMetrics = async () => {
      if (cancelled) return;

      setIsLoadingMetrics(true);

      try {
        const result = await startMetricsPolling(currentHostConfig.id);

        if (cancelled) return;

        if (result.requires_totp) {
          setTotpRequired(true);
          setTotpSessionId(result.sessionId || null);
          setTotpPrompt(result.prompt || "Verification code");
          setIsLoadingMetrics(false);
          return;
        }

        const data = await getServerMetricsById(currentHostConfig.id);
        if (!cancelled) {
          setMetrics(data);
          setShowStatsUI(true);
          setIsLoadingMetrics(false);
        }

        pollingIntervalId = window.setInterval(async () => {
          if (cancelled) return;
          try {
            const data = await getServerMetricsById(currentHostConfig.id);
            if (!cancelled) {
              setMetrics(data);
              setMetricsHistory((prev) => {
                const newHistory = [...prev, data];
                return newHistory.slice(-20);
              });
            }
          } catch (error) {
            if (!cancelled) {
              console.error("Failed to fetch metrics:", error);
            }
          }
        }, statsConfig.metricsInterval * 1000);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to start metrics polling:", error);
          setIsLoadingMetrics(false);
          setShowStatsUI(false);
          toast.error(t("serverStats.failedToFetchMetrics"));
        }
      }
    };

    const stopMetrics = async () => {
      if (pollingIntervalId) {
        window.clearInterval(pollingIntervalId);
        pollingIntervalId = undefined;
      }
      if (currentHostConfig?.id) {
        try {
          await stopMetricsPolling(currentHostConfig.id);
        } catch (error) {
          console.error("Failed to stop metrics polling:", error);
        }
      }
    };

    debounceTimeout = setTimeout(() => {
      if (isActuallyVisible) {
        startMetrics();
      } else {
        stopMetrics();
      }
    }, 500);

    return () => {
      cancelled = true;
      if (debounceTimeout) clearTimeout(debounceTimeout);
      if (pollingIntervalId) window.clearInterval(pollingIntervalId);
      if (currentHostConfig?.id) {
        stopMetricsPolling(currentHostConfig.id).catch(() => {});
      }
    };
  }, [
    currentHostConfig?.id,
    isActuallyVisible,
    metricsEnabled,
    statsConfig.metricsInterval,
  ]);

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
    ? "h-full w-full text-foreground overflow-hidden bg-transparent"
    : "bg-canvas text-foreground rounded-lg border-2 border-edge overflow-hidden";

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
                  <div className="w-4 h-4 border-2 border-foreground-secondary border-t-transparent rounded-full animate-spin"></div>
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

            {currentHostConfig?.enableDocker && (
              <Button
                variant="outline"
                className="font-semibold"
                onClick={() => {
                  const titleBase =
                    currentHostConfig?.name &&
                    currentHostConfig.name.trim() !== ""
                      ? currentHostConfig.name.trim()
                      : `${currentHostConfig.username}@${currentHostConfig.ip}`;
                  addTab({
                    type: "docker",
                    title: titleBase,
                    hostConfig: currentHostConfig,
                  });
                }}
              >
                {t("nav.docker")}
              </Button>
            )}
          </div>
        </div>
        <Separator className="p-0.25 w-full" />

        <div className="flex-1 overflow-y-auto min-h-0 thin-scrollbar">
          {(metricsEnabled && showStatsUI) ||
          (currentHostConfig?.quickActions &&
            currentHostConfig.quickActions.length > 0) ? (
            <div className="border-edge m-1 p-2 overflow-y-auto thin-scrollbar relative flex-1 flex flex-col">
              {currentHostConfig?.quickActions &&
                currentHostConfig.quickActions.length > 0 && (
                  <div className={metricsEnabled && showStatsUI ? "mb-4" : ""}>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-2">
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
                                <div className="w-3 h-3 border-2 border-foreground-secondary border-t-transparent rounded-full animate-spin"></div>
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
                      <p className="text-foreground-secondary mb-1">
                        {t("serverStats.serverOffline")}
                      </p>
                      <p className="text-sm text-foreground-subtle">
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
        </div>
      </div>

      {totpRequired && (
        <TOTPDialog
          isOpen={totpRequired}
          prompt={totpPrompt}
          onSubmit={handleTOTPSubmit}
          onCancel={handleTOTPCancel}
          backgroundColor="var(--bg-canvas)"
        />
      )}
    </div>
  );
}
