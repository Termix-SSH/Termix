import { useState, useRef, useCallback, useEffect } from "react";
import { enabledHostProtocols, protocolPort } from "@/sidebar/host-protocols";
import { ComponentSlot } from "@/shell/ActionSlot";
import { useActionSlot } from "@/hooks/use-action-slot";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { Separator } from "@/components/separator";
import {
  Activity,
  Database,
  ExternalLink,
  GripHorizontal,
  GripVertical,
  KeyRound,
  LayoutDashboard,
  Network,
  Plus,
  Server,
  Settings,
  Trash2,
  User,
  Zap,
} from "lucide-react";
import { Kbd } from "@/components/kbd";
import { VersionBadge } from "@/components/version-badge";
import { DASHBOARD_CARDS } from "@/lib/theme";
import { CONNECTION_STATES } from "@/types/index";
import { invokeAction } from "@/shell/action-registry";
import type { DashboardCardId, TabType, Host } from "@/types/ui-types";
import {
  getSSHHosts,
  getUptime,
  getVersionInfo,
  releaseUrlFrom,
  getDatabaseHealth,
  getRecentActivity,
  getCredentials,
  resetRecentActivity,
  getUserInfo,
  isElectron,
} from "@/main-axios";
import type { RecentActivityItem } from "@/main-axios";
import { useTranslation } from "react-i18next";
import {
  getRegisteredDashboardCard,
  useRegisteredDashboardCards,
} from "./dashboard-cards-registry";
import { PluginViewPlaceholder } from "@/plugin-host/PluginViewPlaceholder";
import { activityTarget } from "@/lib/activity-types";
import { shell } from "@/plugin-host/shell-bridge";
import {
  defaultConnectAction,
  hostActionsFor,
  listHostActions,
} from "@/sidebar/host-contributions";
import {
  useStatusColorScheme,
  getStatusClasses,
} from "@/hooks/use-status-color-scheme";
import { useServerStatus } from "@/lib/ServerStatusContext";
import { sshHostToHost } from "@/sidebar/HostManagerData";
import { getDefaultConnectionTab } from "@/lib/host-connection-tabs";

// ─── Types ────────────────────────────────────────────────────────────────────

type PanelId = "main" | "side";

type CardSlot = {
  key: string;
  id: DashboardCardId;
  panel: PanelId;
  order: number;
  height: number | null;
};

type DragState = {
  key: string;
  id: DashboardCardId;
  sourcePanel: PanelId;
  sourceOrder: number;
} | null;

// ─── Default layout ───────────────────────────────────────────────────────────

const DEFAULT_SLOTS: CardSlot[] = [
  { key: "stats_bar_0", id: "stats_bar", panel: "main", order: 0, height: 96 },
  {
    key: "counters_bar_0",
    id: "counters_bar",
    panel: "main",
    order: 1,
    height: 48,
  },
  {
    key: "quick_actions_0",
    id: "quick_actions",
    panel: "main",
    order: 2,
    height: 160,
  },
  {
    key: "host_status_0",
    id: "host_status",
    panel: "main",
    order: 3,
    height: null,
  },
  {
    key: "recent_activity_0",
    id: "recent_activity",
    panel: "side",
    order: 0,
    height: null,
  },
];

/** Cards core draws itself; any other id belongs to a plugin. */
const CORE_CARD_IDS = new Set<string>([
  "stats_bar",
  "counters_bar",
  "quick_actions",
  "host_status",
  "recent_activity",
]);

/**
 * A plugin's card, or a placeholder that keeps the slot while its plugin is
 * off, so the card comes back in the same place when the plugin does.
 */
export function PluginCardSlot({
  id,
  isVisible,
  onOpenSingletonTab,
}: {
  id: string;
  isVisible: boolean;
  onOpenSingletonTab: (type: TabType, pendingEvent?: string) => void;
}) {
  useRegisteredDashboardCards();
  const card = getRegisteredDashboardCard(id);
  if (!card) {
    return (
      <Card className="flex h-full w-full overflow-hidden py-0">
        <PluginViewPlaceholder kind="card" viewId={id} compact />
      </Card>
    );
  }
  const Component = card.component;
  return (
    <Component
      isVisible={isVisible}
      shell={{
        ...shell,
        openSingletonTab: (type) => onOpenSingletonTab(type),
      }}
    />
  );
}

// ─── Card components ──────────────────────────────────────────────────────────

function StatsBarCard({
  hosts,
  uptimeFormatted,
  versionText,
  versionStatus,
  releaseUrl,
  dbHealth,
}: {
  hosts: Host[];
  uptimeFormatted: string;
  versionText: string;
  versionStatus: "up_to_date" | "requires_update" | "beta" | "unknown";
  releaseUrl: string;
  dbHealth: "healthy" | "error";
}) {
  const { t } = useTranslation();
  const online = hosts.filter((h) => h.status === "online").length;
  return (
    <Card className="grid grid-cols-4 divide-x divide-border overflow-hidden w-full h-full py-0 gap-0">
      <div className="flex flex-col justify-center px-4 py-2 gap-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
          {t("dashboard.version")}
        </span>
        <span className="text-xl font-bold text-accent-brand leading-none">
          {versionText || "—"}
        </span>
        <VersionBadge
          status={versionStatus}
          releaseUrl={releaseUrl}
          className="w-fit"
        />
      </div>
      <div className="flex flex-col justify-center px-4 py-2 gap-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
          {t("dashboard.uptime")}
        </span>
        <span className="text-xl font-bold leading-none">
          {uptimeFormatted || "—"}
        </span>
      </div>
      <div className="flex flex-col justify-center px-4 py-2 gap-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
          {t("dashboard.database")}
        </span>
        <span
          className={`text-xl font-bold leading-none ${dbHealth === "healthy" ? "text-accent-brand" : "text-red-400"}`}
        >
          {dbHealth === "healthy"
            ? t("dashboard.healthy")
            : t("dashboard.error")}
        </span>
      </div>
      <div className="flex flex-col justify-center px-4 py-2 gap-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
          {t("dashboardTab.hostsAvailable", {
            defaultValue: "Hosts Available",
          })}
        </span>
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold leading-none">{online}</span>
          <span className="text-base text-muted-foreground leading-none">
            /{hosts.length}
          </span>
        </div>
      </div>
    </Card>
  );
}

