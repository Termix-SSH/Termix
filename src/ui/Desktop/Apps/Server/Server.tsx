import React from "react";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { Status, StatusIndicator } from "@/components/ui/shadcn-io/status";
import { Separator } from "@/components/ui/separator.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import {
  Cpu,
  HardDrive,
  MemoryStick,
  Edit3,
  Plus,
  Save,
  X,
} from "lucide-react";
import { Tunnel } from "@/ui/Desktop/Apps/Tunnel/Tunnel.tsx";
import {
  getServerStatusById,
  getServerMetricsById,
  type ServerMetrics,
} from "@/ui/main-axios.ts";
import { useTabs } from "@/ui/Desktop/Navigation/Tabs/TabContext.tsx";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Responsive, WidthProvider, type Layout } from "react-grid-layout";
import {
  type Widget,
  type StatsConfig,
  DEFAULT_STATS_CONFIG,
  WIDGET_TYPE_CONFIG,
} from "@/types/stats-widgets";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const ResponsiveGridLayout = WidthProvider(Responsive);

interface ServerProps {
  hostConfig?: any;
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
  const { addTab, tabs } = useTabs() as any;
  const [serverStatus, setServerStatus] = React.useState<"online" | "offline">(
    "offline",
  );
  const [metrics, setMetrics] = React.useState<ServerMetrics | null>(null);
  const [currentHostConfig, setCurrentHostConfig] = React.useState(hostConfig);
  const [isLoadingMetrics, setIsLoadingMetrics] = React.useState(false);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [showStatsUI, setShowStatsUI] = React.useState(true);
  const [isEditMode, setIsEditMode] = React.useState(false);
  const [widgets, setWidgets] = React.useState<Widget[]>(
    DEFAULT_STATS_CONFIG.widgets,
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = React.useState(false);

  const statsConfig = React.useMemo((): StatsConfig => {
    if (!currentHostConfig?.statsConfig) {
      return DEFAULT_STATS_CONFIG;
    }
    try {
      const parsed =
        typeof currentHostConfig.statsConfig === "string"
          ? JSON.parse(currentHostConfig.statsConfig)
          : currentHostConfig.statsConfig;
      return parsed?.widgets ? parsed : DEFAULT_STATS_CONFIG;
    } catch (error) {
      console.error("Failed to parse statsConfig:", error);
      return DEFAULT_STATS_CONFIG;
    }
  }, [currentHostConfig?.statsConfig]);

  React.useEffect(() => {
    setWidgets(statsConfig.widgets);
  }, [statsConfig]);

  React.useEffect(() => {
    setCurrentHostConfig(hostConfig);
  }, [hostConfig]);

  const handleLayoutChange = (layout: Layout[]) => {
    if (!isEditMode) return;

    const updatedWidgets = widgets.map((widget) => {
      const layoutItem = layout.find((item) => item.i === widget.id);
      if (layoutItem) {
        return {
          ...widget,
          x: layoutItem.x,
          y: layoutItem.y,
          w: layoutItem.w,
          h: layoutItem.h,
        };
      }
      return widget;
    });

    setWidgets(updatedWidgets);
    setHasUnsavedChanges(true);
  };

  const handleDeleteWidget = (
    widgetId: string,
    e: React.MouseEvent<HTMLButtonElement>,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setWidgets((prev) => prev.filter((w) => w.id !== widgetId));
    setHasUnsavedChanges(true);
  };

  const handleSaveLayout = async () => {
    if (!currentHostConfig?.id) {
      toast.error(t("serverStats.failedToSaveLayout"));
      return;
    }

    try {
      const newConfig: StatsConfig = { widgets };
      const { updateSSHHost } = await import("@/ui/main-axios.ts");

      await updateSSHHost(currentHostConfig.id, {
        ...currentHostConfig,
        statsConfig: JSON.stringify(newConfig),
      } as any);

      setHasUnsavedChanges(false);
      toast.success(t("serverStats.layoutSaved"));
      window.dispatchEvent(new Event("ssh-hosts:changed"));
    } catch (error) {
      console.error("Failed to save layout:", error);
      toast.error(t("serverStats.failedToSaveLayout"));
    }
  };

  const renderWidget = (widget: Widget) => {
    const config = WIDGET_TYPE_CONFIG[widget.type];

    switch (widget.type) {
      case "cpu":
        return (
          <div className="h-full w-full space-y-3 p-4 rounded-lg bg-dark-bg/50 border border-dark-border/50 hover:bg-dark-bg/70 transition-colors duration-200">
            {isEditMode && (
              <button
                onClick={(e) => handleDeleteWidget(widget.id, e)}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute top-2 right-2 z-[9999] w-7 h-7 bg-red-500/90 hover:bg-red-600 text-white rounded-full flex items-center justify-center cursor-pointer shadow-lg"
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <div
              className={`flex items-center gap-2 mb-3 ${isEditMode ? "drag-handle cursor-move" : ""}`}
            >
              <Cpu className="h-5 w-5 text-blue-400" />
              <h3 className="font-semibold text-lg text-white">
                {config.label}
              </h3>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-300">
                  {(() => {
                    const pct = metrics?.cpu?.percent;
                    const cores = metrics?.cpu?.cores;
                    const pctText = typeof pct === "number" ? `${pct}%` : "N/A";
                    const coresText =
                      typeof cores === "number"
                        ? t("serverStats.cpuCores", { count: cores })
                        : t("serverStats.naCpus");
                    return `${pctText} ${t("serverStats.of")} ${coresText}`;
                  })()}
                </span>
              </div>
              <div className="relative">
                <Progress
                  value={
                    typeof metrics?.cpu?.percent === "number"
                      ? metrics!.cpu!.percent!
                      : 0
                  }
                  className="h-2"
                />
              </div>
              <div className="text-xs text-gray-500">
                {metrics?.cpu?.load
                  ? `Load: ${metrics.cpu.load[0].toFixed(2)}, ${metrics.cpu.load[1].toFixed(2)}, ${metrics.cpu.load[2].toFixed(2)}`
                  : "Load: N/A"}
              </div>
            </div>
          </div>
        );

      case "memory":
        return (
          <div className="h-full w-full space-y-3 p-4 rounded-lg bg-dark-bg/50 border border-dark-border/50 hover:bg-dark-bg/70 transition-colors duration-200">
            {isEditMode && (
              <button
                onClick={(e) => handleDeleteWidget(widget.id, e)}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute top-2 right-2 z-[9999] w-7 h-7 bg-red-500/90 hover:bg-red-600 text-white rounded-full flex items-center justify-center cursor-pointer shadow-lg"
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <div
              className={`flex items-center gap-2 mb-3 ${isEditMode ? "drag-handle cursor-move" : ""}`}
            >
              <MemoryStick className="h-5 w-5 text-green-400" />
              <h3 className="font-semibold text-lg text-white">
                {config.label}
              </h3>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-300">
                  {(() => {
                    const pct = metrics?.memory?.percent;
                    const used = metrics?.memory?.usedGiB;
                    const total = metrics?.memory?.totalGiB;
                    const pctText = typeof pct === "number" ? `${pct}%` : "N/A";
                    const usedText =
                      typeof used === "number"
                        ? `${used.toFixed(1)} GiB`
                        : "N/A";
                    const totalText =
                      typeof total === "number"
                        ? `${total.toFixed(1)} GiB`
                        : "N/A";
                    return `${pctText} (${usedText} ${t("serverStats.of")} ${totalText})`;
                  })()}
                </span>
              </div>
              <div className="relative">
                <Progress
                  value={
                    typeof metrics?.memory?.percent === "number"
                      ? metrics!.memory!.percent!
                      : 0
                  }
                  className="h-2"
                />
              </div>
              <div className="text-xs text-gray-500">
                {(() => {
                  const used = metrics?.memory?.usedGiB;
                  const total = metrics?.memory?.totalGiB;
                  const free =
                    typeof used === "number" && typeof total === "number"
                      ? (total - used).toFixed(1)
                      : "N/A";
                  return `Free: ${free} GiB`;
                })()}
              </div>
            </div>
          </div>
        );

      case "disk":
        return (
          <div className="h-full w-full space-y-3 p-4 rounded-lg bg-dark-bg/50 border border-dark-border/50 hover:bg-dark-bg/70 transition-colors duration-200">
            {isEditMode && (
              <button
                onClick={(e) => handleDeleteWidget(widget.id, e)}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute top-2 right-2 z-[9999] w-7 h-7 bg-red-500/90 hover:bg-red-600 text-white rounded-full flex items-center justify-center cursor-pointer shadow-lg"
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            <div
              className={`flex items-center gap-2 mb-3 ${isEditMode ? "drag-handle cursor-move" : ""}`}
            >
              <HardDrive className="h-5 w-5 text-orange-400" />
              <h3 className="font-semibold text-lg text-white">
                {config.label}
              </h3>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-300">
                  {(() => {
                    const pct = metrics?.disk?.percent;
                    const used = metrics?.disk?.usedHuman;
                    const total = metrics?.disk?.totalHuman;
                    const pctText = typeof pct === "number" ? `${pct}%` : "N/A";
                    const usedText = used ?? "N/A";
                    const totalText = total ?? "N/A";
                    return `${pctText} (${usedText} ${t("serverStats.of")} ${totalText})`;
                  })()}
                </span>
              </div>
              <div className="relative">
                <Progress
                  value={
                    typeof metrics?.disk?.percent === "number"
                      ? metrics!.disk!.percent!
                      : 0
                  }
                  className="h-2"
                />
              </div>
              <div className="text-xs text-gray-500">
                {(() => {
                  const available = metrics?.disk?.availableHuman;
                  return available
                    ? `Available: ${available}`
                    : "Available: N/A";
                })()}
              </div>
            </div>
          </div>
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
        } catch (error) {
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
        } catch (error) {
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
      } catch (error: any) {
        if (!cancelled) {
          if (error?.response?.status === 503) {
            setServerStatus("offline");
          } else if (error?.response?.status === 504) {
            setServerStatus("offline");
          } else if (error?.response?.status === 404) {
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
          setShowStatsUI(true);
        }
      } catch (error: any) {
        if (!cancelled) {
          setMetrics(null);
          setShowStatsUI(false);
          if (
            error?.code === "TOTP_REQUIRED" ||
            (error?.response?.status === 403 &&
              error?.response?.data?.error === "TOTP_REQUIRED")
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
      (tab: any) =>
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
                  } catch (error: any) {
                    if (
                      error?.code === "TOTP_REQUIRED" ||
                      (error?.response?.status === 403 &&
                        error?.response?.data?.error === "TOTP_REQUIRED")
                    ) {
                      toast.error(t("serverStats.totpUnavailable"));
                      setMetrics(null);
                      setShowStatsUI(false);
                    } else if (
                      error?.response?.status === 503 ||
                      error?.status === 503
                    ) {
                      setServerStatus("offline");
                      setMetrics(null);
                      setShowStatsUI(false);
                    } else if (
                      error?.response?.status === 504 ||
                      error?.status === 504
                    ) {
                      setServerStatus("offline");
                      setMetrics(null);
                      setShowStatsUI(false);
                    } else if (
                      error?.response?.status === 404 ||
                      error?.status === 404
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

        {showStatsUI && (
          <div className="rounded-lg border-2 border-dark-border m-3 bg-dark-bg-darker p-4">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-4 gap-2">
              <div className="flex items-center gap-2">
                {!isEditMode ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditMode(true)}
                    className="flex items-center gap-2"
                  >
                    <Edit3 className="h-4 w-4" />
                    {t("serverStats.editLayout")}
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsEditMode(false);
                        setHasUnsavedChanges(false);
                        setWidgets(statsConfig.widgets);
                      }}
                      className="flex items-center gap-2"
                    >
                      {t("serverStats.cancelEdit")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveLayout}
                      disabled={!hasUnsavedChanges}
                      className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600"
                    >
                      <Save className="h-4 w-4" />
                      {t("serverStats.saveLayout")}
                    </Button>
                  </>
                )}
              </div>
              {hasUnsavedChanges && (
                <span className="text-sm text-yellow-400">
                  {t("serverStats.unsavedChanges")}
                </span>
              )}
            </div>

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
              <ResponsiveGridLayout
                className="layout"
                layouts={{
                  lg: widgets.map((w) => ({
                    i: w.id,
                    x: w.x,
                    y: w.y,
                    w: w.w,
                    h: w.h,
                  })),
                }}
                breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                rowHeight={100}
                isDraggable={isEditMode}
                isResizable={isEditMode}
                onLayoutChange={handleLayoutChange}
                draggableHandle={isEditMode ? ".drag-handle" : ".no-drag"}
              >
                {widgets.map((widget) => (
                  <div key={widget.id} className="relative">
                    {renderWidget(widget)}
                  </div>
                ))}
              </ResponsiveGridLayout>
            )}
          </div>
        )}

        {/* SSH Tunnels */}
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

        <p className="px-4 pt-2 pb-2 text-sm text-gray-500">
          {t("serverStats.feedbackMessage")}{" "}
          <a
            href="https://github.com/LukeGus/Termix/issues/new"
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
