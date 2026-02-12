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
  logActivity,
  sendMetricsHeartbeat,
  getSSHHosts,
  type ServerMetrics,
} from "@/ui/main-axios.ts";
import { TOTPDialog } from "@/ui/desktop/navigation/dialogs/TOTPDialog.tsx";
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
  PortsWidget,
  FirewallWidget,
} from "./widgets";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";
import { RefreshCcw, RefreshCw, RefreshCwOff } from "lucide-react";
import {
  ConnectionLogProvider,
  useConnectionLog,
} from "@/ui/desktop/navigation/connection-log/ConnectionLogContext.tsx";
import { ConnectionLog } from "@/ui/desktop/navigation/connection-log/ConnectionLog.tsx";

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

function ServerStatsInner({
  hostConfig,
  title,
  isVisible = true,
  isTopbarOpen = true,
  embedded = false,
}: ServerProps): React.ReactElement {
  const { t } = useTranslation();
  const { state: sidebarState } = useSidebar();
  const {
    addLog,
    clearLogs,
    isExpanded: isConnectionLogExpanded,
  } = useConnectionLog();
  const { addTab, tabs, currentTab, removeTab } = useTabs() as {
    addTab: (tab: { type: string; [key: string]: unknown }) => number;
    tabs: TabData[];
    currentTab: number | null;
    removeTab: (tabId: number) => void;
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
  const [totpVerified, setTotpVerified] = React.useState(false);
  const [viewerSessionId, setViewerSessionId] = React.useState<string | null>(
    null,
  );
  const [hasConnectionError, setHasConnectionError] = React.useState(false);

  const activityLoggedRef = React.useRef(false);
  const activityLoggingRef = React.useRef(false);

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
    if (!viewerSessionId || !isActuallyVisible) return;

    const heartbeatInterval = setInterval(async () => {
      try {
        await sendMetricsHeartbeat(viewerSessionId);
      } catch (error) {
        console.error("Failed to send heartbeat:", error);
      }
    }, 30000);

    return () => clearInterval(heartbeatInterval);
  }, [viewerSessionId, isActuallyVisible]);

  React.useEffect(() => {
    if (hostConfig?.id !== currentHostConfig?.id) {
      setServerStatus("offline");
      setMetrics(null);
      setMetricsHistory([]);
      setShowStatsUI(true);
    }
    setCurrentHostConfig(hostConfig);
  }, [hostConfig?.id]);

  const logServerActivity = async () => {
    if (
      !currentHostConfig?.id ||
      activityLoggedRef.current ||
      activityLoggingRef.current
    ) {
      return;
    }

    activityLoggingRef.current = true;
    activityLoggedRef.current = true;

    try {
      const hostName =
        currentHostConfig.name ||
        `${currentHostConfig.username}@${currentHostConfig.ip}`;
      await logActivity("server_stats", currentHostConfig.id, hostName);
    } catch (err) {
      console.warn("Failed to log server stats activity:", err);
      activityLoggedRef.current = false;
    } finally {
      activityLoggingRef.current = false;
    }
  };

  const handleTOTPSubmit = async (totpCode: string) => {
    if (!totpSessionId || !currentHostConfig) return;

    try {
      const result = await submitMetricsTOTP(totpSessionId, totpCode);
      if (result.success) {
        setTotpRequired(false);
        setTotpSessionId(null);
        setShowStatsUI(true);
        setTotpVerified(true);
        if (result.viewerSessionId) {
          setViewerSessionId(result.viewerSessionId);
        }
      } else {
        toast.error(t("serverStats.totpFailed"));
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
    if (currentTab !== null) {
      removeTab(currentTab);
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

      case "ports":
        return (
          <PortsWidget metrics={metrics} metricsHistory={metricsHistory} />
        );

      case "firewall":
        return (
          <FirewallWidget metrics={metrics} metricsHistory={metricsHistory} />
        );

      default:
        return null;
    }
  };

  React.useEffect(() => {
    const fetchLatestHostConfig = async () => {
      if (hostConfig?.id) {
        try {
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
    const intervalId = window.setInterval(
      fetchStatus,
      statsConfig.statusCheckInterval * 1000,
    );

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    currentHostConfig?.id,
    statusCheckEnabled,
    statsConfig.statusCheckInterval,
  ]);

  React.useEffect(() => {
    if (!metricsEnabled || !currentHostConfig?.id) {
      return;
    }

    let cancelled = false;
    let pollingIntervalId: number | undefined;
    if (isActuallyVisible && !metrics) {
      setIsLoadingMetrics(true);
      setShowStatsUI(true);
    } else if (!isActuallyVisible) {
      setIsLoadingMetrics(false);
    }

    const startMetrics = async () => {
      if (cancelled) return;

      if (currentHostConfig.authType === "none") {
        toast.error(t("serverStats.noneAuthNotSupported"));
        setIsLoadingMetrics(false);
        if (currentTab !== null) {
          removeTab(currentTab);
        }
        return;
      }

      const hasExistingMetrics = metrics !== null;

      if (!hasExistingMetrics) {
        setIsLoadingMetrics(true);
      }
      setShowStatsUI(true);
      setHasConnectionError(false);
      clearLogs();

      try {
        if (!totpVerified) {
          const result = await startMetricsPolling(currentHostConfig.id);

          if (cancelled) return;

          if (result?.connectionLogs) {
            result.connectionLogs.forEach((log: any) => {
              addLog({
                type: log.type,
                stage: log.stage,
                message: log.message,
                details: log.details,
              });
            });
          }

          if (result.requires_totp) {
            setTotpRequired(true);
            setTotpSessionId(result.sessionId || null);
            setTotpPrompt(result.prompt || "Verification code");
            setIsLoadingMetrics(false);
            return;
          }

          if (result.viewerSessionId) {
            setViewerSessionId(result.viewerSessionId);
          }
        }

        let retryCount = 0;
        let data = null;
        const maxRetries = 15;
        const retryDelay = 2000;

        while (retryCount < maxRetries && !cancelled) {
          try {
            data = await getServerMetricsById(currentHostConfig.id);
            break;
          } catch (error: any) {
            retryCount++;
            if (retryCount === 1) {
              const initialDelay = totpVerified ? 3000 : 5000;
              await new Promise((resolve) => setTimeout(resolve, initialDelay));
            } else if (retryCount < maxRetries && !cancelled) {
              await new Promise((resolve) => setTimeout(resolve, retryDelay));
            } else {
              throw error;
            }
          }
        }

        if (cancelled) return;

        if (data) {
          setMetrics(data);
          if (!hasExistingMetrics) {
            setIsLoadingMetrics(false);
            logServerActivity();
            setTimeout(() => clearLogs(), 1000);
          }
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
      } catch (error: any) {
        if (!cancelled) {
          console.error("Failed to start metrics polling:", error);
          setIsLoadingMetrics(false);
          setHasConnectionError(true);

          if (error?.connectionLogs) {
            error.connectionLogs.forEach((log: any) => {
              addLog({
                type: log.type,
                stage: log.stage,
                message: log.message,
                details: log.details,
              });
            });
          } else {
            addLog({
              type: "error",
              stage: "connection",
              message: error?.message || t("serverStats.connectionFailed"),
            });
          }
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
          await stopMetricsPolling(
            currentHostConfig.id,
            viewerSessionId || undefined,
          );
        } catch (error) {
          console.error("Failed to stop metrics polling:", error);
        }
      }
    };

    const debounceTimeout = setTimeout(() => {
      if (isActuallyVisible) {
        if (!hasConnectionError) {
          startMetrics();
        }
      } else {
        stopMetrics();
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(debounceTimeout);
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
    totpVerified,
    hasConnectionError,
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
    <div style={wrapperStyle} className={`${containerClass} relative`}>
      <div
        className="h-full w-full flex flex-col"
        style={{
          visibility:
            hasConnectionError && isConnectionLogExpanded
              ? "hidden"
              : "visible",
        }}
      >
        {!totpRequired && !isLoadingMetrics && (
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
                      const res = await getServerStatusById(
                        currentHostConfig.id,
                      );
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
                        response?: {
                          status?: number;
                          data?: { error?: string };
                        };
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
                    <RefreshCw className="animate-spin" />
                  </div>
                ) : (
                  <RefreshCw />
                )}
              </Button>
            </div>
          </div>
        )}
        {!totpRequired && !isLoadingMetrics && (
          <Separator className="p-0.25 w-full" />
        )}

        <div className="flex-1 overflow-y-auto min-h-0 thin-scrollbar relative">
          {(metricsEnabled && showStatsUI) ||
          (currentHostConfig?.quickActions &&
            currentHostConfig.quickActions.length > 0) ? (
            <div className="border-edge m-1 p-2 overflow-y-auto thin-scrollbar flex-1 flex flex-col">
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
                !isLoadingMetrics &&
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
                ) : metrics ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {enabledWidgets.map((widgetType) => (
                      <div key={widgetType} className="h-[280px]">
                        {renderWidget(widgetType)}
                      </div>
                    ))}
                  </div>
                ) : null)}
            </div>
          ) : null}

          {metricsEnabled && (
            <SimpleLoader
              visible={isLoadingMetrics && !metrics && !isConnectionLogExpanded}
              message={t("serverStats.connecting")}
            />
          )}
        </div>
      </div>

      <TOTPDialog
        isOpen={totpRequired}
        prompt={totpPrompt}
        onSubmit={handleTOTPSubmit}
        onCancel={handleTOTPCancel}
        backgroundColor="var(--bg-canvas)"
      />
      <ConnectionLog
        isConnecting={isLoadingMetrics}
        isConnected={serverStatus === "online"}
        hasConnectionError={hasConnectionError}
        position={hasConnectionError ? "top" : "bottom"}
      />
    </div>
  );
}

export function ServerStats(props: ServerProps): React.ReactElement {
  return (
    <ConnectionLogProvider>
      <ServerStatsInner {...props} />
    </ConnectionLogProvider>
  );
}
