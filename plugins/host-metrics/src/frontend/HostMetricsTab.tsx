import {
  Separator,
  Button,
  useAreaPreferences,
  useConfirmation,
  TOTPDialog,
  useTabsSafe,
  ConnectionLogProvider,
  useConnectionLog,
  ConnectionScreen,
  runAdaptivePolling,
  CardGridCanvas,
  ColumnCountStepper,
  type GridCardCatalogEntry,
  logActivity,
  SnippetVariablesDialog,
} from "@termix/plugin-sdk/ui";
import { readHostMetricsSettings } from "../shared/stats-widgets.js";
import {
  defaultLayoutFromWidgets,
  type HostMetricsLayout,
} from "../shared/host-metrics.js";
import type { ServerMetrics } from "../shared/metrics.js";
/* eslint-disable react-hooks/exhaustive-deps */
import React from "react";
import { useHostMetricsApi } from "./host-metrics-api";

interface Snippet {
  id: number;
  name: string;
  content: string;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === "string" ? error : "";
}

// Mirrors the snippets plugin's own hasSnippetInputs: a pure check for
// whether a snippet still has $INPUT_n placeholders once host variables are
// substituted, so the quick-action dialog knows to ask before running.
const SNIPPET_INPUT_PATTERN =
  /\$\{INPUT_(\d+)(?::([^}$]+))?\}|\$INPUT_(\d+)(?![a-zA-Z0-9_])/g;
function hasSnippetInputs(content: string): boolean {
  SNIPPET_INPUT_PATTERN.lastIndex = 0;
  return SNIPPET_INPUT_PATTERN.test(content);
}
import {
  useTranslation,
  useSlotContributions,
  useConnectionRetry,
  useHost,
  useHostStatus,
  invokeAction,
} from "@termix/plugin-sdk/frontend";
import { toast } from "sonner";
import { RefreshCw, Server, LayoutDashboard } from "lucide-react";
import { useHostMetricsPreferences } from "./hooks/useHostMetricsPreferences.ts";
import {
  CARD_DEFINITIONS,
  IMPLEMENTED_CARD_IDS,
  getCardDefinition,
  definitionsFromSlot,
  defaultColSpanFor,
  defaultHeightFor,
  type MetricCardHistories,
} from "./cards";
import { appendGpuHistories } from "./cards/gpu-history";
import { metricsChangeKey } from "./metrics-change-key";

const HISTORY_LEN = 30;

interface QuickAction {
  name: string;
  snippetId: number;
}

type ConnectionLogPayload = Parameters<
  ReturnType<typeof useConnectionLog>["addLog"]
>[0];
type ConnectionLogError = Error & {
  connectionLogs?: ConnectionLogPayload[];
};

