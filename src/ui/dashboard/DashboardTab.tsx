import { useState, useRef, useCallback, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { Separator } from "@/components/separator";
import {
  Activity,
  Database,
  GripHorizontal,
  GripVertical,
  KeyRound,
  LayoutDashboard,
  MessagesSquare,
  Network,
  Plus,
  Server,
  Settings,
  Terminal,
  Trash2,
  User,
  Zap,
} from "lucide-react";
import { Kbd } from "@/components/kbd";
import { DASHBOARD_CARDS } from "@/lib/theme";
import type { DashboardCardId, TabType, Host } from "@/types/ui-types";
import {
  getSSHHosts,
  getUptime,
  getVersionInfo,
  getDatabaseHealth,
  getRecentActivity,
  getTunnelStatuses,
  getCredentials,
  resetRecentActivity,
  getAllServerStatuses,
  getServerMetricsById,
  registerMetricsViewer,
  sendMetricsHeartbeat,
  getUserInfo,
} from "@/main-axios";
import type { RecentActivityItem, SSHHostWithStatus } from "@/main-axios";
import { useTranslation } from "react-i18next";
import { NetworkGraphCard } from "@/dashboard/cards/NetworkGraphCard";

function sshHostToHost(h: SSHHostWithStatus): Host {
  return {
    id: String(h.id),
    name: h.name,
    username: h.username,
    ip: h.ip,
    port: h.port,
    folder: h.folder ?? "",
    online: h.status === "online",
    cpu: 0,
    ram: 0,
    lastAccess: "",
    tags: h.tags ?? [],
    authType: h.authType,
    password: h.password,
    key: typeof h.key === "string" ? h.key : undefined,
    keyPassword: h.keyPassword,
    keyType: h.keyType,
    credentialId: h.credentialId != null ? String(h.credentialId) : undefined,
    notes: h.notes,
    pin: h.pin ?? false,
    macAddress: h.macAddress,
    enableTerminal: h.enableTerminal ?? true,
    enableTunnel: h.enableTunnel ?? false,
    enableFileManager: h.enableFileManager ?? false,
    enableDocker: h.enableDocker ?? false,
    enableSsh: h.connectionType === "ssh" || !h.connectionType,
    enableRdp: h.connectionType === "rdp",
    enableVnc: h.connectionType === "vnc",
    enableTelnet: h.connectionType === "telnet",
    sshPort: h.port,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
    quickActions: (h.quickActions ?? []).map((a) => ({
      name: a.name,
      snippetId: String(a.snippetId),
    })),
    serverTunnels: [],
    defaultPath: h.defaultPath,
    terminalConfig: h.terminalConfig as Host["terminalConfig"],
    useSocks5: h.useSocks5,
    socks5Host: h.socks5Host,
    socks5Port: h.socks5Port,
    socks5Username: h.socks5Username,
    socks5Password: h.socks5Password,
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

type PanelId = "main" | "side";

type CardSlot = {
  id: DashboardCardId;
  panel: PanelId;
  order: number;
  height: number | null;
};

type DragState = {
  id: DashboardCardId;
  sourcePanel: PanelId;
  sourceOrder: number;
} | null;

// ─── Default layout ───────────────────────────────────────────────────────────

const DEFAULT_SLOTS: CardSlot[] = [
  { id: "stats_bar", panel: "main", order: 0, height: 96 },
  { id: "counters_bar", panel: "main", order: 1, height: 48 },
  { id: "quick_actions", panel: "main", order: 2, height: 160 },
  { id: "host_status", panel: "main", order: 3, height: null },
  { id: "recent_activity", panel: "side", order: 0, height: null },
];

// ─── useColumnResize ──────────────────────────────────────────────────────────

function useColumnResize(
  containerRef: React.RefObject<HTMLDivElement | null>,
  mainWidthPct: number,
  setMainWidthPct: (v: number) => void,
) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startPct = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startPct.current = mainWidthPct;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current || !containerRef.current) return;
        const totalW = containerRef.current.getBoundingClientRect().width;
        const delta = ev.clientX - startX.current;
        const newPct = Math.min(
          85,
          Math.max(30, startPct.current + (delta / totalW) * 100),
        );
        setMainWidthPct(newPct);
      };
      const onUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [containerRef, mainWidthPct, setMainWidthPct],
  );

  return onMouseDown;
}