function CountersBarCard({
  hosts,
  credentialCount,
  activeTunnelCount,
  onOpenSingletonTab,
}: {
  hosts: Host[];
  credentialCount: number;
  activeTunnelCount: number;
  onOpenSingletonTab: (type: TabType, pendingEvent?: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Card className="grid grid-cols-3 divide-x divide-border overflow-hidden w-full h-full py-0 gap-0">
      <button
        onClick={() => onOpenSingletonTab("host-manager")}
        className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted transition-colors cursor-pointer text-left"
      >
        <Server className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-base font-bold">{hosts.length}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
          {t("dashboard.totalHosts")}
        </span>
      </button>
      <button
        onClick={() =>
          onOpenSingletonTab("host-manager", "host-manager:show-credentials")
        }
        className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted transition-colors cursor-pointer text-left"
      >
        <KeyRound className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-base font-bold">{credentialCount}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
          {t("dashboard.totalCredentials")}
        </span>
      </button>
      <button
        onClick={() => void invokeAction("tunnels.open")}
        className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted transition-colors cursor-pointer text-left"
      >
        <Network className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-base font-bold">{activeTunnelCount}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
          {t("dashboardTab.activeTunnels")}
        </span>
      </button>
    </Card>
  );
}

function QuickActionsCard({
  onOpenSingletonTab,
  hosts,
  onOpenTab,
  isAdmin,
}: {
  onOpenSingletonTab: (type: TabType, pendingEvent?: string) => void;
  hosts: Host[];
  onOpenTab: (host: Host, type: TabType) => void;
  isAdmin: boolean;
}) {
  const { t } = useTranslation();
  const pinnedHosts = hosts.filter((h) => h.pin);
  const getConnectionEndpoint = (host: Host) => {
    const protocol = host.enableSsh ? undefined : enabledHostProtocols(host)[0];
    const port = host.enableSsh
      ? host.sshPort
      : protocol
        ? protocolPort(host.pluginSettings, protocol)
        : host.port;
    return `${host.ip}:${port ?? host.port}`;
  };
  const renderConnectionIcon = (host: Host) => {
    const Icon = defaultConnectAction(listHostActions(), host)?.icon ?? Server;
    return <Icon className="size-3 text-accent-brand" />;
  };
  return (
    <Card className="flex flex-col overflow-hidden w-full h-full py-0 gap-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <Zap className="size-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
          {t("dashboard.quickActions")}
        </span>
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col flex-1 border-r border-border">
          <button
            onClick={() =>
              onOpenSingletonTab("host-manager", "host-manager:add-host")
            }
            className="group/btn flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted transition-colors cursor-pointer border-b border-border flex-1"
          >
            <div className="size-7 border border-border bg-muted flex items-center justify-center shrink-0 group-hover/btn:bg-accent-brand/20 group-hover/btn:border-accent-brand/40 transition-colors">
              <Plus className="size-3 text-accent-brand" />
            </div>
            <div className="flex flex-col items-start text-left">
              <span className="text-xs font-semibold">
                {t("dashboard.addHost")}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {t("dashboardTab.registerNewServer")}
              </span>
            </div>
          </button>
          <button
            onClick={() =>
              onOpenSingletonTab("host-manager", "host-manager:add-credential")
            }
            className="group/btn flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted transition-colors cursor-pointer flex-1"
          >
            <div className="size-7 border border-border bg-muted flex items-center justify-center shrink-0 group-hover/btn:bg-accent-brand/20 group-hover/btn:border-accent-brand/40 transition-colors">
              <KeyRound className="size-3 text-accent-brand" />
            </div>
            <div className="flex flex-col items-start text-left">
              <span className="text-xs font-semibold">
                {t("dashboard.addCredential")}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {t("dashboardTab.storeSshKeysOrPasswords")}
              </span>
            </div>
          </button>
        </div>
        <div className="flex flex-col flex-1">
          {pinnedHosts.length > 0 ? (
            <div className="flex flex-col flex-1 overflow-y-auto thin-scrollbar">
              {pinnedHosts.slice(0, 4).map((host) => (
                <button
                  key={host.id}
                  onClick={() => {
                    const type = getDefaultConnectionTab(host);
                    if (type) onOpenTab(host, type);
                  }}
                  className="group/btn flex items-center gap-2.5 px-4 py-2 hover:bg-muted transition-colors cursor-pointer border-b border-border last:border-b-0"
                >
                  <div className="size-7 border border-border bg-muted flex items-center justify-center shrink-0 group-hover/btn:bg-accent-brand/20 group-hover/btn:border-accent-brand/40 transition-colors">
                    {renderConnectionIcon(host)}
                  </div>
                  <div className="flex flex-col items-start text-left min-w-0">
                    <span className="text-xs font-semibold truncate w-full">
                      {host.name || host.ip}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate w-full">
                      {getConnectionEndpoint(host)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <>
              {isAdmin && (
                <button
                  onClick={() => onOpenSingletonTab("admin-settings")}
                  className="group/btn flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted transition-colors cursor-pointer border-b border-border flex-1"
                >
                  <div className="size-7 border border-border bg-muted flex items-center justify-center shrink-0 group-hover/btn:bg-accent-brand/20 group-hover/btn:border-accent-brand/40 transition-colors">
                    <Settings className="size-3 text-accent-brand" />
                  </div>
                  <div className="flex flex-col items-start text-left">
                    <span className="text-xs font-semibold">
                      {t("dashboard.adminSettings")}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {t("dashboardTab.manageUsersAndRoles")}
                    </span>
                  </div>
                </button>
              )}
              <button
                onClick={() => onOpenSingletonTab("user-profile")}
                className="group/btn flex items-center gap-2.5 px-4 py-2.5 hover:bg-muted transition-colors cursor-pointer flex-1"
              >
                <div className="size-7 border border-border bg-muted flex items-center justify-center shrink-0 group-hover/btn:bg-accent-brand/20 group-hover/btn:border-accent-brand/40 transition-colors">
                  <User className="size-3 text-accent-brand" />
                </div>
                <div className="flex flex-col items-start text-left">
                  <span className="text-xs font-semibold">
                    {t("dashboard.userProfile")}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {t("dashboardTab.manageYourAccount")}
                  </span>
                </div>
              </button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

export function HostStatusCard({
  hosts,
  onOpenTab,
  statusLoading,
}: {
  hosts: Host[];
  onOpenTab: (host: Host, type: TabType) => void;
  statusLoading?: boolean;
}) {
  const { t } = useTranslation();
  const statusScheme = useStatusColorScheme();
  const online = hosts.filter((h) => h.status === "online").length;
  return (
    <Card className="flex flex-col overflow-hidden w-full h-full py-0 gap-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Database className="size-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
            {t("dashboardTab.hostStatus")}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {online}/{hosts.length}{" "}
          {t("dashboardTab.availableLower", { defaultValue: "Available" })}
        </span>
      </div>
      <div className="flex flex-col overflow-auto flex-1">
        {hosts.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/40 py-8">
            {t("dashboardTab.noHostsConfigured")}
          </div>
        )}
        {hosts.map((host, i) => {
          const availability =
            host.status && host.status !== "unknown"
              ? host.status
              : host.online
                ? "online"
                : "offline";
          return (
            <div
              key={i}
              onClick={() => {
                // An overview action (a metrics view) wins over connecting.
                const actions = hostActionsFor(listHostActions(), host);
                const target =
                  actions.find((action) => action.overview)?.tabType ??
                  defaultConnectAction(actions, host)?.tabType;
                if (target) onOpenTab(host, target);
              }}
              className="flex min-w-0 items-center justify-between px-4 py-2.5 border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer group/row"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span
                  className={`size-1.5 rounded-full shrink-0 ${getStatusClasses(availability, statusScheme, "dot", statusLoading)}`}
                />
                <div className="flex min-w-0 flex-col">
                  <div className="flex min-w-0 items-center gap-1">
                    <span
                      className="truncate text-xs font-semibold"
                      title={host.name}
                    >
                      {host.name}
                    </span>
                    <ExternalLink className="size-2.5 text-muted-foreground/0 group-hover/row:text-muted-foreground/60 transition-colors shrink-0" />
                  </div>
                  <span
                    className="truncate text-[10px] text-muted-foreground font-mono"
                    title={host.ip}
                  >
                    {host.ip}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {/* Plugins such as host metrics show live usage here. */}
                <ComponentSlot
                  slotId="dashboard.hostMetrics"
                  props={{
                    hostId: Number(host.id),
                    online: availability === "online",
                  }}
                />
                <span
                  className={`text-[10px] px-2 py-0.5 font-semibold border ${getStatusClasses(availability, statusScheme, "badge", statusLoading)}`}
                >
                  {statusLoading
                    ? t("dashboardTab.checking")
                    : availability === "online"
                      ? t("dashboardTab.available", {
                          defaultValue: "AVAILABLE",
                        })
                      : availability === "reachable"
                        ? t("dashboardTab.reachable", {
                            defaultValue: "REACHABLE",
                          })
                        : t("dashboardTab.offline")}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function isStatusCheckEnabled(host: Host): boolean {
  return host.statusCheckEnabled !== false;
}

function RecentActivityCard({
  activity,
  hosts,
  onOpenTab,
  onClear,
  statusLoading,
}: {
  activity: RecentActivityItem[];
  hosts: Host[];
  onOpenTab: (host: Host, type: TabType) => void;
  onClear: () => void;
  statusLoading?: boolean;
}) {
  const { t } = useTranslation();
  const statusScheme = useStatusColorScheme();
  const typeIcon = (type: string): React.ReactNode => {
    const Icon = activityTarget(type)?.icon ?? Server;
    return <Icon className="size-2.5" />;
  };
  const typeLabel = (type: string): string => {
    const labelKey = activityTarget(type)?.labelKey;
    return labelKey ? t(labelKey) : type.replace("_", " ");
  };
  function formatTime(ts: string) {
    const diffMs = Date.now() - new Date(ts).getTime();
    if (diffMs < 0) return t("dashboard.justNow");
    const diff = Math.floor(diffMs / 1000);
    if (diff < 60) return t("dashboard.justNow");
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  }
  return (
    <Card className="flex flex-col overflow-hidden w-full h-full py-0 gap-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="size-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
            {t("dashboard.recentActivity")}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-accent-brand h-auto py-0.5 px-2"
          onClick={onClear}
        >
          {t("dashboardTab.clear")}
        </Button>
      </div>
      <div className="flex flex-col overflow-auto flex-1">
        {activity.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/40 py-8">
            {t("dashboard.noRecentActivity")}
          </div>
        )}
        {activity.map((item) => {
          const host = hosts.find((h) => h.id === String(item.hostId));
          return (
            <div
              key={item.id}
              onClick={() => {
                const target = activityTarget(item.type);
                if (host && target) onOpenTab(host, target.tab);
              }}
              className="flex items-center justify-between px-4 py-2 border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`size-1.5 rounded-full shrink-0 ${getStatusClasses(host?.online ?? false, statusScheme, "dot", statusLoading)}`}
                />
                <div className="flex flex-col">
                  <span className="text-xs font-semibold truncate max-w-24">
                    {item.hostName}
                  </span>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    {typeIcon(item.type)}
                    <span className="text-[10px]">{typeLabel(item.type)}</span>
                  </div>
                </div>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {formatTime(item.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── CardItem ─────────────────────────────────────────────────────────────────

function CardItem({
  slot,
  editMode,
  isDragging,
  onDragStart,
  onDrop,
  onDragOver,
  onRemove,
  onHeightChange,
  onOpenSingletonTab,
  onOpenTab,
  hosts,
  uptimeFormatted,
  versionText,
  versionStatus,
  releaseUrl,
  dbHealth,
  credentialCount,
  activeTunnelCount,
  activity,
  onClearActivity,
  isAdmin,
  statusLoading,
  isVisible = true,
}: {
  slot: CardSlot;
  editMode: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDrop: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onRemove: () => void;
  onHeightChange: (key: string, h: number) => void;
  onOpenSingletonTab: (type: TabType, pendingEvent?: string) => void;
  onOpenTab: (host: Host, type: TabType) => void;
  hosts: Host[];
  uptimeFormatted: string;
  versionText: string;
  versionStatus: "up_to_date" | "requires_update" | "beta" | "unknown";
  releaseUrl: string;
  dbHealth: "healthy" | "error";
  credentialCount: number;
  activeTunnelCount: number;
  activity: RecentActivityItem[];
  onClearActivity: () => void;
  isAdmin: boolean;
  statusLoading?: boolean;
  isVisible?: boolean;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const startH = cardRef.current?.getBoundingClientRect().height ?? 100;
      const onMove = (ev: MouseEvent) => {
        onHeightChange(slot.key, Math.max(50, startH + (ev.clientY - startY)));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [slot.key, onHeightChange],
  );

  const isFlex = slot.height === null;

  return (
    <div
      ref={cardRef}
      className={`relative flex flex-col transition-opacity select-none ${isDragging ? "opacity-40" : "opacity-100"} ${isFlex ? "flex-1 min-h-0" : "shrink-0"}`}
      style={!isFlex ? { height: slot.height } : undefined}
      draggable={editMode}
      onDragStart={onDragStart}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      {editMode && (
        <div className="absolute inset-0 z-10 pointer-events-none border-2 border-dashed border-accent-brand/30" />
      )}
      {editMode && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
          <div className="size-6 bg-card border border-border flex items-center justify-center cursor-grab active:cursor-grabbing pointer-events-auto">
            <GripVertical className="size-3 text-muted-foreground" />
          </div>
          <button
            onClick={onRemove}
            className="size-6 bg-card border border-border flex items-center justify-center hover:bg-destructive/10 hover:border-destructive/40 transition-colors pointer-events-auto"
          >
            <Trash2 className="size-3 text-muted-foreground" />
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        {slot.id === "stats_bar" && (
          <StatsBarCard
            hosts={hosts}
            uptimeFormatted={uptimeFormatted}
            versionText={versionText}
            versionStatus={versionStatus}
            releaseUrl={releaseUrl}
            dbHealth={dbHealth}
          />
        )}
        {slot.id === "counters_bar" && (
          <CountersBarCard
            hosts={hosts}
            credentialCount={credentialCount}
            activeTunnelCount={activeTunnelCount}
            onOpenSingletonTab={onOpenSingletonTab}
          />
        )}
        {slot.id === "quick_actions" && (
          <QuickActionsCard
            onOpenSingletonTab={onOpenSingletonTab}
            hosts={hosts}
            onOpenTab={onOpenTab}
            isAdmin={isAdmin}
          />
        )}
        {slot.id === "host_status" && (
          <HostStatusCard
            hosts={hosts}
            onOpenTab={onOpenTab}
            statusLoading={statusLoading}
          />
        )}
        {slot.id === "recent_activity" && (
          <RecentActivityCard
            activity={activity}
            hosts={hosts}
            onOpenTab={onOpenTab}
            onClear={onClearActivity}
            statusLoading={statusLoading}
          />
        )}
        {!CORE_CARD_IDS.has(slot.id) && (
          <PluginCardSlot
            id={slot.id}
            isVisible={isVisible}
            onOpenSingletonTab={onOpenSingletonTab}
          />
        )}
      </div>
      {editMode && !isFlex && (
        <div
          onMouseDown={onResizeMouseDown}
          className="absolute bottom-0 left-0 right-0 h-2 z-20 flex items-center justify-center cursor-row-resize group/resize"
          title="Drag to resize"
        >
          <div className="w-12 h-0.5 bg-border group-hover/resize:bg-accent-brand/60 transition-colors rounded-full" />
        </div>
      )}
    </div>
  );
}

// ─── DropZone ─────────────────────────────────────────────────────────────────

function DropZone({
  panel,
  order,
  onDrop,
  onDragOver,
  active,
}: {
  panel: PanelId;
  order: number;
  onDrop: (panel: PanelId, order: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  active: boolean;
}) {
  const [over, setOver] = useState(false);
  if (!active) return null;
  return (
    <div
      className={`shrink-0 transition-all duration-150 ${over ? "h-10 border-2 border-dashed border-accent-brand/60 bg-accent-brand/5" : "h-2"}`}
      onDragOver={(e) => {
        onDragOver(e);
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={() => {
        setOver(false);
        onDrop(panel, order);
      }}
    />
  );
}

// ─── AddCardTray ──────────────────────────────────────────────────────────────

function AddCardTray({
  activeIds,
  onAdd,
  cardLabels,
}: {
  activeIds: string[];
  onAdd: (id: string) => void;
  cardLabels: Record<string, string>;
}) {
  const { t } = useTranslation();
  const registeredCards = useRegisteredDashboardCards();
  const available = [
    ...DASHBOARD_CARDS.map((card) => ({ id: card.id as string })),
    ...registeredCards.map((card) => ({ id: card.id })),
  ].filter((c) => !activeIds.includes(c.id));
  if (available.length === 0) return null;
  return (
    <div className="flex items-center gap-2 px-1 py-2 flex-wrap shrink-0">
      <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold shrink-0">
        {t("dashboardTab.add")}
      </span>
      {available.map((card) => (
        <button
          key={card.id}
          onClick={() => onAdd(card.id)}
          className="flex items-center gap-1.5 px-2.5 py-1 border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-accent-brand/60 hover:bg-accent-brand/5 transition-colors"
        >
          <Plus className="size-3 text-accent-brand" />
          {cardLabels[card.id]}
        </button>
      ))}
    </div>
  );
}

// ─── PanelColumn ─────────────────────────────────────────────────────────────

type PanelColumnProps = {
  panel: PanelId;
  slots: CardSlot[];
  editMode: boolean;
  dragState: DragState;
  onDragStart: (slot: CardSlot) => void;
  onDrop: (targetPanel: PanelId, targetOrder: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onRemove: (key: string) => void;
  onAdd: (id: DashboardCardId, panel: PanelId) => void;
  onHeightChange: (key: string, h: number) => void;
  onOpenSingletonTab: (type: TabType, pendingEvent?: string) => void;
  onOpenTab: (host: Host, type: TabType) => void;
  hosts: Host[];
  uptimeFormatted: string;
  versionText: string;
  versionStatus: "up_to_date" | "requires_update" | "beta" | "unknown";
  releaseUrl: string;
  dbHealth: "healthy" | "error";
  credentialCount: number;
  activeTunnelCount: number;
  activity: RecentActivityItem[];
  onClearActivity: () => void;
  cardLabels: Record<DashboardCardId, string>;
  isAdmin: boolean;
  statusLoading: boolean;
  isVisible?: boolean;
};

function PanelColumn({
  panel,
  slots,
  editMode,
  dragState,
  onDragStart,
  onDrop,
  onDragOver,
  onRemove,
  onAdd,
  onHeightChange,
  onOpenSingletonTab,
  onOpenTab,
  hosts,
  uptimeFormatted,
  versionText,
  versionStatus,
  releaseUrl,
  dbHealth,
  credentialCount,
  activeTunnelCount,
  activity,
  onClearActivity,
  cardLabels,
  isAdmin,
  statusLoading,
  isVisible = true,
}: PanelColumnProps) {
  const { t } = useTranslation();
  const sorted = [...slots].sort((a, b) => a.order - b.order);
  const allIds = slots.map((s) => s.id);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <DropZone
        panel={panel}
        order={-1}
        onDrop={onDrop}
        onDragOver={onDragOver}
        active={!!dragState}
      />
      {sorted.map((slot, idx) => (
        <div
          key={slot.key}
          className={`flex flex-col min-h-0 ${slot.height === null ? "flex-1" : "shrink-0"}`}
        >
          {idx > 0 && (
            <div className={editMode ? "" : "h-4 shrink-0"}>
              <DropZone
                panel={panel}
                order={slot.order - 0.5}
                onDrop={onDrop}
                onDragOver={onDragOver}
                active={!!dragState}
              />
            </div>
          )}
          <CardItem
            slot={slot}
            editMode={editMode}
            isDragging={dragState?.key === slot.key}
            onDragStart={() => onDragStart(slot)}
            onDrop={() => onDrop(slot.panel, slot.order)}
            onDragOver={onDragOver}
            onRemove={() => onRemove(slot.key)}
            onHeightChange={onHeightChange}
            onOpenSingletonTab={onOpenSingletonTab}
            onOpenTab={onOpenTab}
            hosts={hosts}
            uptimeFormatted={uptimeFormatted}
            versionText={versionText}
            versionStatus={versionStatus}
            releaseUrl={releaseUrl}
            dbHealth={dbHealth}
            credentialCount={credentialCount}
            activeTunnelCount={activeTunnelCount}
            activity={activity}
            onClearActivity={onClearActivity}
            isAdmin={isAdmin}
            statusLoading={statusLoading}
            isVisible={isVisible}
          />
        </div>
      ))}
      <DropZone
        panel={panel}
        order={sorted.length}
        onDrop={onDrop}
        onDragOver={onDragOver}
        active={!!dragState}
      />
      {editMode && (
        <AddCardTray
          activeIds={allIds}
          onAdd={(id) => onAdd(id, panel)}
          cardLabels={cardLabels}
        />
      )}
      {sorted.length === 0 && !editMode && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground/20 text-xs border border-dashed border-border/30">
          {t("dashboardTab.empty")}
        </div>
      )}
    </div>
  );
}

function ColumnDivider({
  onMouseDown,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="w-3 shrink-0 flex items-center justify-center cursor-col-resize group/divider self-stretch z-10"
      title="Drag to resize columns"
    >
      <div className="w-px h-full bg-border group-hover/divider:bg-accent-brand/50 transition-colors" />
      <div className="absolute size-4 flex items-center justify-center opacity-0 group-hover/divider:opacity-100 transition-opacity">
        <GripHorizontal className="size-3 text-accent-brand" />
      </div>
    </div>
  );
}

// ─── DashboardTab ─────────────────────────────────────────────────────────────

export function DashboardTab({
  onOpenSingletonTab,
  onOpenTab,
  isVisible = true,
}: {
  onOpenSingletonTab: (type: TabType, pendingEvent?: string) => void;
  onOpenTab: (host: Host, type: TabType) => void;
  /** When false, pause dashboard metrics refresh while the tab stays mounted. */
  isVisible?: boolean;
}) {
  const registeredCards = useRegisteredDashboardCards();
  const { t, i18n } = useTranslation();
  const { initialLoadComplete } = useServerStatus();
  const statusLoading = !initialLoadComplete;

  const [slots, setSlots] = useState<CardSlot[]>(() => {
    try {
      const saved = localStorage.getItem("dashboardTab.slots");
      if (saved) {
        const parsed = JSON.parse(saved) as CardSlot[];
        return parsed.map((s, i) => ({ key: s.key ?? `${s.id}_${i}`, ...s }));
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_SLOTS;
  });

  // Picking an interface preset rewrites the stored layout from the settings
  // panel, so pick it up without waiting for a remount.
  useEffect(() => {
    const handler = () => {
      try {
        const saved = localStorage.getItem("dashboardTab.slots");
        if (!saved) return;
        const parsed = JSON.parse(saved) as CardSlot[];
        setSlots(
          parsed.map((s, i) => ({ key: s.key ?? `${s.id}_${i}`, ...s })),
        );
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("dashboardSlotsChanged", handler);
    return () => window.removeEventListener("dashboardSlotsChanged", handler);
  }, []);

  // A plugin's own view next to the dashboard, e.g. the homepage plugin's
  // canvas preview. Only one is offered today; "dashboard" always exists.
  const secondaryViews = useActionSlot("dashboard.secondaryView");
  const secondaryView = secondaryViews[0];

  const [dashboardView, setDashboardView] = useState<string>(() => {
    try {
      return localStorage.getItem("dashboardView") ?? "dashboard";
    } catch {
      return "dashboard";
    }
  });
  // Falls back to the dashboard when the view a plugin contributed is off.
  const isDashboardView =
    dashboardView === "dashboard" ||
    !secondaryView ||
    dashboardView !== secondaryView.actionId;

  useEffect(() => {
    try {
      localStorage.setItem("dashboardView", dashboardView);
    } catch {
      /* ignore */
    }
  }, [dashboardView]);

  const [editMode, setEditMode] = useState(false);
  const [dragState, setDragState] = useState<DragState>(null);

  const [mainWidthPct, setMainWidthPct] = useState(() => {
    try {
      const saved = localStorage.getItem("dashboardTab.mainWidthPct");
      if (saved) return Number(saved);
    } catch {
      /* ignore */
    }
    return 68;
  });

  useEffect(() => {
    try {
      localStorage.setItem("dashboardTab.slots", JSON.stringify(slots));
    } catch {
      /* ignore */
    }
  }, [slots]);

  useEffect(() => {
    try {
      localStorage.setItem("dashboardTab.mainWidthPct", String(mainWidthPct));
    } catch {
      /* ignore */
    }
  }, [mainWidthPct]);

  const [hosts, setHosts] = useState<Host[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [uptimeFormatted, setUptimeFormatted] = useState("");
  const [versionText, setVersionText] = useState("");
  const [versionStatus, setVersionStatus] = useState<
    "up_to_date" | "requires_update" | "beta" | "unknown"
  >("up_to_date");
  const [releaseUrl, setReleaseUrl] = useState("");
  const [dbHealth, setDbHealth] = useState<"healthy" | "error">("healthy");
  const [credentialCount, setCredentialCount] = useState(0);
  const [activeTunnelCount, setActiveTunnelCount] = useState(0);
  const [activity, setActivity] = useState<RecentActivityItem[]>([]);
  const statusCheckHosts = hosts.filter(isStatusCheckEnabled);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const raw = await getSSHHosts().catch(() => []);
      if (mounted) setHosts(raw.map(sshHostToHost));
    };
    load();

    getUserInfo()
      .then((info) => {
        // Remote sync is not yet configurable (added in a later phase), so
        // a standalone desktop install never shows admin/user-management
        // UI -- it has exactly one implicit user and nothing to administer.
        const isRemoteSyncConnected = false;
        setIsAdmin(!!info.is_admin && (!isElectron() || isRemoteSyncConnected));
      })
      .catch(() => {});
    getUptime()
      .then((u) => setUptimeFormatted(u.formatted))
      .catch(() => {});
    getVersionInfo()
      .then((info) => {
        setVersionText(info.localVersion ?? "");
        setVersionStatus(info.status ?? "unknown");
        setReleaseUrl(releaseUrlFrom(info));
      })
      .catch(() => {});
    getDatabaseHealth()
      .then((health) => {
        setDbHealth(
          health.status === "ok" || health.status === "healthy"
            ? "healthy"
            : "error",
        );
      })
      .catch(() => {
        setDbHealth("error");
      });
    getRecentActivity(50)
      .then(setActivity)
      .catch(() => {});
    getCredentials()
      .then((res) =>
        setCredentialCount(
          Array.isArray(res)
            ? res.length
            : Array.isArray(res?.credentials)
              ? res.credentials.length
              : 0,
        ),
      )
      .catch(() => {});
    // Undefined while the tunnels plugin is off, which reads as zero.
    invokeAction("tunnels.statuses")
      .then((statuses) => {
        const active = Object.values(
          (statuses ?? {}) as Record<string, { status?: string }>,
        ).filter((s) => s?.status === CONNECTION_STATES.CONNECTED).length;
        setActiveTunnelCount(active);
      })
      .catch(() => {});

    if (!isVisible) {
      return () => {
        mounted = false;
      };
    }

    const hostsInterval = setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      const raw = await getSSHHosts().catch(() => []);
      if (mounted) setHosts(raw.map(sshHostToHost));
    }, 30000);

    return () => {
      mounted = false;
      clearInterval(hostsInterval);
    };
  }, [isVisible]);

  const handleClearActivity = async () => {
    try {
      await resetRecentActivity();
      setActivity([]);
    } catch {
      /* ignore */
    }
  };

  const todayLabel = new Date().toLocaleDateString(i18n.language, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const mainSlots = slots
    .filter((s) => s.panel === "main")
    .sort((a, b) => a.order - b.order);
  const sideSlots = slots
    .filter((s) => s.panel === "side")
    .sort((a, b) => a.order - b.order);
  const hasSide = sideSlots.length > 0;

  const cardLabels: Record<string, string> = {
    stats_bar: t("dashboard.serverOverview"),
    counters_bar: t("dashboard.serverStats"),
    quick_actions: t("dashboard.quickActions"),
    host_status: t("dashboardTab.hostStatus"),
    recent_activity: t("dashboard.recentActivity"),
    ...Object.fromEntries(
      registeredCards.map((card) => [card.id, t(card.titleKey)]),
    ),
  };

  const onColumnDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startPct = mainWidthPct;
      const onMove = (ev: MouseEvent) => {
        if (!bodyRef.current) return;
        const totalW = bodyRef.current.getBoundingClientRect().width;
        setMainWidthPct(
          Math.min(
            85,
            Math.max(25, startPct + ((ev.clientX - startX) / totalW) * 100),
          ),
        );
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [mainWidthPct],
  );

  const handleDragStart = (slot: CardSlot) =>
    setDragState({
      key: slot.key,
      id: slot.id,
      sourcePanel: slot.panel,
      sourceOrder: slot.order,
    });
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (targetPanel: PanelId, targetOrder: number) => {
    if (!dragState) return;
    setSlots((prev) => {
      const without = prev.filter((s) => s.key !== dragState.key);
      const panelSlots = without
        .filter((s) => s.panel === targetPanel)
        .sort((a, b) => a.order - b.order);
      const others = without.filter((s) => s.panel !== targetPanel);
      const insertIdx = panelSlots.findIndex((s) => s.order > targetOrder);
      const insertAt = insertIdx === -1 ? panelSlots.length : insertIdx;
      const newPanelSlots = [
        ...panelSlots.slice(0, insertAt),
        {
          key: dragState.key,
          id: dragState.id,
          panel: targetPanel,
          order: 0,
          height: prev.find((s) => s.key === dragState.key)?.height ?? null,
        },
        ...panelSlots.slice(insertAt),
      ].map((s, i) => ({ ...s, order: i }));
      return [...others, ...newPanelSlots];
    });
    setDragState(null);
  };
  const handleRemove = (key: string) =>
    setSlots((prev) => prev.filter((s) => s.key !== key));
  const handleAdd = (id: DashboardCardId, panel: PanelId) => {
    setSlots((prev) => {
      const panelSlots = prev.filter((s) => s.panel === panel);
      const maxOrder =
        panelSlots.length > 0
          ? Math.max(...panelSlots.map((s) => s.order)) + 1
          : 0;
      const defaultHeight: number | null =
        getRegisteredDashboardCard(id)?.defaultHeight ??
        (id === "host_status" || id === "recent_activity" ? null : 150);
      const key = `${id}_${Date.now()}`;
      return [
        ...prev,
        { key, id, panel, order: maxOrder, height: defaultHeight },
      ];
    });
  };
  const handleHeightChange = (key: string, h: number) =>
    setSlots((prev) =>
      prev.map((s) => (s.key === key ? { ...s, height: h } : s)),
    );
  const handleReset = () => {
    setSlots(DEFAULT_SLOTS);
    setMainWidthPct(68);
    setEditMode(false);
    try {
      localStorage.removeItem("dashboardTab.slots");
      localStorage.removeItem("dashboardTab.mainWidthPct");
    } catch {
      /* ignore */
    }
  };

  const columnProps = {
    hosts,
    uptimeFormatted,
    versionText,
    versionStatus,
    releaseUrl,
    dbHealth,
    credentialCount,
    activeTunnelCount,
    activity,
    onClearActivity: handleClearActivity,
    onOpenSingletonTab,
    onOpenTab,
    cardLabels,
    isAdmin,
    statusLoading,
    isVisible,
  };

  const isMobile = useIsMobile();

  if (isMobile) {
    const allSlots = [...mainSlots, ...sideSlots];
    return (
      <div className="flex flex-col w-full h-full min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 pt-3 flex flex-col gap-3">
          <Card className="flex-row items-center justify-between px-4 py-3 shrink-0 gap-0">
            <div>
              <h1 className="text-base font-bold leading-tight">
                {t("dashboard.title")}
              </h1>
              <p className="text-xs text-muted-foreground">{todayLabel}</p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground"
                asChild
              >
                <a
                  href="https://github.com/Termix-SSH/Termix"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("dashboard.github")}
                </a>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground"
                asChild
              >
                <a
                  href="https://github.com/Termix-SSH/Support"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("dashboard.support")}
                </a>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground"
                asChild
              >
                <a
                  href="https://discord.com/invite/jVQGdvHDrf"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("dashboard.discord")}
                </a>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground"
                asChild
              >
                <a
                  href="https://docs.termix.site/"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("dashboard.docs")}
                </a>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground"
                asChild
              >
                <a
                  href="https://donate.termix.site/"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("dashboard.donate")}
                </a>
              </Button>
            </div>
          </Card>
          {allSlots.map((slot) => (
            <div
              key={slot.id}
              className={`shrink-0 ${slot.id === "host_status" || slot.id === "recent_activity" ? "max-h-72 flex flex-col overflow-hidden" : ""}`}
            >
              {slot.id === "stats_bar" && (
                <StatsBarCard
                  hosts={hosts}
                  uptimeFormatted={uptimeFormatted}
                  versionText={versionText}
                  versionStatus={versionStatus}
                  releaseUrl={releaseUrl}
                  dbHealth={dbHealth}
                />
              )}
              {slot.id === "counters_bar" && (
                <CountersBarCard
                  hosts={hosts}
                  credentialCount={credentialCount}
                  activeTunnelCount={activeTunnelCount}
                  onOpenSingletonTab={onOpenSingletonTab}
                />
              )}
              {slot.id === "quick_actions" && (
                <QuickActionsCard
                  onOpenSingletonTab={onOpenSingletonTab}
                  hosts={hosts}
                  onOpenTab={onOpenTab}
                  isAdmin={isAdmin}
                />
              )}
              {slot.id === "host_status" && (
                <HostStatusCard
                  hosts={statusCheckHosts}
                  onOpenTab={onOpenTab}
                  statusLoading={statusLoading}
                />
              )}
              {slot.id === "recent_activity" && (
                <RecentActivityCard
                  activity={activity}
                  hosts={hosts}
                  onOpenTab={onOpenTab}
                  onClear={handleClearActivity}
                  statusLoading={statusLoading}
                />
              )}
              {!CORE_CARD_IDS.has(slot.id) && (
                <PluginCardSlot
                  id={slot.id}
                  isVisible={isVisible}
                  onOpenSingletonTab={onOpenSingletonTab}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full min-h-0 overflow-hidden">
      <Card className="flex-row items-center justify-between px-5 py-3 shrink-0 mx-5 mt-5 gap-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0 bg-muted/40 border border-border p-0.5">
            <button
              onClick={() => setDashboardView("dashboard")}
              className={`px-3 py-1 text-sm font-medium transition-colors ${isDashboardView ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("dashboard.title")}
            </button>
            {secondaryView && (
              <button
                onClick={() => setDashboardView(secondaryView.actionId)}
                className={`px-3 py-1 text-sm font-medium transition-colors ${!isDashboardView ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t(secondaryView.titleKey)}
              </button>
            )}
          </div>
          {isDashboardView && (
            <p className="text-xs text-muted-foreground hidden sm:block">
              {todayLabel}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <div className="hidden sm:flex items-center gap-2 mr-2 bg-muted/50 px-2.5 py-1 rounded-none border border-border">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {t("dashboardTab.commandPalette")}
            </span>
            <div className="flex items-center gap-1">
              <Kbd className="h-5 px-1.5 bg-background text-[10px]">Shift</Kbd>
              <span className="text-[10px] text-muted-foreground">+</span>
              <Kbd className="h-5 px-1.5 bg-background text-[10px]">Shift</Kbd>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            asChild
          >
            <a
              href="https://github.com/Termix-SSH/Termix"
              target="_blank"
              rel="noreferrer"
            >
              {t("dashboard.github")}
            </a>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            asChild
          >
            <a
              href="https://github.com/Termix-SSH/Support"
              target="_blank"
              rel="noreferrer"
            >
              {t("dashboard.support")}
            </a>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            asChild
          >
            <a
              href="https://discord.com/invite/jVQGdvHDrf"
              target="_blank"
              rel="noreferrer"
            >
              {t("dashboard.discord")}
            </a>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            asChild
          >
            <a
              href="https://docs.termix.site/"
              target="_blank"
              rel="noreferrer"
            >
              {t("dashboard.docs")}
            </a>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            asChild
          >
            <a
              href="https://donate.termix.site/"
              target="_blank"
              rel="noreferrer"
            >
              {t("dashboard.donate")}
            </a>
          </Button>
          {isDashboardView && (
            <>
              <Separator orientation="vertical" className="mx-1 h-5" />
              {editMode ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground"
                    onClick={handleReset}
                  >
                    {t("dashboard.reset")}
                  </Button>
                  <Button
                    size="sm"
                    className="text-xs bg-accent-brand hover:bg-accent-brand/90 text-white"
                    onClick={() => setEditMode(false)}
                  >
                    {t("dashboardTab.done")}
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditMode(true)}
                  title={t("dashboard.customizeLayout")}
                >
                  <LayoutDashboard className="size-4 text-accent-brand" />
                </Button>
              )}
            </>
          )}
        </div>
      </Card>

      {!isDashboardView && secondaryView?.component ? (
        <div className="flex-1 min-h-0 overflow-hidden mx-5 mb-5 mt-4 border border-border flex flex-col">
          <secondaryView.component onOpenSingletonTab={onOpenSingletonTab} />
        </div>
      ) : (
        <>
          {editMode && (
            <div className="mx-5 mt-4 px-4 py-2 border border-dashed border-accent-brand/40 bg-accent-brand/5 shrink-0 flex items-center gap-2">
              <LayoutDashboard className="size-3.5 text-accent-brand shrink-0" />
              <span className="text-xs text-accent-brand font-semibold">
                {t("dashboardTab.editModeInstructions")}
              </span>
            </div>
          )}

          <div
            ref={bodyRef}
            className="flex flex-row flex-1 min-h-0 px-5 pb-5 pt-4 overflow-hidden"
          >
            <div
              className="flex flex-col min-h-0"
              style={{
                width: hasSide || editMode ? `${mainWidthPct}%` : "100%",
              }}
            >
              <PanelColumn
                panel="main"
                slots={mainSlots}
                editMode={editMode}
                dragState={dragState}
                onDragStart={handleDragStart}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onRemove={handleRemove}
                onAdd={handleAdd}
                onHeightChange={handleHeightChange}
                {...columnProps}
              />
            </div>

            {(hasSide || editMode) &&
              (editMode ? (
                <ColumnDivider onMouseDown={onColumnDividerMouseDown} />
              ) : (
                <div className="w-4 shrink-0" />
              ))}

            {(hasSide || editMode) && (
              <div className="flex flex-col min-h-0 flex-1">
                <PanelColumn
                  panel="side"
                  slots={sideSlots}
                  editMode={editMode}
                  dragState={dragState}
                  onDragStart={handleDragStart}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onRemove={handleRemove}
                  onAdd={handleAdd}
                  onHeightChange={handleHeightChange}
                  {...columnProps}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