interface HostConfig {
  id: number;
  name: string;
  ip: string;
  username: string;
  quickActions?: QuickAction[];
  statusCheckEnabled?: boolean;
  pluginSettings?: Record<string, Record<string, unknown>>;
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

function HostMetricsInner({
  hostConfig,
  title,
  isVisible = true,
  isTopbarOpen = true,
  embedded = false,
}: HostMetricsProps): React.ReactElement {
  const { t } = useTranslation();
  const metricsApi = useHostMetricsApi();
  const { addLog, clearLogs } = useConnectionLog();
  const { currentTab, removeTab } = useTabsSafe();

  const [serverStatus, setServerStatus] = React.useState<"online" | "offline">(
    "offline",
  );
  const [metrics, setMetrics] = React.useState<ServerMetrics | null>(null);
  const [histories, setHistories] = React.useState<MetricCardHistories>({
    cpu: [],
    memory: [],
    disk: [],
    gpu: {},
  });
  const [currentHostConfig, setCurrentHostConfig] = React.useState(hostConfig);
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
  const [editMode, setEditMode] = React.useState(false);
  const [runningAction, setRunningAction] = React.useState<{
    action: QuickAction;
    snippet: Snippet;
  } | null>(null);
  const { confirmWithToast } = useConfirmation();

  const activityLoggedRef = React.useRef(false);
  const activityLoggingRef = React.useRef(false);
  const snippetsCacheRef = React.useRef(new Map<number, Snippet>());

  const statsConfig = React.useMemo(() => {
    const settings = readHostMetricsSettings(
      currentHostConfig?.pluginSettings?.["host-metrics"],
    );
    return { ...settings, metricsInterval: settings.metricsInterval ?? 30 };
  }, [currentHostConfig?.pluginSettings]);
  const metricsEnabled = statsConfig.metricsEnabled !== false;
  const statusCheckEnabled = currentHostConfig?.statusCheckEnabled !== false;

  const hostId = currentHostConfig?.id ?? null;
  const { layout, setLayout } = useHostMetricsPreferences(hostId);

  const metricsPrefs = useAreaPreferences("hostMetrics");

  const effectiveLayout: HostMetricsLayout = React.useMemo(() => {
    // A saved layout is user-authored, so the preset never rewrites it -- it
    // only decides the shape of the first layout a host gets.
    if (layout) return layout;
    return defaultLayoutFromWidgets(
      statsConfig.enabledWidgets ?? [],
      metricsPrefs.columns,
    );
  }, [layout, statsConfig.enabledWidgets, metricsPrefs.columns]);

  // Manager cards other plugins contribute (tailscale's, say), merged in next
  // to the ones this plugin ships. A contribution for a slot that never
  // arrives (its plugin is off) just never appears here.
  const managerContributions = useSlotContributions("host-metrics.managers");
  const pluginManagerDefs = React.useMemo(
    () => definitionsFromSlot(managerContributions),
    [managerContributions],
  );

  // Only render/keep cards that are implemented (metric cards in Phase A).
  const visibleSlots = React.useMemo(
    () =>
      effectiveLayout.slots.filter((s) =>
        getCardDefinition(s.id, pluginManagerDefs),
      ),
    [effectiveLayout.slots, pluginManagerDefs],
  );

  const cardCatalog: GridCardCatalogEntry[] = React.useMemo(
    () => [
      ...IMPLEMENTED_CARD_IDS.map((id) => ({
        id,
        label: t(CARD_DEFINITIONS[id].labelKey),
        defaultColSpan: defaultColSpanFor(id),
        defaultHeight: defaultHeightFor(id),
      })),
      ...Object.values(pluginManagerDefs).map((def) => ({
        id: def.id,
        label: t(def.labelKey),
        defaultColSpan: defaultColSpanFor(def.id),
        defaultHeight: defaultHeightFor(def.id),
      })),
    ],
    [t, pluginManagerDefs],
  );

  const cardLabel = React.useCallback(
    (id: string) => {
      const def = getCardDefinition(id, pluginManagerDefs);
      return def ? t(def.labelKey) : id;
    },
    [t, pluginManagerDefs],
  );

  const renderCard = React.useCallback(
    (id: string) => {
      const def = getCardDefinition(id, pluginManagerDefs);
      if (!def) return null;
      return def.render({ metrics, histories, hostId });
    },
    [metrics, histories, hostId, pluginManagerDefs],
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
      metricsApi.heartbeat(viewerSessionId).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [viewerSessionId, isActuallyVisible]);

  React.useEffect(() => {
    if (hostConfig?.id !== currentHostConfig?.id) {
      setServerStatus("offline");
      setMetrics(null);
      setHistories({ cpu: [], memory: [], disk: [], gpu: {} });
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
        gpu: appendGpuHistories(prev.gpu, data.gpu?.gpus, HISTORY_LEN),
      };
    });
  }, []);

  const handleTOTPSubmit = async (totpCode: string) => {
    if (!totpSessionId || !currentHostConfig) return;
    try {
      const result = await metricsApi.submitTotp(totpSessionId, totpCode);
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
      await metricsApi.stopMetrics(currentHostConfig.id).catch(() => {});
    }
    if (currentTab !== null) removeTab(currentTab);
  };

  // The shell keeps the host list current, including plugin settings.
  const latestHost = useHost(hostConfig?.id);
  React.useEffect(() => {
    if (latestHost) {
      setCurrentHostConfig({
        ...(latestHost as unknown as HostConfig),
        id: Number(latestHost.id),
      });
    }
  }, [latestHost]);

  // Core's status check, the same one behind the host list's dot.
  const hostStatus = useHostStatus(hostId ?? undefined);
  React.useEffect(() => {
    if (!statusCheckEnabled) {
      setServerStatus("offline");
      return;
    }
    if (hostStatus) {
      setServerStatus(hostStatus.status === "online" ? "online" : "offline");
    }
  }, [hostStatus?.status, statusCheckEnabled]);

  const stopMetricsPollingRef = React.useRef<(() => void) | null>(null);

  const fetchMetrics = React.useCallback(async (): Promise<void> => {
    if (!currentHostConfig?.id) return;
    if (currentHostConfig.authType === "none") {
      toast.error(t("hostMetrics.noneAuthNotSupported"));
      if (currentTab !== null) removeTab(currentTab);
      throw new Error(t("hostMetrics.noneAuthNotSupported"));
    }

    if (!totpVerified) {
      addLog({
        type: "info",
        stage: "stats_connecting",
        message: `Connecting to ${currentHostConfig.username}@${currentHostConfig.ip}:${currentHostConfig.port}`,
      });
      const result = await metricsApi.startMetrics(currentHostConfig.id);
      result?.connectionLogs?.forEach((log) =>
        addLog(log as ConnectionLogPayload),
      );
      if (result.requires_totp) {
        setTotpRequired(true);
        setTotpSessionId(result.sessionId || null);
        setTotpPrompt(result.prompt || "Verification code");
        // The TOTP dialog gates further progress; retry loop pauses via `enabled`.
        return;
      }
      if (result.viewerSessionId) setViewerSessionId(result.viewerSessionId);
    }

    // The connect above only opens the SSH session; the first real sample is
    // collected asynchronously on the backend (status check, then metrics
    // exec), so it isn't ready the instant the connection succeeds. Give it
    // a few short retries before treating the initial fetch as a failure.
    let data = await metricsApi.getMetrics(currentHostConfig.id);
    for (let i = 0; !data && i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      data = await metricsApi.getMetrics(currentHostConfig.id);
    }
    if (!data) {
      throw new Error(t("hostMetrics.connectionFailed"));
    }

    setMetrics(data);
    pushHistory(data);
    setServerStatus("online");
    logServerActivity();
    addLog({
      type: "success",
      stage: "connected",
      message: t("terminal.connected"),
    });

    let signature = metricsChangeKey(data);
    const minIntervalMs = statsConfig.metricsInterval * 1000;
    stopMetricsPollingRef.current?.();
    stopMetricsPollingRef.current = runAdaptivePolling(
      async () => {
        const next = await metricsApi.getMetrics(currentHostConfig.id);
        if (!next) throw new Error(t("hostMetrics.connectionFailed"));
        const nextSignature = metricsChangeKey(next);
        const changed = nextSignature !== signature;
        signature = nextSignature;
        setMetrics(next);
        pushHistory(next);
        return changed;
      },
      {
        minIntervalMs,
        maxIntervalMs: Math.min(120_000, minIntervalMs * 6),
        stablePollsPerStep: 3,
      },
      { runImmediately: false },
    );
  }, [
    currentHostConfig,
    totpVerified,
    statsConfig.metricsInterval,
    addLog,
    t,
    currentTab,
    removeTab,
    pushHistory,
    metricsApi,
  ]);

  const metricsRetry = useConnectionRetry({
    connect: async () => {
      try {
        await fetchMetrics();
        if (!totpRequired) metricsRetry.markConnected();
      } catch (error: unknown) {
        const logError = error as ConnectionLogError;
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
        metricsRetry.markFailed();
      }
    },
    enabled:
      isPageVisible &&
      metricsEnabled &&
      !totpRequired &&
      !!currentHostConfig?.id,
    autoStart: false,
  });

  const metricsRetryRef = React.useRef(metricsRetry);
  metricsRetryRef.current = metricsRetry;

  // Connects once per host and stays connected while this tab exists, even
  // when the user switches to another tab and back. Only the browser tab
  // going into the background (isPageVisible) pauses/resumes it -- switching
  // between Termix tabs must not tear down and reconnect the session.
  React.useEffect(() => {
    if (!metricsEnabled || !currentHostConfig?.id) return;

    let cancelled = false;

    const stopMetrics = async () => {
      stopMetricsPollingRef.current?.();
      stopMetricsPollingRef.current = null;
      if (currentHostConfig?.id) {
        await metricsApi
          .stopMetrics(currentHostConfig.id, viewerSessionId || undefined)
          .catch(() => {});
      }
    };

    const debounce = setTimeout(() => {
      if (cancelled) return;
      if (isPageVisible) {
        clearLogs();
        metricsRetryRef.current.reset();
        metricsRetryRef.current.retryNow();
      } else {
        stopMetrics();
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      stopMetricsPollingRef.current?.();
      stopMetricsPollingRef.current = null;
      if (currentHostConfig?.id) {
        metricsApi.stopMetrics(currentHostConfig.id).catch(() => {});
      }
    };
  }, [currentHostConfig?.id, isPageVisible, metricsEnabled]);

  // After a successful TOTP submit, resume the connect flow immediately.
  React.useEffect(() => {
    if (totpVerified && !totpRequired) {
      metricsRetryRef.current.reset();
      metricsRetryRef.current.retryNow();
    }
  }, [totpVerified, totpRequired]);

  const wrapperStyle: React.CSSProperties = embedded
    ? { opacity: isVisible ? 1 : 0, height: "100%", width: "100%" }
    : {
        opacity: isVisible ? 1 : 0,
        margin: isTopbarOpen ? "74px 17px 8px 8px" : "16px 17px 8px 8px",
        height: isTopbarOpen ? "calc(100vh - 82px)" : "calc(100vh - 24px)",
      };

  const handleRefresh = async () => {
    if (!currentHostConfig?.id) return;
    if (metricsRetry.status !== "connected") {
      metricsRetry.retryNow();
      return;
    }
    try {
      setIsRefreshing(true);
      const data = await metricsApi.getMetrics(currentHostConfig.id);
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

  async function executeQuickAction(
    action: QuickAction,
    inputValues: Record<string, string>,
  ) {
    if (!currentHostConfig) return;
    setExecutingActions((prev) => new Set(prev).add(action.snippetId));
    toast.loading(
      t("hostMetrics.executingQuickAction", { name: action.name }),
      {
        id: `quick-action-${action.snippetId}`,
      },
    );
    try {
      const result = (await invokeAction(
        "snippets.execute",
        action.snippetId,
        currentHostConfig.id,
        Object.keys(inputValues).length > 0 ? inputValues : undefined,
      )) as { success: boolean; output?: string; error?: string } | undefined;
      if (!result) {
        toast.error(t("hostMetrics.quickActionError", { name: action.name }), {
          id: `quick-action-${action.snippetId}`,
          description: t("hostMetrics.snippetsUnavailable"),
          duration: 5000,
        });
      } else if (result.success) {
        toast.success(
          t("hostMetrics.quickActionSuccess", { name: action.name }),
          {
            id: `quick-action-${action.snippetId}`,
            description: result.output?.substring(0, 200),
            duration: 5000,
          },
        );
      } else {
        toast.error(t("hostMetrics.quickActionFailed", { name: action.name }), {
          id: `quick-action-${action.snippetId}`,
          description: result.error || result.output,
          duration: 5000,
        });
      }
    } catch (error) {
      toast.error(t("hostMetrics.quickActionError", { name: action.name }), {
        id: `quick-action-${action.snippetId}`,
        description: errorText(error),
        duration: 5000,
      });
    } finally {
      setExecutingActions((prev) => {
        const next = new Set(prev);
        next.delete(action.snippetId);
        return next;
      });
    }
  }

  function runQuickActionWithConfirm(
    action: QuickAction,
    inputValues: Record<string, string>,
  ) {
    const shouldConfirm =
      localStorage.getItem("confirmSnippetExecution") === "true";
    const run = () => void executeQuickAction(action, inputValues);
    if (!shouldConfirm) {
      run();
      return;
    }
    confirmWithToast(
      t("newUi.sidebar.snippets.confirmRunMessage", { name: action.name }),
      run,
      t("newUi.sidebar.snippets.confirmRunButton"),
      t("newUi.sidebar.snippets.cancel"),
      { confirmOnEnter: true, duration: 6000 },
    );
  }

  async function runQuickAction(action: QuickAction) {
    if (!currentHostConfig) return;
    try {
      let snippet = snippetsCacheRef.current.get(action.snippetId);
      if (!snippet) {
        snippet =
          ((await invokeAction("snippets.get", action.snippetId)) as
            Snippet | null | undefined) ?? undefined;
        if (snippet) snippetsCacheRef.current.set(snippet.id, snippet);
      }
      if (snippet && hasSnippetInputs(snippet.content)) {
        setRunningAction({ action, snippet });
        return;
      }
    } catch {
      // fall through and run with no inputs if the snippet lookup fails
    }
    runQuickActionWithConfirm(action, {});
  }

  const showCards =
    metricsEnabled && metricsRetry.status === "connected" && metrics;
  const showOffline =
    metricsEnabled &&
    metricsRetry.status !== "connecting" &&
    !metrics &&
    serverStatus === "offline";

  return (
    <div
      style={wrapperStyle}
      className="relative flex flex-col overflow-hidden"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
          {!totpRequired &&
            (metricsRetry.status === "connected" || showOffline) && (
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
                          {currentHostConfig.quickActions.map(
                            (action, index) => {
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
                                  onClick={() => void runQuickAction(action)}
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
                            },
                          )}
                        </div>
                        <Separator
                          orientation="vertical"
                          className="mx-3 h-8"
                        />
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

        {metricsEnabled && !totpRequired && (
          <ConnectionScreen
            status={showOffline ? "connected" : metricsRetry.status}
            message={t("hostMetrics.connecting")}
            attempt={metricsRetry.attempt}
            maxAttempts={metricsRetry.maxAttempts}
            nextRetryInMs={metricsRetry.nextRetryInMs}
            onManualRetry={metricsRetry.retryNow}
            logPosition={
              metricsRetry.status === "error" ||
              metricsRetry.status === "disconnected"
                ? "top"
                : "bottom"
            }
            emptyState={
              showOffline ? (
                <div className="text-center opacity-40">
                  <Server className="mx-auto mb-4 size-16" />
                  <p className="text-xl font-bold uppercase tracking-widest">
                    {t("hostMetrics.serverOffline")}
                  </p>
                  <p className="text-sm font-semibold">
                    {t("hostMetrics.cannotFetchMetrics")}
                  </p>
                </div>
              ) : undefined
            }
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

      {runningAction && (
        <SnippetVariablesDialog
          snippet={
            runningAction.snippet as Parameters<
              typeof SnippetVariablesDialog
            >[0]["snippet"]
          }
          host={
            currentHostConfig
              ? {
                  ip: currentHostConfig.ip,
                  username: currentHostConfig.username,
                  port: currentHostConfig.port,
                  name: currentHostConfig.name,
                }
              : null
          }
          onCancel={() => setRunningAction(null)}
          onConfirm={(_resolvedContent, inputValues) => {
            const action = runningAction.action;
            setRunningAction(null);
            runQuickActionWithConfirm(action, inputValues);
          }}
        />
      )}
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
