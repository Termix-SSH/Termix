/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  Boxes,
  Check,
  ChevronRight,
  Copy,
  CopyPlus,
  Cpu,
  FolderSearch,
  GripVertical,
  HardDrive,
  Key,
  KeyRound,
  Layers, // --- tmux-monitor ---
  Link,
  MemoryStick,
  MessagesSquare,
  Monitor,
  MonitorUp,
  MoreHorizontal,
  MousePointerClick,
  Network,
  Pencil,
  Pin,
  Server,
  Share2,
  Terminal,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import { toast } from "sonner";
import { getHostPassword, wakeOnLan } from "@/main-axios";
import type { Host, TabType } from "@/types/ui-types";
import type {
  HostDensity,
  HostTrayTrigger,
} from "@/types/host-sidebar-preferences";
import { copyToClipboard } from "@/lib/clipboard";
import {
  canDeleteHost,
  canEditHost,
  canOverrideHostAuth,
  canShareHost,
} from "@/sidebar/host-permissions";
import { HostAuthOverrideModal } from "@/sidebar/HostAuthOverrideModal";
import {
  useStatusColorScheme,
  getStatusClasses,
} from "@/hooks/use-status-color-scheme";
import { useHostStatus, useServerStatusMeta } from "@/lib/ServerStatusContext";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/tooltip";
import { hostMatchesQuery } from "../visible-rows";
import { markTabSurfaceUsed, preloadTabSurface } from "@/shell/tabUtils";
import {
  getPreferredHostAction,
  recordHostActionPreference,
} from "@/lib/local-adaptive-preferences";

export function statusCheckEnabled(host: Host): boolean {
  return host.statsConfig?.statusCheckEnabled !== false;
}

export function buildStatusTooltip(
  host: Host,
  status: "online" | "reachable" | "offline",
): string {
  const statusLabel =
    status === "online"
      ? "Available"
      : status === "reachable"
        ? "Reachable, not authenticated"
        : "Offline";
  if (!statusCheckEnabled(host)) return "Monitoring disabled";
  const protocols: string[] = [];
  if (host.enableSsh) protocols.push("SSH");
  if (host.enableRdp) protocols.push("RDP");
  if (host.enableVnc) protocols.push("VNC");
  if (host.enableTelnet) protocols.push("Telnet");
  if (protocols.length === 0) return statusLabel;
  return `${protocols.join(", ")}: ${statusLabel}`;
}

export function getSshActions(
  host: Host,
): { type: TabType; icon: typeof Terminal; label: string }[] {
  const metricsEnabled =
    host.enableSsh && host.statsConfig?.metricsEnabled !== false;
  return [
    host.enableSsh &&
      host.enableTerminal && {
        type: "terminal" as TabType,
        icon: Terminal,
        label: "Terminal",
      },
    host.enableSsh &&
      host.enableFileManager && {
        type: "files" as TabType,
        icon: FolderSearch,
        label: "Files",
      },
    host.enableSsh &&
      host.enableDocker && {
        type: "docker" as TabType,
        icon: Box,
        label: "Docker",
      },
    host.enableSsh &&
      host.enableTunnel && {
        type: "tunnel" as TabType,
        icon: Network,
        label: "Tunnel",
      },
    metricsEnabled && {
      type: "host-metrics" as TabType,
      icon: Server,
      label: "Host Metrics",
    },
    host.enableProxmoxStats === true && {
      type: "proxmox-stats" as TabType,
      icon: HardDrive,
      label: "Proxmox Stats",
    },
    // --- tmux-monitor --- opt-in per host, off by default
    host.enableSsh &&
      host.enableTerminal &&
      host.enableTmuxMonitor && {
        type: "tmux_monitor" as TabType,
        icon: Layers,
        label: "Tmux Monitor",
      },
  ].filter(Boolean) as {
    type: TabType;
    icon: typeof Terminal;
    label: string;
  }[];
}

export async function writeClipboardText(value: string): Promise<void> {
  await copyToClipboard(value);
}

export function canCopyHostPassword(host: Host): boolean {
  return (
    host.authType === "password" ||
    host.authType === "credential" ||
    !!host.hasPassword ||
    !!host.password
  );
}

export function canCopyHostSudoPassword(host: Host): boolean {
  return (
    !!host.hasSudoPassword ||
    !!host.sudoPassword ||
    !!host.terminalConfig?.sudoPassword
  );
}

