import React from "react";
import { Separator } from "@/components/separator.tsx";
import { Button } from "@/components/button.tsx";
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
} from "@/main-axios.ts";
import { TOTPDialog } from "@/ssh/dialogs/TOTPDialog.tsx";
import { useTabsSafe } from "@/shell/TabContext.tsx";
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
import { SimpleLoader } from "@/lib/SimpleLoader.tsx";
import { RefreshCw, Server } from "lucide-react";
import {
  ConnectionLogProvider,
  useConnectionLog,
} from "@/ssh/connection-log/ConnectionLogContext.tsx";
import { ConnectionLog } from "@/ssh/connection-log/ConnectionLog.tsx";
import type { LogEntry } from "@/types/connection-log.ts";

interface QuickAction {
  name: string;
  snippetId: number;
}

type ConnectionLogPayload = Omit<LogEntry, "id" | "timestamp">;

type ConnectionLogError = Error & {
  connectionLogs?: ConnectionLogPayload[];
};

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
  const {
    addLog,
    clearLogs,
    isExpanded: isConnectionLogExpanded,
  } = useConnectionLog();
  const { currentTab, removeTab } = useTabsSafe();
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
          addLog({
            type: "info",
            stage: "stats_connecting",
            message: `Connecting to ${currentHostConfig.username}@${currentHostConfig.ip}:${currentHostConfig.port}`,
          });
          const result = await startMetricsPolling(currentHostConfig.id);

          if (cancelled) return;

          if (result?.connectionLogs) {
            result.connectionLogs.forEach((log) => {
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
          } catch (error: unknown) {
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
          setServerStatus("online");
          if (!hasExistingMetrics) {
            setIsLoadingMetrics(false);
            logServerActivity();
          }
        }

        pollingIntervalId = window.setInterval(async () => {
          if (cancelled) return;
          try {
            const data = await getServerMetricsById(currentHostConfig.id);
            if (!cancelled && data) {
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
      } catch (error: unknown) {
        if (!cancelled) {
          const logError = error as ConnectionLogError;
          console.error("Failed to start metrics polling:", error);
          setIsLoadingMetrics(false);
          setHasConnectionError(true);

          if (logError.connectionLogs) {
            logError.connectionLogs.forEach((log) => {
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
              message:
                error instanceof Error
                  ? error.message
                  : t("serverStats.connectionFailed"),
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
      clearLogs();
      return;
    }

    try {
      setIsRefreshing(true);
      const res = await getServerStatusById(currentHostConfig.id);
      setServerStatus(res?.status === "online" ? "online" : "offline");
      const data = await getServerMetricsById(currentHostConfig.id);
      if (data) {
        setMetrics(data);
        setShowStatsUI(true);
      }
    } catch {
      setServerStatus("offline");
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div
      style={wrapperStyle}
      className="relative overflow-hidden flex flex-col"
    >
      <div
        className="flex flex-col flex-1 min-h-0 overflow-hidden"
        style={{
          visibility:
            hasConnectionError && isConnectionLogExpanded
              ? "hidden"
              : "visible",
        }}
      >
        <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col">
          {!totpRequired && !isLoadingMetrics && !hasConnectionError && (
            <div className="mx-3 mt-3 flex items-center justify-between border border-border bg-card px-3 py-3 shrink-0">
              <div className="flex items-center gap-3">
                <div className="size-10 border border-border bg-muted flex items-center justify-center shrink-0">
                  <Server className="size-5 text-accent-brand" />
                </div>
                <div>
                  <h1 className="text-lg md:text-2xl font-bold">{title}</h1>
                </div>
              </div>
              <div className="flex items-center gap-0">
                {currentHostConfig?.quickActions &&
                  currentHostConfig.quickActions.length > 0 && (
                    <>
                      <div className="flex flex-wrap gap-2 mr-3">
                        {currentHostConfig.quickActions.map((action, index) => {
                          const isExecuting = executingActions.has(
                            action.snippetId,
                          );
                          return (
                            <Button
                              key={index}
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs font-semibold"
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
                                        description: result.output?.substring(
                                          0,
                                          200,
                                        ),
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
                                          result.error || result.output,
                                        duration: 5000,
                                      },
                                    );
                                  }
                                } catch (error) {
                                  toast.error(
                                    t("serverStats.quickActionError", {
                                      name: action.name,
                                    }),
                                    {
                                      id: `quick-action-${action.snippetId}`,
                                      description:
                                        error instanceof Error
                                          ? error.message
                                          : "Unknown error",
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
                            >
                              {isExecuting ? (
                                <>
                                  <RefreshCw className="size-3 animate-spin mr-1" />
                                  {action.name}
                                </>
                              ) : (
                                action.name
                              )}
                            </Button>
                          );
                        })}
                      </div>
                      <Separator orientation="vertical" className="h-8 mx-3" />
                    </>
                  )}
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
                  {t("serverStats.refresh")}
                </Button>
              </div>
            </div>
          )}

          {metricsEnabled &&
            showStatsUI &&
            !isLoadingMetrics &&
            !metrics &&
            serverStatus === "offline" &&
            !hasConnectionError && (
              <div className="flex-1 flex items-center justify-center py-20">
                <div className="text-center">
                  <div className="opacity-40">
                    <Server className="size-16 mx-auto mb-4" />
                    <p className="text-xl font-bold uppercase tracking-widest">
                      {t("serverStats.serverOffline")}
                    </p>
                    <p className="text-sm font-semibold">
                      {t("serverStats.cannotFetchMetrics")}
                    </p>
                  </div>
                </div>
              </div>
            )}

          {metricsEnabled && showStatsUI && !isLoadingMetrics && metrics && (
            <div className="px-3 pt-3 pb-3 columns-1 md:columns-2 lg:columns-3 gap-3">
              {enabledWidgets.map((widgetType) => (
                <div key={widgetType} className="break-inside-avoid mb-3">
                  {renderWidget(widgetType)}
                </div>
              ))}
            </div>
          )}
        </div>

        {metricsEnabled && (
          <SimpleLoader
            visible={isLoadingMetrics && !metrics && !isConnectionLogExpanded}
            message={t("serverStats.connecting")}
          />
        )}
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
        isConnected={serverStatus === "online" && !hasConnectionError}
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
