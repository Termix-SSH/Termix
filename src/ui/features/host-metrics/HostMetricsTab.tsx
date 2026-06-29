/* eslint-disable react-hooks/exhaustive-deps */
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
  type StatsConfig,
  DEFAULT_STATS_CONFIG,
} from "@/types/stats-widgets.ts";
import {
  defaultLayoutFromWidgets,
  type HostMetricsLayout,
} from "@/types/host-metrics.ts";
import { SimpleLoader } from "@/lib/SimpleLoader.tsx";
import { RefreshCw, Server, LayoutDashboard } from "lucide-react";
import {
  ConnectionLogProvider,
  useConnectionLog,
} from "@/ssh/connection-log/ConnectionLogContext.tsx";
import { ConnectionLog } from "@/ssh/connection-log/ConnectionLog.tsx";
import type { LogEntry } from "@/types/connection-log.ts";
import {
  CardGridCanvas,
  ColumnCountStepper,
} from "@/components/card-grid/CardGridCanvas.tsx";
import type { GridCardCatalogEntry } from "@/components/card-grid/types.ts";
import { useHostMetricsPreferences } from "./hooks/useHostMetricsPreferences.ts";
import {
  CARD_DEFINITIONS,
  IMPLEMENTED_CARD_IDS,
  getCardDefinition,
  defaultColSpanFor,
  defaultHeightFor,
  type MetricCardHistories,
} from "./cards";

const HISTORY_LEN = 30;

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
  quickActions?: QuickAction[];
  statsConfig?: string | StatsConfig;
  authType?: string;
  port?: number;
  [key: string]: unknown;
}

interface HostMetricsProps {
  hostConfig?: HostConfig;
  title?: string;
  isVisible?: boolean;
  isTopbarOpen?: boolean;
  embedded?: boolean;
}

function parseStatsConfig(raw?: string | StatsConfig): StatsConfig {
  if (!raw) return DEFAULT_STATS_CONFIG;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { ...DEFAULT_STATS_CONFIG, ...parsed };
  } catch {
    return DEFAULT_STATS_CONFIG;
  }
}