/**
 * Per-density layout knobs. Every feature is available in both densities --
 * only spacing/sizing and whether a couple of rows collapse to a single line
 * differ. Keeping this as one lookup (rather than two parallel JSX trees)
 * means a future style tweak only has to be made once.
 */
const HOST_ITEM_DENSITY_TOKENS = {
  comfortable: {
    rowPadding: "pl-[8.75px] pr-[7px] py-[7px]",
    nameTextSize: "text-[13px]",
    showAddressRow: true,
    showTagsRow: true,
    showResourceRow: true,
  },
  compact: {
    rowPadding: "pl-[7px] pr-[5.25px] py-[5px]",
    nameTextSize: "text-[12px]",
    showAddressRow: false,
    showTagsRow: false,
    showResourceRow: false,
  },
} as const;

export function HostItem({
  host,
  onOpenTab,
  onEditHost: onEditHostProp,
  onShareHost: onShareHostProp,
  onProxmoxDiscover,
  onDelete,
  onDuplicate,
  query = "",
  stripeIndex = 0,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  isMenuOpen = false,
  onMenuOpenChange,
  isTrayOpen = false,
  onTrayOpenChange,
  isHovered = false,
  onHoverChange,
  onDragStart,
  onDragEnd,
  depth = 0,
  density = "comfortable",
  trayTrigger = "hover",
  showTags = true,
  openOnDoubleClick = false,
  showResourceBars = true,
  showStatusStripes = true,
  rowActions = "full",
  arrangeMode = false,
  isDragging = false,
  onReorderDrop,
  isReorderHovered = false,
  reorderHoverEdge = null,
  onReorderHoverChange,
  isExpanded = false,
  onToggleExpand,
  draggedHostIds = null,
  onDropChildHosts,
}: {
  host: Host;
  onOpenTab: (type: TabType) => void;
  onEditHost?: () => void;
  onShareHost?: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  query?: string;
  stripeIndex?: number;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  isMenuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  isTrayOpen?: boolean;
  onTrayOpenChange?: (open: boolean) => void;
  isHovered?: boolean;
  onHoverChange?: (hovered: boolean) => void;
  onProxmoxDiscover?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** Nesting level when rendered in a flattened virtual list. */
  depth?: number;
  density?: HostDensity;
  trayTrigger?: HostTrayTrigger;
  showTags?: boolean;
  /** Requires a double click to launch instead of a single click. */
  openOnDoubleClick?: boolean;
  /** Preset-driven: hides the CPU/RAM bars without changing density. */
  showResourceBars?: boolean;
  /** Preset-driven: hides the per-row status color stripe. */
  showStatusStripes?: boolean;
  /** "essential" trims the row's management actions to the common few. */
  rowActions?: "essential" | "full";
  /** When true (rearranging unlocked), the row can be dragged: its edges
   * become reorder drop zones and its middle accepts a nest/move drop. */
  arrangeMode?: boolean;
  /** True while this row is the one being dragged, for the ghost styling. */
  isDragging?: boolean;
  onReorderDrop?: (position: "before" | "after") => void;
  /** Whether THIS row is the current reorder drop target -- lifted to a
   * single piece of state in the parent tree so only one row can ever show
   * the drop-indicator bar at a time, instead of each row tracking its own
   * hover state (which could get stuck showing a stale bar when dragleave
   * didn't fire cleanly, e.g. jumping directly from one virtualized row to
   * another). */
  isReorderHovered?: boolean;
  reorderHoverEdge?: "before" | "after" | null;
  onReorderHoverChange?: (edge: "before" | "after" | null) => void;
  /** Whether this host's sub-host children are currently shown. */
  isExpanded?: boolean;
  /** Present only when this host has sub-hosts nested under it. */
  onToggleExpand?: () => void;
  /** ids of the host(s) currently being dragged, if any -- mirrors FolderItem's drop-target wiring. */
  draggedHostIds?: string[] | null;
  /** Present when this row can accept a dragged host/selection to become its parent. */
  onDropChildHosts?: (hostIds: string[]) => void;
}) {
  const { t } = useTranslation();
  // Shared hosts expose actions matching the recipient's permission level.
  const onEditHost = canEditHost(host) ? onEditHostProp : undefined;
  const onShareHost = canShareHost(host) ? onShareHostProp : undefined;
  const allowDelete = canDeleteHost(host);
  const metricsEnabled =
    host.enableSsh && host.statsConfig?.metricsEnabled !== false;
  const statusScheme = useStatusColorScheme();
  const { initialLoadComplete } = useServerStatusMeta();
  const statusCheckOn = statusCheckEnabled(host);
  const statusLoading = !initialLoadComplete && statusCheckOn;
  // Per-host subscription — status polls only re-render rows that flipped.
  const liveStatus = useHostStatus(Number(host.id), statusCheckOn);
  const availability =
    liveStatus === "online" ||
    liveStatus === "reachable" ||
    liveStatus === "offline"
      ? liveStatus
      : host.status === "reachable"
        ? "reachable"
        : host.online
          ? "online"
          : "offline";
  const isOnline = availability === "online";
  const isTouchOnly =
    typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;
  const alwaysShowTray = trayTrigger === "always";
  const actionsOnly = trayTrigger === "actionsOnly";
  const shouldUseClickTray =
    !alwaysShowTray && !actionsOnly && (trayTrigger === "click" || isTouchOnly);
  const showPasswordCopy = !host.isShared && canCopyHostPassword(host);
  const showSudoPasswordCopy = !host.isShared && canCopyHostSudoPassword(host);
  const canOverrideAuth = canOverrideHostAuth(host, "ssh");
  const [authOverrideOpen, setAuthOverrideOpen] = useState(false);
  const [parentDragOver, setParentDragOver] = useState(false);
  const [nativeRdpAvailable, setNativeRdpAvailable] = useState(false);

  useEffect(() => {
    if (!window.electronAPI?.isElectron) return;
    window.electronAPI
      .getPlatform()
      .then((platform) => setNativeRdpAvailable(platform === "win32"))
      .catch(() => setNativeRdpAvailable(false));
  }, []);
  // Density decides the base shape; the preset can only take rows away, never
  // add them, so a row's real height stays <= the virtualizer's fixed estimate.
  const densityTokens = HOST_ITEM_DENSITY_TOKENS[density];
  const tokens = {
    ...densityTokens,
    showTagsRow: densityTokens.showTagsRow && showTags,
    showResourceRow: densityTokens.showResourceRow && showResourceBars,
  };
  const isCompact = density === "compact";
  const reorderEdge = isReorderHovered ? reorderHoverEdge : null;
  const canDrag =
    arrangeMode && !selectionMode && !isTouchOnly && canEditHost(host);
  // The middle band nests the dragged host under this one; the top/bottom
  // bands reorder. Both live on the same row, so the pointer's position
  // inside it picks the intent instead of a modifier key.
  const acceptsChildDrop =
    arrangeMode &&
    !!onDropChildHosts &&
    !!draggedHostIds &&
    !draggedHostIds.includes(host.id);

  async function handleCopyPassword(
    e: MouseEvent,
    field: "password" | "sudoPassword",
  ) {
    e.stopPropagation();
    const password = await getHostPassword(Number(host.id), field);
    if (!password) {
      toast.error(t("nav.failedToCopyPassword"));
      return;
    }

    try {
      await writeClipboardText(password);
      toast.success(t("nav.passwordCopied"));
    } catch {
      toast.error(t("nav.failedToCopyPassword"));
    }
  }

  async function handleNativeRdp(e: MouseEvent) {
    e.stopPropagation();
    try {
      const result = await window.electronAPI.openNativeRdp({
        host: host.ip,
        port: host.rdpPort ?? 3389,
        username: host.rdpUser,
        domain: host.domain,
      });
      if (result.success) {
        toast.success(t("hosts.nativeRdpOpened"));
      } else {
        toast.error(result.error || t("hosts.nativeRdpFailed"));
      }
    } catch {
      toast.error(t("hosts.nativeRdpFailed"));
    }
  }

  if (query && !hostMatchesQuery(host, query)) return null;

  const depthStyle =
    depth > 0 ? ({ paddingLeft: depth * 12 } as const) : undefined;

  const trayButtonClass =
    "flex items-center justify-center size-[22.75px] text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors";

  const sshActions = getSshActions(host);
  const availableActions: TabType[] = [
    ...sshActions.map(({ type }) => type),
    ...(host.enableRdp ? (["rdp"] as const) : []),
    ...(host.enableVnc ? (["vnc"] as const) : []),
    ...(host.enableTelnet ? (["telnet"] as const) : []),
  ];
  const defaultAction: TabType = host.enableSsh
    ? "terminal"
    : host.enableRdp
      ? "rdp"
      : host.enableVnc
        ? "vnc"
        : host.enableTelnet
          ? "telnet"
          : "terminal";
  const openHostTab = (type: TabType) => {
    markTabSurfaceUsed(type);
    recordHostActionPreference(host.id, type);
    onOpenTab(type);
  };

  const connectionButtons = (
    <>
      {sshActions.map(({ type, icon: Icon, label }) => (
        <button
          key={type}
          title={label}
          onPointerEnter={() => preloadTabSurface(type)}
          onFocus={() => preloadTabSurface(type)}
          onClick={(e) => {
            e.stopPropagation();
            openHostTab(type);
          }}
          className={trayButtonClass}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
      {host.enableSsh &&
        (host.enableRdp || host.enableVnc || host.enableTelnet) &&
        sshActions.length > 0 && (
          <div className="w-px h-3.5 bg-border/60 mx-0.5 shrink-0" />
        )}
      {host.enableRdp && (
        <button
          title={t("hosts.connectRdp")}
          onPointerEnter={() => preloadTabSurface("rdp")}
          onFocus={() => preloadTabSurface("rdp")}
          onClick={(e) => {
            e.stopPropagation();
            openHostTab("rdp");
          }}
          className={trayButtonClass}
        >
          <Monitor className="size-3.5" />
        </button>
      )}
      {host.enableRdp && nativeRdpAvailable && (
        <button
          title={t("hosts.openNativeRdp")}
          onClick={handleNativeRdp}
          className={trayButtonClass}
        >
          <MonitorUp className="size-3.5" />
        </button>
      )}
      {host.enableVnc && (
        <button
          title={t("hosts.connectVnc")}
          onPointerEnter={() => preloadTabSurface("vnc")}
          onFocus={() => preloadTabSurface("vnc")}
          onClick={(e) => {
            e.stopPropagation();
            openHostTab("vnc");
          }}
          className={trayButtonClass}
        >
          <MousePointerClick className="size-3.5" />
        </button>
      )}
      {host.enableTelnet && (
        <button
          title={t("hosts.connectTelnet")}
          onPointerEnter={() => preloadTabSurface("telnet")}
          onFocus={() => preloadTabSurface("telnet")}
          onClick={(e) => {
            e.stopPropagation();
            openHostTab("telnet");
          }}
          className={trayButtonClass}
        >
          <MessagesSquare className="size-3.5" />
        </button>
      )}
      {host.macAddress && (
        <button
          title={t("hosts.wakeOnLanAction")}
          onClick={async (e) => {
            e.stopPropagation();
            try {
              await wakeOnLan(Number(host.id));
              toast.success(t("hosts.wakeOnLanSuccess", { name: host.name }));
            } catch {
              toast.error(t("hosts.wakeOnLanError"));
            }
          }}
          className={trayButtonClass}
        >
          <Zap className="size-3.5" />
        </button>
      )}
    </>
  );

  // "essential" only trims buttons that the overflow menu also offers, so no
  // action becomes unreachable. Share and Proxmox discover have no menu entry,
  // so they always stay on the row.
  const essentialActions = rowActions === "essential";

  const managementButtons = (
    <>
      {!essentialActions && showPasswordCopy && (
        <button
          title={t("nav.copyPassword")}
          onClick={(e) => handleCopyPassword(e, "password")}
          className={trayButtonClass}
        >
          <Key className="size-3.5" />
        </button>
      )}
      {!essentialActions && showSudoPasswordCopy && (
        <button
          title={t("nav.copySudoPassword")}
          onClick={(e) => handleCopyPassword(e, "sudoPassword")}
          className={trayButtonClass}
        >
          <KeyRound className="size-3.5" />
        </button>
      )}
      {onEditHost && (
        <button
          title={t("hosts.editHostAction")}
          onClick={(e) => {
            e.stopPropagation();
            onEditHost();
          }}
          className={trayButtonClass}
        >
          <Pencil className="size-3.5" />
        </button>
      )}
      {onShareHost && (
        <button
          title={t("hosts.shareHost")}
          onClick={(e) => {
            e.stopPropagation();
            onShareHost();
          }}
          className={trayButtonClass}
        >
          <Share2 className="size-3.5" />
        </button>
      )}
      {host.enableProxmox && onProxmoxDiscover && (
        <button
          title={t("hosts.proxmoxDiscoverAction")}
          onClick={(e) => {
            e.stopPropagation();
            onProxmoxDiscover();
          }}
          className={trayButtonClass}
        >
          <Boxes className="size-3.5" />
        </button>
      )}
      <DropdownMenu open={isMenuOpen} onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            title={t("hosts.moreOptions")}
            onClick={(e) => e.stopPropagation()}
            className={trayButtonClass}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="text-xs w-auto min-w-44 max-w-72 whitespace-nowrap"
        >
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              writeClipboardText(`${host.username}@${host.ip}`);
              toast.success(t("hosts.copiedToClipboard"));
            }}
          >
            <Copy className="size-3.5 mr-2" />
            {t("hosts.copyAddress")}
          </DropdownMenuItem>
          {canOverrideAuth && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                setAuthOverrideOpen(true);
              }}
            >
              <KeyRound className="size-3.5 mr-2" />
              {t("hosts.sharing.authOverrideAction")}
            </DropdownMenuItem>
          )}
          {showPasswordCopy && (
            <DropdownMenuItem
              onClick={(e) => handleCopyPassword(e, "password")}
            >
              <Key className="size-3.5 mr-2" />
              {t("nav.copyPassword")}
            </DropdownMenuItem>
          )}
          {showSudoPasswordCopy && (
            <DropdownMenuItem
              onClick={(e) => handleCopyPassword(e, "sudoPassword")}
            >
              <KeyRound className="size-3.5 mr-2" />
              {t("nav.copySudoPassword")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Link className="size-3.5 mr-2" />
              {t("hosts.copyLink")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {host.enableSsh && host.enableTerminal && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    writeClipboardText(
                      `${window.location.origin}?view=terminal&hostId=${host.id}`,
                    );
                    toast.success(t("hosts.terminalUrlCopied"));
                  }}
                >
                  <Terminal className="size-3.5 mr-2" />
                  {t("hosts.copyTerminalUrlAction")}
                </DropdownMenuItem>
              )}
              {host.enableSsh && host.enableFileManager && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    writeClipboardText(
                      `${window.location.origin}?view=file-manager&hostId=${host.id}`,
                    );
                    toast.success(t("hosts.fileManagerUrlCopied"));
                  }}
                >
                  <FolderSearch className="size-3.5 mr-2" />
                  {t("hosts.copyFileManagerUrlAction")}
                </DropdownMenuItem>
              )}
              {host.enableSsh && host.enableTunnel && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    writeClipboardText(
                      `${window.location.origin}?view=tunnel&hostId=${host.id}`,
                    );
                    toast.success(t("hosts.tunnelUrlCopied"));
                  }}
                >
                  <Network className="size-3.5 mr-2" />
                  {t("hosts.copyTunnelUrlAction")}
                </DropdownMenuItem>
              )}
              {host.enableSsh && host.enableDocker && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    writeClipboardText(
                      `${window.location.origin}?view=docker&hostId=${host.id}`,
                    );
                    toast.success(t("hosts.dockerUrlCopied"));
                  }}
                >
                  <Box className="size-3.5 mr-2" />
                  {t("hosts.copyDockerUrlAction")}
                </DropdownMenuItem>
              )}
              {host.enableSsh && metricsEnabled && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    writeClipboardText(
                      `${window.location.origin}?view=host-metrics&hostId=${host.id}`,
                    );
                    toast.success(t("hosts.hostMetricsUrlCopied"));
                  }}
                >
                  <Server className="size-3.5 mr-2" />
                  {t("hosts.copyHostMetricsUrlAction")}
                </DropdownMenuItem>
              )}
              {host.enableSsh && host.enableProxmoxStats === true && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    writeClipboardText(
                      `${window.location.origin}?view=proxmox-stats&hostId=${host.id}`,
                    );
                    toast.success(t("hosts.proxmoxStatsUrlCopied"));
                  }}
                >
                  <HardDrive className="size-3.5 mr-2" />
                  {t("hosts.copyProxmoxStatsUrlAction")}
                </DropdownMenuItem>
              )}
              {host.enableSsh &&
                host.enableTerminal &&
                host.enableTmuxMonitor && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      writeClipboardText(
                        `${window.location.origin}?view=tmux_monitor&hostId=${host.id}`,
                      );
                      toast.success(t("hosts.tmuxMonitorUrlCopied"));
                    }}
                  >
                    <Layers className="size-3.5 mr-2" />
                    {t("hosts.copyTmuxMonitorUrlAction")}
                  </DropdownMenuItem>
                )}
              {host.enableRdp && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    writeClipboardText(
                      `${window.location.origin}?view=rdp&hostId=${host.id}`,
                    );
                    toast.success(t("hosts.rdpUrlCopied"));
                  }}
                >
                  <Monitor className="size-3.5 mr-2" />
                  {t("hosts.copyRdpUrlAction")}
                </DropdownMenuItem>
              )}
              {host.enableVnc && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    writeClipboardText(
                      `${window.location.origin}?view=vnc&hostId=${host.id}`,
                    );
                    toast.success(t("hosts.vncUrlCopied"));
                  }}
                >
                  <MousePointerClick className="size-3.5 mr-2" />
                  {t("hosts.copyVncUrlAction")}
                </DropdownMenuItem>
              )}
              {host.enableTelnet && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    writeClipboardText(
                      `${window.location.origin}?view=telnet&hostId=${host.id}`,
                    );
                    toast.success(t("hosts.telnetUrlCopied"));
                  }}
                >
                  <MessagesSquare className="size-3.5 mr-2" />
                  {t("hosts.copyTelnetUrlAction")}
                </DropdownMenuItem>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {allowDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate();
                }}
              >
                <CopyPlus className="size-3.5 mr-2" />
                {t("hosts.cloneHostAction")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 className="size-3.5 mr-2" />
                {t("common.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  const trayOpenState = isTrayOpen || isMenuOpen;
  // Hover mode keeps the tray open from React state rather than group-hover so
  // the virtualizer can reserve the expanded height for this row.
  const hoverTrayOpen =
    !alwaysShowTray &&
    !actionsOnly &&
    !shouldUseClickTray &&
    !selectionMode &&
    (isHovered || isMenuOpen);
  const trayVisibilityClass =
    alwaysShowTray || actionsOnly
      ? `overflow-hidden transition-all duration-150 ease-out ${trayOpenState || alwaysShowTray ? "max-h-[130px] opacity-100" : "max-h-0 opacity-0"}`
      : shouldUseClickTray
        ? `overflow-hidden transition-all duration-150 ease-out ${trayOpenState ? "max-h-[130px] opacity-100" : "max-h-0 opacity-0"}`
        : // No transition in hover mode: the row's height is set by the
          // virtualizer and snaps in a single frame, so animating the tray
          // against it leaves the open tray overflowing its shortened row for
          // the length of the animation. Both change together instead.
          `overflow-hidden ${hoverTrayOpen ? "max-h-[130px] opacity-100" : "max-h-0 opacity-0"}`;

  return (
    <div
      draggable={canDrag}
      onDragStart={(e) => {
        if (!canDrag) return;
        e.dataTransfer.effectAllowed = "move";
        // Without an explicit drag image the browser snapshots the whole row
        // including its open action tray, which drags a tall block around
        // and reads as the UI overlapping itself. Use the name row instead.
        const label =
          e.currentTarget.querySelector<HTMLElement>("[data-drag-label]");
        if (label) {
          const rect = label.getBoundingClientRect();
          e.dataTransfer.setDragImage(
            label,
            Math.min(e.clientX - rect.left, rect.width),
            rect.height / 2,
          );
        }
        onDragStart?.();
      }}
      onDragEnd={() => {
        onReorderHoverChange?.(null);
        setParentDragOver(false);
        onDragEnd?.();
      }}
      onDragOver={(e) => {
        if (!arrangeMode) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const offset = e.clientY - rect.top;
        // Reordering is the common intent, so the edge bands get most of the
        // row: only the middle third nests. A 10px floor keeps the bands
        // hittable on a compact row, and measuring against the name row's
        // height (not the row's, which grows with an open tray) keeps the
        // split where the pointer expects it on a tall row.
        const NAME_ROW = 34;
        const effective = Math.min(rect.height, NAME_ROW);
        const band = Math.max(10, effective / 3);
        const wantsNest =
          acceptsChildDrop && offset > band && offset < rect.height - band;

        if (wantsNest) {
          e.preventDefault();
          e.stopPropagation();
          onReorderHoverChange?.(null);
          setParentDragOver(true);
          return;
        }
        if (onReorderDrop) {
          e.preventDefault();
          e.stopPropagation();
          setParentDragOver(false);
          onReorderHoverChange?.(offset < rect.height / 2 ? "before" : "after");
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) {
          setParentDragOver(false);
        }
      }}
      onDrop={(e) => {
        if (!arrangeMode) return;
        if (parentDragOver && acceptsChildDrop && draggedHostIds) {
          e.preventDefault();
          e.stopPropagation();
          setParentDragOver(false);
          onDropChildHosts?.(draggedHostIds);
          return;
        }
        if (onReorderDrop && reorderEdge) {
          e.preventDefault();
          e.stopPropagation();
          onReorderDrop(reorderEdge);
          onReorderHoverChange?.(null);
        }
      }}
      style={depthStyle}
      onPointerEnter={() => {
        preloadTabSurface(defaultAction);
        const preferredAction = getPreferredHostAction(
          host.id,
          availableActions,
          defaultAction,
        );
        if (preferredAction !== defaultAction) {
          preloadTabSurface(preferredAction);
        }
      }}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      className={`group relative flex items-stretch select-none transition-colors hover:bg-muted/50 ${
        canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${
        selected
          ? "bg-accent-brand/[0.07]"
          : stripeIndex % 2 === 1
            ? "bg-muted/15"
            : ""
      } ${isMenuOpen ? "bg-muted/50" : ""} ${parentDragOver ? "ring-1 ring-inset ring-accent-brand bg-accent-brand/10" : ""} ${isDragging ? "opacity-40" : ""}`}
      onClick={(e) => {
        if (selectionMode) {
          onToggleSelect?.();
          return;
        }
        // On touch devices, open the action tray so the per-protocol buttons are
        // reachable. If the host only exposes a single action, just launch it.
        if (isTouchOnly) {
          e.stopPropagation();
          const actionCount = getSshActions(host).length;
          const otherProtocols = [
            host.enableRdp,
            host.enableVnc,
            host.enableTelnet,
          ].filter(Boolean).length;
          if (actionCount + otherProtocols <= 1) {
            openHostTab(defaultAction);
          } else {
            onTrayOpenChange?.(!isTrayOpen);
          }
          return;
        }
        if (openOnDoubleClick) return;
        openHostTab(defaultAction);
      }}
      onDoubleClick={(e) => {
        if (selectionMode || isTouchOnly || !openOnDoubleClick) return;
        e.stopPropagation();
        openHostTab(defaultAction);
      }}
    >
      {/* Status stripe */}
      {showStatusStripes && (
        <div
          className={`w-[3px] shrink-0 transition-colors ${getStatusClasses(availability, statusScheme, "stripe", statusLoading)}`}
        />
      )}

      {canDrag && (
        <div
          className="flex items-center justify-center w-4 shrink-0 text-muted-foreground/35 group-hover:text-muted-foreground/70 transition-colors"
          title={t("hosts.dragToRearrange")}
        >
          <GripVertical className="size-3" />
        </div>
      )}

      <div
        className={`flex flex-col flex-1 min-w-0 ${tokens.rowPadding} ${isCompact ? "" : "gap-[3.5px]"}`}
      >
        {/* Name row */}
        <div data-drag-label className="flex items-center gap-1.5 min-w-0">
          {onToggleExpand && (
            <button
              type="button"
              title={
                isExpanded
                  ? t("hosts.collapseSubHosts")
                  : t("hosts.expandSubHosts")
              }
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
              className="flex items-center justify-center size-3.5 shrink-0 text-muted-foreground/60 hover:text-foreground"
            >
              <ChevronRight
                className={`size-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              />
            </button>
          )}
          {selectionMode && (
            <div
              className={`size-3.5 border-2 flex items-center justify-center shrink-0 transition-colors ${selected ? "border-accent-brand bg-accent-brand" : "border-border bg-background"}`}
            >
              {selected && <Check className="size-2 text-background" />}
            </div>
          )}
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={`${tokens.nameTextSize} font-semibold truncate text-foreground leading-none tracking-tight`}
                >
                  {host.name}
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">
                {buildStatusTooltip(host, availability)}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {host.pin && (
            <Pin className="size-2.5 text-accent-brand/50 shrink-0" />
          )}
          {host.isShared && (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-0.5 text-[9px] px-1 py-px border border-accent-brand/30 bg-accent-brand/10 text-accent-brand shrink-0 leading-none uppercase tracking-wider">
                    <Users className="size-2.5" />
                    {t("hosts.sharing.sharedBadge")}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {t("hosts.sharing.sharedBadgeTooltip", {
                    owner: host.ownerUsername || "?",
                    level: t(
                      `hosts.sharing.levels.${host.permissionLevel ?? "connect"}.label`,
                    ),
                  })}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {isCompact &&
            !selectionMode &&
            !shouldUseClickTray &&
            !actionsOnly && (
              <span
                className={`text-[11px] text-muted-foreground/70 truncate leading-none ml-auto shrink-0 ${hoverTrayOpen ? "hidden" : ""}`}
              >
                {host.ip}
              </span>
            )}
          {isCompact && selectionMode && (
            <span className="text-[11px] text-muted-foreground/70 truncate leading-none ml-auto shrink-0">
              {host.ip}
            </span>
          )}
          {!selectionMode && (shouldUseClickTray || actionsOnly) && (
            <button
              title={
                isTrayOpen
                  ? t("hosts.collapseActions")
                  : t("hosts.expandActions")
              }
              onClick={(e) => {
                e.stopPropagation();
                onTrayOpenChange?.(!isTrayOpen);
              }}
              className="ml-auto flex items-center justify-center size-[17.5px] rounded text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted-foreground/10 transition-colors shrink-0"
            >
              <ChevronRight
                className={`size-[10.5px] transition-transform duration-150 ${isTrayOpen ? "rotate-90" : ""}`}
              />
            </button>
          )}
        </div>

        {/* Address — always visible in comfortable density */}
        {tokens.showAddressRow && (
          <span className="text-[11px] text-muted-foreground/60 truncate leading-none font-mono">
            {host.username}@{host.ip}
          </span>
        )}

        {/* Tag pills */}
        {showTags && host.tags && host.tags.length > 0 && (
          <div
            className={`flex items-center gap-1 min-w-0 overflow-hidden ${tokens.showTagsRow ? "" : "-mt-0.5"}`}
          >
            {host.tags.slice(0, isCompact ? 2 : 4).map((tag) => (
              <span
                key={tag}
                className="text-[9px] px-1.5 py-[1px] bg-muted/60 text-muted-foreground/70 lowercase shrink-0 leading-[1.4]"
              >
                {tag}
              </span>
            ))}
            {host.tags.length > (isCompact ? 2 : 4) && (
              <span className="text-[9px] text-muted-foreground/40 shrink-0">
                +{host.tags.length - (isCompact ? 2 : 4)}
              </span>
            )}
          </div>
        )}

        {/* Connection buttons: permanent in "always"/"actionsOnly" modes, or shown once the chevron opens the tray in click mode */}
        {!selectionMode &&
          (alwaysShowTray ||
            actionsOnly ||
            (shouldUseClickTray && isTrayOpen)) && (
            <div className="flex items-center flex-wrap gap-[3.5px]">
              {connectionButtons}
            </div>
          )}

        {/* Action tray — slides open on hover (default) or via chevron in click-tray mode */}
        <div className={trayVisibilityClass}>
          {tokens.showResourceRow &&
            isOnline &&
            ((host.cpu != null && host.cpu > 0) ||
              (host.ram != null && host.ram > 0)) && (
              <div className="flex items-center gap-[10.5px] pt-[5.25px]">
                {host.cpu != null && host.cpu > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Cpu className="size-2.5 shrink-0 text-muted-foreground/40" />
                    <div className="w-9 h-1 bg-muted-foreground/15 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${host.cpu > 80 ? "bg-red-400" : host.cpu > 50 ? "bg-yellow-400" : "bg-accent-brand"}`}
                        style={{ width: `${host.cpu}%` }}
                      />
                    </div>
                    <span className="text-[9px] tabular-nums text-muted-foreground/50">
                      {host.cpu}%
                    </span>
                  </div>
                )}
                {host.ram != null && host.ram > 0 && (
                  <div className="flex items-center gap-1.5">
                    <MemoryStick className="size-2.5 shrink-0 text-muted-foreground/40" />
                    <div className="w-9 h-1 bg-muted-foreground/15 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${host.ram > 80 ? "bg-red-400" : host.ram > 60 ? "bg-yellow-400" : "bg-accent-brand/60"}`}
                        style={{ width: `${host.ram}%` }}
                      />
                    </div>
                    <span className="text-[9px] tabular-nums text-muted-foreground/50">
                      {host.ram}%
                    </span>
                  </div>
                )}
              </div>
            )}

          <div
            className={`flex flex-col gap-0.5 ${alwaysShowTray || actionsOnly || shouldUseClickTray ? "" : "pt-1.5"}`}
          >
            {/* Connection buttons — only shown here when not already shown above */}
            {!alwaysShowTray && !actionsOnly && !shouldUseClickTray && (
              <div className="flex items-center flex-wrap gap-[1.75px]">
                {connectionButtons}
              </div>
            )}

            {/* Management buttons row */}
            <div
              className={`flex items-center gap-[1.75px] border-t border-border/30 ${alwaysShowTray || actionsOnly || shouldUseClickTray ? "pt-[5.25px]" : "pt-[3.5px] mt-[1.75px]"}`}
            >
              {managementButtons}
            </div>
          </div>
        </div>
        {canOverrideAuth && (
          <HostAuthOverrideModal
            open={authOverrideOpen}
            onOpenChange={setAuthOverrideOpen}
            host={host}
            protocol="ssh"
          />
        )}
      </div>
    </div>
  );
}