// ─── Card components ──────────────────────────────────────────────────────────

function StatsBarCard({
  hosts,
  uptimeFormatted,
  versionText,
  versionStatus,
  dbHealth,
}: {
  hosts: Host[];
  uptimeFormatted: string;
  versionText: string;
  versionStatus: "up_to_date" | "requires_update" | "beta";
  dbHealth: "healthy" | "error";
}) {
  const { t } = useTranslation();
  const online = hosts.filter((h) => h.online).length;
  const statusLabel =
    versionStatus === "beta"
      ? t("dashboard.beta").toUpperCase()
      : versionStatus === "requires_update"
        ? t("dashboard.updateAvailable").toUpperCase()
        : t("dashboardTab.stable");
  const statusColor =
    versionStatus === "beta"
      ? "bg-blue-500/20 text-blue-400"
      : versionStatus === "requires_update"
        ? "bg-yellow-500/20 text-yellow-400"
        : "bg-accent-brand/20 text-accent-brand";
  return (
    <Card className="grid grid-cols-4 divide-x divide-border overflow-hidden w-full h-full py-0 gap-0">
      <div className="flex flex-col justify-center px-4 py-2 gap-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
          {t("dashboard.version")}
        </span>
        <span className="text-xl font-bold text-accent-brand leading-none">
          {versionText || "—"}
        </span>
        <span
          className={`text-[10px] px-1.5 py-0.5 w-fit font-semibold leading-none ${statusColor}`}
        >
          {statusLabel}
        </span>
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
          {t("dashboardTab.hostsOnline")}
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
}: {
  hosts: Host[];
  credentialCount: number;
  activeTunnelCount: number;
}) {
  const { t } = useTranslation();
  return (
    <Card className="grid grid-cols-3 divide-x divide-border overflow-hidden w-full h-full py-0 gap-0">
      <div className="flex items-center gap-2.5 px-4 py-2.5">
        <Server className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-base font-bold">{hosts.length}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
          {t("dashboard.totalHosts")}
        </span>
      </div>
      <div className="flex items-center gap-2.5 px-4 py-2.5">
        <KeyRound className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-base font-bold">{credentialCount}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
          {t("dashboard.totalCredentials")}
        </span>
      </div>
      <div className="flex items-center gap-2.5 px-4 py-2.5">
        <Network className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-base font-bold">{activeTunnelCount}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
          {t("dashboardTab.activeTunnels")}
        </span>
      </div>
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
                  onClick={() => onOpenTab(host, "terminal")}
                  className="group/btn flex items-center gap-2.5 px-4 py-2 hover:bg-muted transition-colors cursor-pointer border-b border-border last:border-b-0"
                >
                  <div className="size-7 border border-border bg-muted flex items-center justify-center shrink-0 group-hover/btn:bg-accent-brand/20 group-hover/btn:border-accent-brand/40 transition-colors">
                    <Terminal className="size-3 text-accent-brand" />
                  </div>
                  <div className="flex flex-col items-start text-left min-w-0">
                    <span className="text-xs font-semibold truncate w-full">
                      {host.name || host.ip}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate w-full">
                      {host.ip}:{host.sshPort}
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

function HostStatusCard({
  hosts,
  hostMetrics,
  onOpenTab,
}: {
  hosts: Host[];
  hostMetrics: Map<string, { cpu: number | null; ram: number | null }>;
  onOpenTab: (host: Host, type: TabType) => void;
}) {
  const { t } = useTranslation();
  const online = hosts.filter((h) => h.online).length;
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
          {online}/{hosts.length} {t("dashboardTab.onlineLower")}
        </span>
      </div>
      <div className="flex flex-col overflow-auto flex-1">
        {hosts.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/40 py-8">
            {t("dashboardTab.noHostsConfigured")}
          </div>
        )}
        {hosts.map((host, i) => {
          const metrics = hostMetrics.get(host.id);
          const cpu = metrics?.cpu ?? null;
          const ram = metrics?.ram ?? null;
          const hasMetrics = cpu !== null || ram !== null;
          return (
            <div
              key={i}
              onClick={() => onOpenTab(host, "stats")}
              className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`size-1.5 rounded-full shrink-0 ${host.online ? "bg-accent-brand" : "bg-muted-foreground/40"}`}
                />
                <div className="flex flex-col">
                  <span className="text-xs font-semibold">{host.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {host.ip}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {host.online && hasMetrics ? (
                  <div className="flex items-center gap-3">
                    {cpu !== null && (
                      <div className="flex flex-col gap-0.5 w-16">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">
                            {t("dashboard.cpu")}
                          </span>
                          <span className="text-[10px] font-bold text-accent-brand">
                            {cpu.toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-0.5 bg-muted w-full">
                          <div
                            className="h-full bg-accent-brand"
                            style={{ width: `${cpu}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {ram !== null && (
                      <div className="flex flex-col gap-0.5 w-16">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground">
                            {t("dashboard.ram")}
                          </span>
                          <span className="text-[10px] font-bold text-accent-brand">
                            {ram.toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-0.5 bg-muted w-full">
                          <div
                            className="h-full bg-accent-brand"
                            style={{ width: `${ram}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-muted-foreground w-16 text-center">
                      —
                    </span>
                    <span className="text-[10px] text-muted-foreground w-16 text-center">
                      —
                    </span>
                  </div>
                )}
                <span
                  className={`text-[10px] px-2 py-0.5 font-semibold border ${host.online ? "border-accent-brand/40 text-accent-brand bg-accent-brand/10" : "border-border text-muted-foreground"}`}
                >
                  {host.online
                    ? t("dashboardTab.online")
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

function RecentActivityCard({
  activity,
  hosts,
  onOpenTab,
  onClear,
}: {
  activity: RecentActivityItem[];
  hosts: Host[];
  onOpenTab: (host: Host, type: TabType) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const typeIcon: Record<RecentActivityItem["type"], React.ReactNode> = {
    terminal: <Terminal className="size-2.5" />,
    file_manager: <Server className="size-2.5" />,
    server_stats: <Activity className="size-2.5" />,
    tunnel: <Network className="size-2.5" />,
    docker: <Server className="size-2.5" />,
    rdp: <Server className="size-2.5" />,
    vnc: <Server className="size-2.5" />,
    telnet: <MessagesSquare className="size-2.5" />,
  };
  const typeToTab: Record<RecentActivityItem["type"], TabType> = {
    terminal: "terminal",
    file_manager: "files",
    server_stats: "stats",
    tunnel: "tunnel",
    docker: "docker",
    rdp: "rdp",
    vnc: "vnc",
    telnet: "telnet",
  };
  const typeLabel: Record<RecentActivityItem["type"], string> = {
    terminal: t("networkGraph.terminal"),
    file_manager: t("networkGraph.fileManager"),
    server_stats: t("networkGraph.serverStats"),
    tunnel: t("networkGraph.tunnel"),
    docker: t("networkGraph.docker"),
    rdp: "RDP",
    vnc: "VNC",
    telnet: "Telnet",
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
                if (host) onOpenTab(host, typeToTab[item.type]);
              }}
              className="flex items-center justify-between px-4 py-2 border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`size-1.5 rounded-full shrink-0 ${host?.online ? "bg-accent-brand" : "bg-muted-foreground/40"}`}
                />
                <div className="flex flex-col">
                  <span className="text-xs font-semibold truncate max-w-24">
                    {item.hostName}
                  </span>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    {typeIcon[item.type]}
                    <span className="text-[10px]">{typeLabel[item.type]}</span>
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
  hostMetrics,
  uptimeFormatted,
  versionText,
  versionStatus,
  dbHealth,
  credentialCount,
  activeTunnelCount,
  activity,
  onClearActivity,
  isAdmin,
}: {
  slot: CardSlot;
  editMode: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDrop: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onRemove: () => void;
  onHeightChange: (id: DashboardCardId, h: number) => void;
  onOpenSingletonTab: (type: TabType, pendingEvent?: string) => void;
  onOpenTab: (host: Host, type: TabType) => void;
  hosts: Host[];
  hostMetrics: Map<string, { cpu: number | null; ram: number | null }>;
  uptimeFormatted: string;
  versionText: string;
  versionStatus: "up_to_date" | "requires_update" | "beta";
  dbHealth: "healthy" | "error";
  credentialCount: number;
  activeTunnelCount: number;
  activity: RecentActivityItem[];
  onClearActivity: () => void;
  isAdmin: boolean;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const startH = cardRef.current?.getBoundingClientRect().height ?? 100;
      const onMove = (ev: MouseEvent) => {
        onHeightChange(slot.id, Math.max(50, startH + (ev.clientY - startY)));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [slot.id, onHeightChange],
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
            dbHealth={dbHealth}
          />
        )}
        {slot.id === "counters_bar" && (
          <CountersBarCard
            hosts={hosts}
            credentialCount={credentialCount}
            activeTunnelCount={activeTunnelCount}
          />
        )}
        {slot.id === "quick_actions" && (
          <QuickActionsCard
            onOpenSingletonTab={onOpenSingletonTab}
            hosts={hosts}
            onOpenTab={onOpenTab}
          />
        )}
        {slot.id === "host_status" && (
          <HostStatusCard
            hosts={hosts}
            hostMetrics={hostMetrics}
            onOpenTab={onOpenTab}
            isAdmin={isAdmin}
          />
        )}
        {slot.id === "recent_activity" && (
          <RecentActivityCard
            activity={activity}
            hosts={hosts}
            onOpenTab={onOpenTab}
            onClear={onClearActivity}
          />
        )}
        {slot.id === "network_graph" && (
          <NetworkGraphCard
            embedded={true}
            onOpenInNewTab={() => onOpenSingletonTab("network_graph")}
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
  activeIds: DashboardCardId[];
  onAdd: (id: DashboardCardId) => void;
  cardLabels: Record<DashboardCardId, string>;
}) {
  const { t } = useTranslation();
  const available = DASHBOARD_CARDS.filter((c) => !activeIds.includes(c.id));
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
  onRemove: (id: DashboardCardId) => void;
  onAdd: (id: DashboardCardId, panel: PanelId) => void;
  onHeightChange: (id: DashboardCardId, h: number) => void;
  onOpenSingletonTab: (type: TabType, pendingEvent?: string) => void;
  onOpenTab: (host: Host, type: TabType) => void;
  hosts: Host[];
  hostMetrics: Map<string, { cpu: number | null; ram: number | null }>;
  uptimeFormatted: string;
  versionText: string;
  versionStatus: "up_to_date" | "requires_update" | "beta";
  dbHealth: "healthy" | "error";
  credentialCount: number;
  activeTunnelCount: number;
  activity: RecentActivityItem[];
  onClearActivity: () => void;
  cardLabels: Record<DashboardCardId, string>;
  isAdmin: boolean;
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
  hostMetrics,
  uptimeFormatted,
  versionText,
  versionStatus,
  dbHealth,
  credentialCount,
  activeTunnelCount,
  activity,
  onClearActivity,
  cardLabels,
  isAdmin,
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
          key={slot.id}
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
            isDragging={dragState?.id === slot.id}
            onDragStart={() => onDragStart(slot)}
            onDrop={() => onDrop(slot.panel, slot.order)}
            onDragOver={onDragOver}
            onRemove={() => onRemove(slot.id)}
            onHeightChange={onHeightChange}
            onOpenSingletonTab={onOpenSingletonTab}
            onOpenTab={onOpenTab}
            hosts={hosts}
            hostMetrics={hostMetrics}
            uptimeFormatted={uptimeFormatted}
            versionText={versionText}
            versionStatus={versionStatus}
            dbHealth={dbHealth}
            credentialCount={credentialCount}
            activeTunnelCount={activeTunnelCount}
            activity={activity}
            onClearActivity={onClearActivity}
            isAdmin={isAdmin}
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
}: {
  onOpenSingletonTab: (type: TabType, pendingEvent?: string) => void;
  onOpenTab: (host: Host, type: TabType) => void;
}) {
  const { t, i18n } = useTranslation();

  const [slots, setSlots] = useState<CardSlot[]>(() => {
    try {
      const saved = localStorage.getItem("dashboardTab.slots");
      if (saved) return JSON.parse(saved) as CardSlot[];
    } catch {
      /* ignore */
    }
    return DEFAULT_SLOTS;
  });

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
    "up_to_date" | "requires_update" | "beta"
  >("up_to_date");
  const [dbHealth, setDbHealth] = useState<"healthy" | "error">("healthy");
  const [credentialCount, setCredentialCount] = useState(0);
  const [activeTunnelCount, setActiveTunnelCount] = useState(0);
  const [activity, setActivity] = useState<RecentActivityItem[]>([]);
  const [hostMetrics, setHostMetrics] = useState<
    Map<string, { cpu: number | null; ram: number | null }>
  >(new Map());
  const viewerSessionsRef = useRef<Map<number, string>>(new Map());

  const fetchMetrics = useCallback(async (hostList: Host[]) => {
    let statuses: Record<number, { status?: string }> = {};
    try {
      statuses = (await getAllServerStatuses()) as Record<
        number,
        { status?: string }
      >;
    } catch {
      /* best-effort */
    }

    const newSessions = new Map<number, string>(viewerSessionsRef.current);
    const results = await Promise.all(
      hostList.map(async (host) => {
        const hostId = Number(host.id);
        const knownStatus = statuses?.[hostId]?.status;
        if (knownStatus === "offline") return null;
        if (host.authType === "none" || host.authType === "opkssh") return null;

        try {
          const existing = newSessions.get(hostId);
          if (!existing) {
            const reg = await registerMetricsViewer(hostId);
            if (reg.skipped) return null;
            if (reg.success && reg.viewerSessionId) {
              newSessions.set(hostId, reg.viewerSessionId);
            }
          }
          const metrics = await getServerMetricsById(hostId);
          if (!metrics) return null;
          return {
            id: host.id,
            cpu: metrics.cpu?.percent ?? null,
            ram: metrics.memory?.percent ?? null,
          };
        } catch {
          return null;
        }
      }),
    );

    viewerSessionsRef.current = newSessions;
    const map = new Map<string, { cpu: number | null; ram: number | null }>();
    for (const r of results) {
      if (r) map.set(r.id, { cpu: r.cpu, ram: r.ram });
    }
    setHostMetrics(map);
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const raw = await getSSHHosts().catch(() => []);
      const mapped = raw.map(sshHostToHost);
      if (mounted) setHosts(mapped);
      fetchMetrics(mapped).catch(() => {});
    };
    load();

    getUserInfo()
      .then((info) => setIsAdmin(!!info.is_admin))
      .catch(() => {});
    getUptime()
      .then((u) => setUptimeFormatted(u.formatted))
      .catch(() => {});
    getVersionInfo()
      .then((info) => {
        setVersionText(info.localVersion ?? "");
        setVersionStatus(info.status ?? "up_to_date");
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
      .then((res: any) =>
        setCredentialCount(
          Array.isArray(res?.credentials) ? res.credentials.length : 0,
        ),
      )
      .catch(() => {});
    getTunnelStatuses()
      .then((statuses) => {
        const active = Object.values(statuses ?? {}).filter(
          (s: any) => s?.status === "CONNECTED",
        ).length;
        setActiveTunnelCount(active);
      })
      .catch(() => {});

    const metricsInterval = setInterval(async () => {
      const raw = await getSSHHosts().catch(() => []);
      const mapped = raw.map(sshHostToHost);
      if (mounted) setHosts(mapped);
      fetchMetrics(mapped).catch(() => {});
    }, 30000);

    return () => {
      mounted = false;
      clearInterval(metricsInterval);
    };
  }, [fetchMetrics]);

  useEffect(() => {
    if (viewerSessionsRef.current.size === 0) return;
    const heartbeat = setInterval(async () => {
      for (const [, sessionId] of viewerSessionsRef.current) {
        sendMetricsHeartbeat(sessionId).catch(() => {});
      }
    }, 30000);
    return () => clearInterval(heartbeat);
  }, [hostMetrics]);

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

  const cardLabels: Record<DashboardCardId, string> = {
    stats_bar: t("dashboard.serverOverview"),
    counters_bar: t("dashboard.serverStats"),
    quick_actions: t("dashboard.quickActions"),
    host_status: t("dashboardTab.hostStatus"),
    recent_activity: t("dashboard.recentActivity"),
    network_graph: t("dashboard.networkGraph"),
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
      id: slot.id,
      sourcePanel: slot.panel,
      sourceOrder: slot.order,
    });
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (targetPanel: PanelId, targetOrder: number) => {
    if (!dragState) return;
    setSlots((prev) => {
      const without = prev.filter((s) => s.id !== dragState.id);
      const panelSlots = without
        .filter((s) => s.panel === targetPanel)
        .sort((a, b) => a.order - b.order);
      const others = without.filter((s) => s.panel !== targetPanel);
      const insertIdx = panelSlots.findIndex((s) => s.order > targetOrder);
      const insertAt = insertIdx === -1 ? panelSlots.length : insertIdx;
      const newPanelSlots = [
        ...panelSlots.slice(0, insertAt),
        {
          id: dragState.id,
          panel: targetPanel,
          order: 0,
          height: prev.find((s) => s.id === dragState.id)?.height ?? null,
        },
        ...panelSlots.slice(insertAt),
      ].map((s, i) => ({ ...s, order: i }));
      return [...others, ...newPanelSlots];
    });
    setDragState(null);
  };
  const handleRemove = (id: DashboardCardId) =>
    setSlots((prev) => prev.filter((s) => s.id !== id));
  const handleAdd = (id: DashboardCardId, panel: PanelId) => {
    setSlots((prev) => {
      const panelSlots = prev.filter((s) => s.panel === panel);
      const maxOrder =
        panelSlots.length > 0
          ? Math.max(...panelSlots.map((s) => s.order)) + 1
          : 0;
      const defaultHeight: number | null =
        id === "network_graph"
          ? 350
          : id === "host_status" || id === "recent_activity"
            ? null
            : 150;
      return [...prev, { id, panel, order: maxOrder, height: defaultHeight }];
    });
  };
  const handleHeightChange = (id: DashboardCardId, h: number) =>
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, height: h } : s)),
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
    hostMetrics,
    uptimeFormatted,
    versionText,
    versionStatus,
    dbHealth,
    credentialCount,
    activeTunnelCount,
    activity,
    onClearActivity: handleClearActivity,
    onOpenSingletonTab,
    onOpenTab,
    cardLabels,
    isAdmin,
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
                  dbHealth={dbHealth}
                />
              )}
              {slot.id === "counters_bar" && (
                <CountersBarCard
                  hosts={hosts}
                  credentialCount={credentialCount}
                  activeTunnelCount={activeTunnelCount}
                />
              )}
              {slot.id === "quick_actions" && (
                <QuickActionsCard
                  onOpenSingletonTab={onOpenSingletonTab}
                  hosts={hosts}
                  onOpenTab={onOpenTab}
                />
              )}
              {slot.id === "host_status" && (
                <HostStatusCard
                  hosts={hosts}
                  hostMetrics={hostMetrics}
                  onOpenTab={onOpenTab}
                  isAdmin={isAdmin}
                />
              )}
              {slot.id === "recent_activity" && (
                <RecentActivityCard
                  activity={activity}
                  hosts={hosts}
                  onOpenTab={onOpenTab}
                  onClear={handleClearActivity}
                />
              )}
              {slot.id === "network_graph" && (
                <NetworkGraphCard
                  embedded={true}
                  onOpenInNewTab={() => onOpenSingletonTab("network_graph")}
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
        <div>
          <h1 className="text-lg font-bold leading-tight">
            {t("dashboard.title")}
          </h1>
          <p className="text-xs text-muted-foreground">{todayLabel}</p>
        </div>
        <div className="flex items-center gap-1">
          <div className="hidden sm:flex items-center gap-2 mr-2 bg-muted/50 px-2.5 py-1 rounded-sm border border-border">
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
        </div>
      </Card>

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
          style={{ width: hasSide || editMode ? `${mainWidthPct}%` : "100%" }}
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
    </div>
  );
}