function HostMetricsInner({
  hostConfig,
  title,
  isVisible = true,
  isTopbarOpen = true,
  embedded = false,
}: HostMetricsProps): React.ReactElement {
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
  const [histories, setHistories] = React.useState<MetricCardHistories>({
    cpu: [],
    memory: [],
    disk: [],
  });
  const [currentHostConfig, setCurrentHostConfig] = React.useState(hostConfig);
  const [isLoadingMetrics, setIsLoadingMetrics] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
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
  const [editMode, setEditMode] = React.useState(false);

  const activityLoggedRef = React.useRef(false);
  const activityLoggingRef = React.useRef(false);

  const statsConfig = React.useMemo(
    () => parseStatsConfig(currentHostConfig?.statsConfig),
    [currentHostConfig?.statsConfig],
  );
  const metricsEnabled = statsConfig.metricsEnabled !== false;
  const statusCheckEnabled = statsConfig.statusCheckEnabled !== false;

  const hostId = currentHostConfig?.id ?? null;
  const { layout, setLayout } = useHostMetricsPreferences(hostId);

  const effectiveLayout: HostMetricsLayout = React.useMemo(() => {
    if (layout) return layout;
    return defaultLayoutFromWidgets(statsConfig.enabledWidgets ?? []);
  }, [layout, statsConfig.enabledWidgets]);

  // Only render/keep cards that are implemented (metric cards in Phase A).
  const visibleSlots = React.useMemo(
    () => effectiveLayout.slots.filter((s) => getCardDefinition(s.id)),
    [effectiveLayout.slots],
  );

  const cardCatalog: GridCardCatalogEntry[] = React.useMemo(
    () =>
      IMPLEMENTED_CARD_IDS.map((id) => ({
        id,
        label: t(CARD_DEFINITIONS[id].labelKey),
        defaultColSpan: defaultColSpanFor(id),
        defaultHeight: defaultHeightFor(id),
      })),
    [t],
  );

  const cardLabel = React.useCallback(
    (id: string) => {
      const def = getCardDefinition(id);
      return def ? t(def.labelKey) : id;
    },
    [t],
  );

  const renderCard = React.useCallback(
    (id: string) => {
      const def = getCardDefinition(id);
      if (!def) return null;
      return def.render({ metrics, histories, hostId });
    },
    [metrics, histories, hostId],
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
      sendMetricsHeartbeat(viewerSessionId).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [viewerSessionId, isActuallyVisible]);

  React.useEffect(() => {
    if (hostConfig?.id !== currentHostConfig?.id) {
      setServerStatus("offline");
      setMetrics(null);
      setHistories({ cpu: [], memory: [], disk: [] });
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
    } catch {
      activityLoggedRef.current = false;
    } finally {
      activityLoggingRef.current = false;
    }
  };

  const pushHistory = React.useCallback((data: ServerMetrics) => {
    setHistories((prev) => {
      const add = (arr: number[], v: number | null | undefined) =>
        [...arr, v ?? 0].slice(-HISTORY_LEN);
      return {
        cpu: add(prev.cpu, data.cpu?.percent),
        memory: add(prev.memory, data.memory?.percent),
        disk: add(prev.disk, data.disk?.percent),
      };
    });
  }, []);

  const handleTOTPSubmit = async (totpCode: string) => {
    if (!totpSessionId || !currentHostConfig) return;
    try {
      const result = await submitMetricsTOTP(totpSessionId, totpCode);
      if (result.success) {
        setTotpRequired(false);
        setTotpSessionId(null);
        setTotpVerified(true);
        if (result.viewerSessionId) setViewerSessionId(result.viewerSessionId);
      } else {
        toast.error(t("hostMetrics.totpFailed"));
      }
    } catch {
      toast.error(t("hostMetrics.totpFailed"));
    }
  };

  const handleTOTPCancel = async () => {
    setTotpRequired(false);
    if (currentHostConfig?.id) {
      await stopMetricsPolling(currentHostConfig.id).catch(() => {});
    }
    if (currentTab !== null) removeTab(currentTab);
  };

  React.useEffect(() => {
    const fetchLatest = async () => {
      if (!hostConfig?.id) return;
      try {
        const hosts = await getSSHHosts();
        const updated = hosts.find((h) => h.id === hostConfig.id);
        if (updated) setCurrentHostConfig(updated as unknown as HostConfig);
      } catch {
        toast.error(t("hostMetrics.failedToFetchHostConfig"));
      }
    };
    fetchLatest();
    const onChanged = () => fetchLatest();
    window.addEventListener("ssh-hosts:changed", onChanged);
    return () => window.removeEventListener("ssh-hosts:changed", onChanged);
  }, [hostConfig?.id]);

  React.useEffect(() => {
    if (!statusCheckEnabled || !currentHostConfig?.id) {
      setServerStatus("offline");
      return;
    }
    let cancelled = false;
    const fetchStatus = async () => {
      try {
        const res = await getServerStatusById(currentHostConfig.id);
        if (!cancelled) {
          setServerStatus(res?.status === "online" ? "online" : "offline");
        }
      } catch {
        if (!cancelled) setServerStatus("offline");
      }
    };
    fetchStatus();
    const id = window.setInterval(
      fetchStatus,
      statsConfig.statusCheckInterval * 1000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    currentHostConfig?.id,
    statusCheckEnabled,
    statsConfig.statusCheckInterval,
  ]);

  React.useEffect(() => {
    if (!metricsEnabled || !currentHostConfig?.id) return;

    let cancelled = false;
    let pollingId: number | undefined;
    if (isActuallyVisible && !metrics) setIsLoadingMetrics(true);
    else if (!isActuallyVisible) setIsLoadingMetrics(false);

    const startMetrics = async () => {
      if (cancelled) return;
      if (currentHostConfig.authType === "none") {
        toast.error(t("hostMetrics.noneAuthNotSupported"));
        setIsLoadingMetrics(false);
        if (currentTab !== null) removeTab(currentTab);
        return;
      }

      const hadMetrics = metrics !== null;
      if (!hadMetrics) setIsLoadingMetrics(true);
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
          result?.connectionLogs?.forEach((log) =>
            addLog(log as ConnectionLogPayload),
          );
          if (result.requires_totp) {
            setTotpRequired(true);
            setTotpSessionId(result.sessionId || null);
            setTotpPrompt(result.prompt || "Verification code");
            setIsLoadingMetrics(false);
            return;
          }
          if (result.viewerSessionId)
            setViewerSessionId(result.viewerSessionId);
        }

        // Poll until first metrics arrive. The backend's initial SSH collection
        // can take up to ~60s (queue timeout), so we wait up to 90s total.
        let retry = 0;
        let data: ServerMetrics | null = null;
        const maxRetries = 30;
        while (retry < maxRetries && !cancelled) {
          try {
            data = await getServerMetricsById(currentHostConfig.id);
            if (data) break;
          } catch {
            // non-404 error — keep retrying
          }
          retry++;
          if (retry < maxRetries && !cancelled) {
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
        if (cancelled) return;

        if (data) {
          setMetrics(data);
          setServerStatus("online");
          if (!hadMetrics) {
            setIsLoadingMetrics(false);
            logServerActivity();
          }
        } else {
          throw new Error(t("hostMetrics.connectionFailed"));
        }

        pollingId = window.setInterval(async () => {
          if (cancelled) return;
          try {
            const next = await getServerMetricsById(currentHostConfig.id);
            if (!cancelled && next) {
              setMetrics(next);
              pushHistory(next);
            }
          } catch {
            /* keep prior */
          }
        }, statsConfig.metricsInterval * 1000);
      } catch (error: unknown) {
        if (cancelled) return;
        const logError = error as ConnectionLogError;
        setIsLoadingMetrics(false);
        setHasConnectionError(true);
        if (logError.connectionLogs) {
          logError.connectionLogs.forEach((log) => addLog(log));
        } else {
          addLog({
            type: "error",
            stage: "connection",
            message:
              error instanceof Error
                ? error.message
                : t("hostMetrics.connectionFailed"),
          });
        }
      }
    };

    const stopMetrics = async () => {
      if (pollingId) {
        window.clearInterval(pollingId);
        pollingId = undefined;
      }
      if (currentHostConfig?.id) {
        await stopMetricsPolling(
          currentHostConfig.id,
          viewerSessionId || undefined,
        ).catch(() => {});
      }
    };

    const debounce = setTimeout(() => {
      if (isActuallyVisible) {
        if (!hasConnectionError) startMetrics();
      } else {
        stopMetrics();
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      if (pollingId) window.clearInterval(pollingId);
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
        pushHistory(data);
      }
    } catch {
      setServerStatus("offline");
    } finally {
      setIsRefreshing(false);
    }
  };

  const showCards =
    metricsEnabled && !isLoadingMetrics && metrics && !hasConnectionError;
  const showOffline =
    metricsEnabled &&
    !isLoadingMetrics &&
    !metrics &&
    serverStatus === "offline" &&
    !hasConnectionError;

  return (
    <div
      style={wrapperStyle}
      className="relative flex flex-col overflow-hidden"
    >
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{
          visibility:
            hasConnectionError && isConnectionLogExpanded
              ? "hidden"
              : "visible",
        }}
      >
        <div className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
          {!totpRequired && !isLoadingMetrics && !hasConnectionError && (
            <div className="mx-3 mt-3 flex shrink-0 items-center justify-between border border-border bg-card px-3 py-3">
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center border border-border bg-muted">
                  <Server className="size-5 text-accent-brand" />
                </div>
                <h1 className="text-lg font-bold md:text-2xl">{title}</h1>
              </div>
              <div className="flex items-center gap-0">
                {currentHostConfig?.quickActions &&
                  currentHostConfig.quickActions.length > 0 && (
                    <>
                      <div className="mr-3 flex flex-wrap gap-2">
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
                                  t("hostMetrics.executingQuickAction", {
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
                                      t("hostMetrics.quickActionSuccess", {
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
                                      t("hostMetrics.quickActionFailed", {
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
                                    t("hostMetrics.quickActionError", {
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
                                  <RefreshCw className="mr-1 size-3 animate-spin" />
                                  {action.name}
                                </>
                              ) : (
                                action.name
                              )}
                            </Button>
                          );
                        })}
                      </div>
                      <Separator orientation="vertical" className="mx-3 h-8" />
                    </>
                  )}
                {editMode && (
                  <>
                    <ColumnCountStepper
                      columns={effectiveLayout.columns}
                      onChange={(columns) =>
                        setLayout({ ...effectiveLayout, columns })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-2 text-xs text-muted-foreground"
                      onClick={() =>
                        setLayout(
                          defaultLayoutFromWidgets(
                            statsConfig.enabledWidgets ?? [],
                          ),
                        )
                      }
                    >
                      {t("hostMetrics.reset")}
                    </Button>
                  </>
                )}
                <Button
                  variant={editMode ? "default" : "ghost"}
                  size="icon"
                  className="ml-1"
                  title={t("hostMetrics.customize")}
                  onClick={() => setEditMode((v) => !v)}
                >
                  <LayoutDashboard className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="default"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="ml-1 gap-2 font-semibold"
                >
                  <RefreshCw
                    className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                  />
                  {t("hostMetrics.refresh")}
                </Button>
              </div>
            </div>
          )}

          {editMode && (
            <div className="mx-3 mt-3 flex shrink-0 items-center gap-2 border border-dashed border-accent-brand/40 bg-accent-brand/5 px-4 py-2">
              <LayoutDashboard className="size-3.5 shrink-0 text-accent-brand" />
              <span className="text-xs font-semibold text-accent-brand">
                {t("hostMetrics.editModeInstructions")}
              </span>
            </div>
          )}

          {showOffline && (
            <div className="flex flex-1 items-center justify-center py-20">
              <div className="text-center opacity-40">
                <Server className="mx-auto mb-4 size-16" />
                <p className="text-xl font-bold uppercase tracking-widest">
                  {t("hostMetrics.serverOffline")}
                </p>
                <p className="text-sm font-semibold">
                  {t("hostMetrics.cannotFetchMetrics")}
                </p>
              </div>
            </div>
          )}

          {showCards && (
            <div className="px-3 pt-3 pb-3">
              <CardGridCanvas
                slots={visibleSlots}
                columns={effectiveLayout.columns}
                editMode={editMode}
                renderCard={renderCard}
                cardCatalog={cardCatalog}
                cardLabel={cardLabel}
                onChange={(slots, columns) =>
                  setLayout({
                    slots: slots as HostMetricsLayout["slots"],
                    columns,
                  })
                }
              />
            </div>
          )}
        </div>

        {metricsEnabled && (
          <SimpleLoader
            visible={isLoadingMetrics && !metrics && !isConnectionLogExpanded}
            message={t("hostMetrics.connecting")}
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

export function HostMetricsTab(props: HostMetricsProps): React.ReactElement {
  return (
    <ConnectionLogProvider>
      <HostMetricsInner {...props} />
    </ConnectionLogProvider>
  );
}
