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
  sshHostApi,
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
import { ManageCustomButtons } from "./ManageCustomButtons.tsx";
import { CommandOutputDialog } from "./CommandOutputDialog.tsx";

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
  const [customButtons, setCustomButtons] = React.useState<
    Array<{ id: number; label: string; command: string; icon?: string }>
  >([]);
  const [showManageButtons, setShowManageButtons] = React.useState(false);
  const [commandOutput, setCommandOutput] = React.useState<{
    output: string;
    errorOutput: string;
    exitCode: number;
    label: string;
  } | null>(null);
  const [isExecutingCommand, setIsExecutingCommand] = React.useState(false);

  // Parse stats config for monitoring settings
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
    setCurrentHostConfig(hostConfig);
  }, [hostConfig]);

  const fetchCustomButtons = React.useCallback(async () => {
    if (!currentHostConfig?.id) return;
    try {
      const response = await sshHostApi.get(
        `/db/host/${currentHostConfig.id}/custom-buttons`,
      );
      setCustomButtons(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error("Failed to fetch custom buttons:", error);
      setCustomButtons([]);
    }
  }, [currentHostConfig?.id]);

  React.useEffect(() => {
    fetchCustomButtons();
  }, [fetchCustomButtons]);

  const executeCustomCommand = async (button: {
    id: number;
    label: string;
    command: string;
  }) => {
    if (!currentHostConfig?.id || isExecutingCommand) return;

    try {
      setIsExecutingCommand(true);
      toast.info(t("serverStats.commandExecuting"));

      const response = await sshHostApi.post(
        `/db/host/${currentHostConfig.id}/custom-buttons/${button.id}/execute`,
      );

      setCommandOutput({
        output: response.data.output || "",
        errorOutput: response.data.errorOutput || "",
        exitCode: response.data.exitCode || 0,
        label: button.label,
      });

      if (response.data.exitCode === 0) {
        toast.success(t("serverStats.commandSuccess"));
      } else {
        toast.error(t("serverStats.commandFailed"));
      }
    } catch (error) {
      console.error("Failed to execute command:", error);
      toast.error(t("serverStats.failedToExecuteCommand"));
      setCommandOutput({
        output: "",
        errorOutput: error instanceof Error ? error.message : "Unknown error",
        exitCode: 1,
        label: button.label,
      });
    } finally {
      setIsExecutingCommand(false);
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

  // Separate effect for status monitoring
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
            // Status not available - monitoring disabled
            setServerStatus("offline");
          } else {
            setServerStatus("offline");
          }
        }
      }
    };

    fetchStatus();
    intervalId = window.setInterval(fetchStatus, 10000); // Poll backend every 10 seconds

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [currentHostConfig?.id, isVisible, statusCheckEnabled]);

  // Separate effect for metrics monitoring
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
            // Keep last 20 data points for chart
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
            // Metrics not available - monitoring disabled
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
    intervalId = window.setInterval(fetchMetrics, 10000); // Poll backend every 10 seconds

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
          {/* Custom Buttons Section */}
          {currentHostConfig?.id && (
            <div className="rounded-lg border border-dark-border m-3 bg-dark-bg-darker overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-dark-bg/30 border-b border-dark-border/50">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary"></div>
                  <h3 className="font-semibold text-gray-200">
                    {t("serverStats.customButtons")}
                  </h3>
                  {Array.isArray(customButtons) && customButtons.length > 0 && (
                    <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded-md bg-dark-bg/50">
                      {customButtons.length}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowManageButtons(true)}
                  className="h-7 text-xs hover:bg-dark-bg"
                >
                  {t("serverStats.manageButtons")}
                </Button>
              </div>
              <div className="p-4">
                {Array.isArray(customButtons) && customButtons.length > 0 ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    {customButtons.map((button) => (
                      <Button
                        key={button.id}
                        variant="outline"
                        size="sm"
                        disabled={isExecutingCommand}
                        onClick={() => executeCustomCommand(button)}
                        className="font-medium hover:bg-primary/10 hover:border-primary/50 transition-colors"
                      >
                        {button.label}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="w-12 h-12 rounded-full bg-dark-bg/50 flex items-center justify-center mb-3">
                      <svg
                        className="w-6 h-6 text-muted-foreground"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                        />
                      </svg>
                    </div>
                    <p className="text-sm text-muted-foreground mb-1">
                      {t("serverStats.noCustomButtons")}
                    </p>
                    <p className="text-xs text-muted-foreground/70 max-w-md">
                      {t("serverStats.noCustomButtonsMessage")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {metricsEnabled && showStatsUI && (
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

        <ManageCustomButtons
          isOpen={showManageButtons}
          hostId={currentHostConfig?.id || 0}
          onClose={() => setShowManageButtons(false)}
          onButtonsUpdated={fetchCustomButtons}
        />

        {commandOutput && (
          <CommandOutputDialog
            isOpen={!!commandOutput}
            output={commandOutput.output}
            errorOutput={commandOutput.errorOutput}
            exitCode={commandOutput.exitCode}
            commandLabel={commandOutput.label}
            onClose={() => setCommandOutput(null)}
          />
        )}
      </div>
    </div>
  );
}
