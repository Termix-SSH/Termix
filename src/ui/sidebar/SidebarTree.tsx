import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CopyPlus,
  Cpu,
  FolderOpen,
  FolderSearch,
  Link,
  Loader2,
  MemoryStick,
  MessagesSquare,
  Monitor,
  MoreHorizontal,
  MousePointerClick,
  Network,
  Pencil,
  Pin,
  Server,
  Share2,
  Terminal,
  Trash2,
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
import {
  bulkUpdateSSHHosts,
  createSSHHost,
  deleteSSHHost,
  wakeOnLan,
} from "@/main-axios";
import type { Host, HostFolder, TabType } from "@/types/ui-types";

export function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}

function getSshActions(
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
      type: "stats" as TabType,
      icon: Server,
      label: "Stats",
    },
  ].filter(Boolean) as {
    type: TabType;
    icon: typeof Terminal;
    label: string;
  }[];
}

function hostMatchesQuery(host: Host, query: string) {
  return (
    host.name.toLowerCase().includes(query) ||
    host.ip.toLowerCase().includes(query) ||
    host.username.toLowerCase().includes(query) ||
    host.tags?.some((t) => t.toLowerCase().includes(query))
  );
}

function folderHasMatch(folder: HostFolder, query: string): boolean {
  for (const child of folder.children) {
    if (isFolder(child)) {
      if (folderHasMatch(child, query)) return true;
    } else {
      if (hostMatchesQuery(child, query)) return true;
    }
  }
  return false;
}

type VirtualRow = { item: Host | HostFolder; depth: number };

function collectVisibleRows(
  children: (Host | HostFolder)[],
  query: string,
  openSet: Set<string>,
  out: VirtualRow[] = [],
  depth = 0,
): VirtualRow[] {
  for (const child of children) {
    if (isFolder(child)) {
      const visible = query ? folderHasMatch(child, query) : true;
      if (!visible) continue;
      out.push({ item: child, depth });
      const childOpen = query ? true : openSet.has(child.name);
      if (childOpen)
        collectVisibleRows(child.children, query, openSet, out, depth + 1);
    } else {
      if (!query || hostMatchesQuery(child, query))
        out.push({ item: child, depth });
    }
  }
  return out;
}

function collectAllHosts(children: (Host | HostFolder)[]): Host[] {
  const out: Host[] = [];
  for (const child of children) {
    if (isFolder(child)) {
      out.push(...collectAllHosts(child.children));
    } else {
      out.push(child);
    }
  }
  return out;
}

function collectAllFolders(children: (Host | HostFolder)[]): string[] {
  const names = new Set<string>();
  for (const child of children) {
    if (isFolder(child)) {
      names.add(child.name);
      for (const f of collectAllFolders(child.children)) names.add(f);
    }
  }
  return Array.from(names).sort();
}

function folderHostCount(folder: HostFolder): {
  total: number;
  online: number;
} {
  let total = 0,
    online = 0;
  for (const child of folder.children) {
    if (isFolder(child)) {
      const c = folderHostCount(child);
      total += c.total;
      online += c.online;
    } else {
      total++;
      if (child.online) online++;
    }
  }
  return { total, online };
}

export function HostItem({
  host,
  onOpenTab,
  onEditHost,
  onShareHost,
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
}) {
  const { t } = useTranslation();
  const metricsEnabled =
    host.enableSsh && host.statsConfig?.metricsEnabled !== false;
  const [trayOnClick, setTrayOnClick] = useState(
    () => localStorage.getItem("hostTrayOnClick") === "true",
  );
  const [showHostTags, setShowHostTags] = useState<boolean>(() => {
    const v = localStorage.getItem("showHostTags");
    return v !== null ? v === "true" : true;
  });

  useEffect(() => {
    const handler = () =>
      setTrayOnClick(localStorage.getItem("hostTrayOnClick") === "true");
    window.addEventListener("storage", handler);
    window.addEventListener("hostTrayOnClickChanged", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("hostTrayOnClickChanged", handler);
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      const v = localStorage.getItem("showHostTags");
      setShowHostTags(v !== null ? v === "true" : true);
    };
    window.addEventListener("storage", handler);
    window.addEventListener("showHostTagsChanged", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("showHostTagsChanged", handler);
    };
  }, []);

  if (query && !hostMatchesQuery(host, query)) return null;

  return (
    <div
      className={`group relative flex items-stretch cursor-pointer select-none transition-colors hover:bg-muted/40 ${
        selected
          ? "bg-accent-brand/5"
          : stripeIndex % 2 === 1
            ? "bg-muted/20"
            : ""
      } ${isMenuOpen ? "bg-muted/40" : ""}`}
      onClick={(e) => {
        if (selectionMode) {
          onToggleSelect?.();
          return;
        }
        // On touch devices open the action tray instead of immediately launching a tab
        if (window.matchMedia("(hover: none)").matches) {
          e.stopPropagation();
          onTrayOpenChange?.(!isTrayOpen);
          return;
        }
        if (trayOnClick) {
          onTrayOpenChange?.(!isTrayOpen);
          return;
        }
        if (host.enableSsh) onOpenTab("terminal");
        else if (host.enableRdp) onOpenTab("rdp");
        else if (host.enableVnc) onOpenTab("vnc");
        else if (host.enableTelnet) onOpenTab("telnet");
        else onOpenTab("terminal");
      }}
    >
      {/* Status stripe */}
      <div
        className={`w-[3px] shrink-0 transition-colors ${host.online ? "bg-accent-brand" : "bg-transparent"}`}
      />

      <div className="flex flex-col flex-1 min-w-0 px-2.5 pt-2 pb-1.5 gap-1">
        {/* Name row */}
        <div className="flex items-center gap-1.5 min-w-0">
          {selectionMode && (
            <div
              className={`size-3.5 border-2 flex items-center justify-center shrink-0 transition-colors ${selected ? "border-accent-brand bg-accent-brand" : "border-border bg-background"}`}
            >
              {selected && <Check className="size-2 text-background" />}
            </div>
          )}
          <span
            className={`size-1.5 rounded-full shrink-0 ${host.online ? "bg-accent-brand" : "bg-muted-foreground/25"}`}
          />
          <span className="text-[13px] font-medium truncate text-foreground leading-none">
            {host.name}
          </span>
          {host.pin && (
            <Pin className="size-2.5 text-accent-brand/50 shrink-0" />
          )}
        </div>

        {/* Address — only visible on hover (or click when trayOnClick) or while menu is open */}
        <span
          className={`text-[11px] text-muted-foreground/55 truncate leading-none pl-3 transition-opacity duration-100 ${!trayOnClick ? "group-hover:opacity-100 group-hover:h-auto" : ""} ${isMenuOpen || (trayOnClick && isTrayOpen) ? "opacity-100 h-auto" : "opacity-0 h-0 overflow-hidden"}`}
        >
          {host.username}@{host.ip}
        </span>

        {/* Tag pills */}
        {showHostTags && host.tags && host.tags.length > 0 && (
          <div className="flex items-center gap-1 min-w-0 overflow-hidden pl-3">
            {host.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="text-[9px] px-1 py-px border border-border/50 bg-muted/30 text-muted-foreground/60 lowercase shrink-0 leading-none"
              >
                {tag}
              </span>
            ))}
            {host.tags.length > 4 && (
              <span className="text-[9px] text-muted-foreground/40 shrink-0">
                +{host.tags.length - 4}
              </span>
            )}
          </div>
        )}

        {/* Action tray — slides open on CSS hover, on click (when trayOnClick), or while menu is open */}
        <div
          className={`overflow-hidden transition-all duration-150 ease-out max-h-0 opacity-0 ${!trayOnClick ? "group-hover:max-h-[300px] group-hover:opacity-100" : ""} ${selectionMode ? "!max-h-0 !opacity-0" : ""} ${(isMenuOpen || (trayOnClick && isTrayOpen)) && !selectionMode ? "!max-h-[300px] !opacity-100" : ""}`}
        >
          {host.online &&
            ((host.cpu != null && host.cpu > 0) ||
              (host.ram != null && host.ram > 0)) && (
              <div className="flex items-center gap-3 pl-3">
                {host.cpu != null && host.cpu > 0 && (
                  <div className="flex items-center gap-1">
                    <Cpu className="size-2.5 shrink-0 text-muted-foreground/30" />
                    <div className="w-9 h-[3px] bg-muted-foreground/15 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${host.cpu > 80 ? "bg-red-400" : host.cpu > 50 ? "bg-yellow-400" : "bg-accent-brand"}`}
                        style={{ width: `${host.cpu}%` }}
                      />
                    </div>
                    <span className="text-[9px] tabular-nums text-muted-foreground/40">
                      {host.cpu}%
                    </span>
                  </div>
                )}
                {host.ram != null && host.ram > 0 && (
                  <div className="flex items-center gap-1">
                    <MemoryStick className="size-2.5 shrink-0 text-muted-foreground/30" />
                    <div className="w-9 h-[3px] bg-muted-foreground/15 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${host.ram > 80 ? "bg-red-400" : host.ram > 60 ? "bg-yellow-400" : "bg-accent-brand/60"}`}
                        style={{ width: `${host.ram}%` }}
                      />
                    </div>
                    <span className="text-[9px] tabular-nums text-muted-foreground/40">
                      {host.ram}%
                    </span>
                  </div>
                )}
              </div>
            )}

          <div className="flex flex-col gap-0.5 pt-1.5 pl-2 pb-1">
            {/* Connection buttons — wrap naturally to a second line */}
            <div className="flex items-center flex-wrap gap-1">
              {getSshActions(host).map(({ type, icon: Icon, label }) => (
                <button
                  key={type}
                  title={label}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenTab(type);
                  }}
                  className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
                >
                  <Icon className="size-3.5" />
                </button>
              ))}
              {host.enableSsh &&
                (host.enableRdp || host.enableVnc || host.enableTelnet) &&
                getSshActions(host).length > 0 && (
                  <div className="w-px h-3.5 bg-border/60 mx-0.5 shrink-0" />
                )}
              {host.enableRdp && (
                <button
                  title="RDP"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenTab("rdp");
                  }}
                  className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
                >
                  <Monitor className="size-3.5" />
                </button>
              )}
              {host.enableVnc && (
                <button
                  title="VNC"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenTab("vnc");
                  }}
                  className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
                >
                  <MousePointerClick className="size-3.5" />
                </button>
              )}
              {host.enableTelnet && (
                <button
                  title="Telnet"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenTab("telnet");
                  }}
                  className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
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
                      await wakeOnLan(host.id);
                      toast.success(
                        t("hosts.wakeOnLanSuccess", { name: host.name }),
                      );
                    } catch {
                      toast.error(t("hosts.wakeOnLanError"));
                    }
                  }}
                  className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
                >
                  <Zap className="size-3.5" />
                </button>
              )}
            </div>

            {/* Separator + management buttons row — always fixed position */}
            <div className="flex items-center gap-1 pt-0.5 border-t border-border/40 mt-0.5">
              {onEditHost && (
                <button
                  title="Edit Host"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditHost();
                  }}
                  className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
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
                  className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
                >
                  <Share2 className="size-3.5" />
                </button>
              )}
              <DropdownMenu open={isMenuOpen} onOpenChange={onMenuOpenChange}>
                <DropdownMenuTrigger asChild>
                  <button
                    title="More options"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="text-xs">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(
                        `${host.username}@${host.ip}`,
                      );
                      toast.success(t("hosts.copiedToClipboard"));
                    }}
                  >
                    <Copy className="size-3.5 mr-2" />
                    {t("hosts.copyAddress")}
                  </DropdownMenuItem>
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
                            navigator.clipboard.writeText(
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
                            navigator.clipboard.writeText(
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
                            navigator.clipboard.writeText(
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
                            navigator.clipboard.writeText(
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
                            navigator.clipboard.writeText(
                              `${window.location.origin}?view=server-stats&hostId=${host.id}`,
                            );
                            toast.success(t("hosts.serverStatsUrlCopied"));
                          }}
                        >
                          <Server className="size-3.5 mr-2" />
                          {t("hosts.copyServerStatsUrlAction")}
                        </DropdownMenuItem>
                      )}
                      {host.enableRdp && (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(
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
                            navigator.clipboard.writeText(
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
                            navigator.clipboard.writeText(
                              `${window.location.origin}?view=telnet&hostId=${host.id}`,
                            );
                            toast.success(t("hosts.telnetUrlCopied"));
                          }}
                        >
                          <Terminal className="size-3.5 mr-2" />
                          {t("hosts.copyTelnetUrlAction")}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
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
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FolderItem({
  folder,
  depth = 0,
  onOpenTab,
  onEditHost,
  onShareHost,
  onDeleteHost,
  onDuplicateHost,
  query = "",
  stripeMap,
  openFolders,
  onToggleFolder,
  selectionMode,
  selectedHostIds,
  onToggleSelect,
  openMenuHostId,
  onMenuOpenChange,
  openTrayHostId,
  onTrayOpenChange,
}: {
  folder: HostFolder;
  depth?: number;
  onOpenTab: (host: Host, type: TabType) => void;
  onEditHost?: (host: Host) => void;
  onShareHost?: (host: Host) => void;
  onDeleteHost: (host: Host) => void;
  onDuplicateHost: (host: Host) => void;
  query?: string;
  stripeMap: Map<Host | HostFolder, number>;
  openFolders: Set<string>;
  onToggleFolder: (name: string) => void;
  selectionMode: boolean;
  selectedHostIds: Set<string>;
  onToggleSelect: (id: string) => void;
  openMenuHostId: string | null;
  onMenuOpenChange: (hostId: string | null) => void;
  openTrayHostId: string | null;
  onTrayOpenChange: (hostId: string | null) => void;
}) {
  const { total, online } = folderHostCount(folder);

  if (query && !folderHasMatch(folder, query)) return null;

  const isOpen = query ? true : openFolders.has(folder.name);
  const stripeIndex = stripeMap.get(folder) ?? 0;

  return (
    <div>
      <button
        onClick={() => !query && onToggleFolder(folder.name)}
        className={`flex items-center gap-2 w-full px-3 py-2 hover:bg-muted/50 transition-colors text-left cursor-pointer ${stripeIndex % 2 === 1 ? "bg-muted/20" : ""}`}
      >
        <ChevronRight
          className={`size-3 shrink-0 text-muted-foreground/50 transition-transform ${isOpen ? "rotate-90" : ""}`}
        />
        <FolderOpen
          className={`size-3.5 shrink-0 ${isOpen ? "text-accent-brand" : "text-muted-foreground/60"}`}
        />
        <span className="text-[13px] font-semibold text-foreground/80 truncate flex-1">
          {folder.name}
        </span>
        <span className="text-[10px] tabular-nums shrink-0 ml-1">
          {online > 0 && (
            <span className="text-accent-brand font-semibold">{online}</span>
          )}
          <span className="text-muted-foreground/40">/{total}</span>
        </span>
      </button>
      {isOpen && (
        <div className="border-l border-border/40 ml-[30px]">
          {folder.children.map((child, i) =>
            isFolder(child) ? (
              <FolderItem
                key={i}
                folder={child}
                depth={depth + 1}
                onOpenTab={onOpenTab}
                onEditHost={onEditHost}
                onShareHost={onShareHost}
                onDeleteHost={onDeleteHost}
                onDuplicateHost={onDuplicateHost}
                query={query}
                stripeMap={stripeMap}
                openFolders={openFolders}
                onToggleFolder={onToggleFolder}
                selectionMode={selectionMode}
                selectedHostIds={selectedHostIds}
                onToggleSelect={onToggleSelect}
                openMenuHostId={openMenuHostId}
                onMenuOpenChange={onMenuOpenChange}
                openTrayHostId={openTrayHostId}
                onTrayOpenChange={onTrayOpenChange}
              />
            ) : (
              <HostItem
                key={i}
                host={child}
                onOpenTab={(t) => onOpenTab(child, t)}
                onEditHost={onEditHost ? () => onEditHost(child) : undefined}
                onShareHost={onShareHost ? () => onShareHost(child) : undefined}
                onDelete={() => onDeleteHost(child)}
                onDuplicate={() => onDuplicateHost(child)}
                query={query}
                stripeIndex={stripeMap.get(child) ?? 0}
                selectionMode={selectionMode}
                selected={selectedHostIds.has(child.id)}
                onToggleSelect={() => onToggleSelect(child.id)}
                isMenuOpen={openMenuHostId === child.id}
                onMenuOpenChange={(open) =>
                  onMenuOpenChange(open ? child.id : null)
                }
                isTrayOpen={openTrayHostId === child.id}
                onTrayOpenChange={(open) =>
                  onTrayOpenChange(open ? child.id : null)
                }
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function SidebarTree({
  children,
  onOpenTab,
  onEditHost,
  onShareHost,
  query = "",
  selectionMode,
  onToggleSelectionMode,
  loading = false,
}: {
  children: (Host | HostFolder)[];
  onOpenTab: (host: Host, type: TabType) => void;
  onEditHost: (host: Host) => void;
  onShareHost?: (host: Host) => void;
  query?: string;
  selectionMode: boolean;
  onToggleSelectionMode: () => void;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [selectedHostIds, setSelectedHostIds] = useState<Set<string>>(
    new Set(),
  );
  const [openMenuHostId, setOpenMenuHostId] = useState<string | null>(null);
  const [openTrayHostId, setOpenTrayHostId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);

  function toggleFolder(name: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelectedHostIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleDeleteHost(host: Host) {
    setConfirmDialog({
      message: t("hosts.deleteHostConfirm", { name: host.name }),
      onConfirm: async () => {
        try {
          await deleteSSHHost(Number(host.id));
          window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
          toast.success(t("hosts.deletedCount", { count: 1 }));
        } catch {
          toast.error(t("hosts.failedToDeleteCount", { count: 1 }));
        }
      },
    });
  }

  async function handleDuplicateHost(host: Host) {
    try {
      await createSSHHost({
        name: `${host.name} (copy)`,
        ip: host.ip,
        port: host.port,
        username: host.username,
        folder: host.folder,
        tags: host.tags ?? [],
        pin: host.pin ?? false,
        notes: host.notes,
        macAddress: host.macAddress,
        authType: host.authType,
        password: host.password ?? null,
        keyPassword: host.keyPassword ?? null,
        keyType: host.keyType ?? null,
        credentialId: host.credentialId ? Number(host.credentialId) : null,
        overrideCredentialUsername: host.overrideCredentialUsername ?? false,
        enableSsh: host.enableSsh,
        enableRdp: host.enableRdp,
        enableVnc: host.enableVnc,
        enableTelnet: host.enableTelnet,
        enableTerminal: host.enableTerminal,
        enableTunnel: host.enableTunnel,
        enableFileManager: host.enableFileManager,
        enableDocker: host.enableDocker,
        sshPort: host.sshPort,
        rdpPort: host.rdpPort,
        vncPort: host.vncPort,
        telnetPort: host.telnetPort,
        rdpUser: host.rdpUser ?? null,
        rdpPassword: host.rdpPassword ?? null,
        rdpDomain: host.domain ?? null,
        rdpSecurity: host.security ?? null,
        rdpIgnoreCert: host.ignoreCert ?? false,
        vncPassword: host.vncPassword ?? null,
        vncUser: host.vncUser ?? null,
        telnetUser: host.telnetUser ?? null,
        telnetPassword: host.telnetPassword ?? null,
        defaultPath: host.defaultPath ?? "/",
        forceKeyboardInteractive: host.forceKeyboardInteractive ?? false,
        useSocks5: host.useSocks5,
        socks5Host: host.socks5Host ?? null,
        socks5Port: host.socks5Port ?? null,
        socks5Username: host.socks5Username ?? null,
        socks5Password: host.socks5Password ?? null,
        socks5ProxyChain: host.socks5ProxyChain ?? null,
        jumpHosts: (host.jumpHosts ?? []).map((j) => ({
          hostId: Number(j.hostId),
        })),
        portKnockSequence: host.portKnockSequence ?? [],
        tunnelConnections: host.serverTunnels ?? [],
        quickActions: (host.quickActions ?? []).map((a) => ({
          name: a.name,
          snippetId: Number(a.snippetId),
        })),
        statsConfig: host.statsConfig,
        guacamoleConfig: host.guacamoleConfig ?? null,
        terminalConfig: host.terminalConfig ?? null,
      } as any);
      window.dispatchEvent(new CustomEvent("termix:hosts-changed"));
      toast.success(t("hosts.duplicatedHost", { name: host.name }));
    } catch {
      toast.error(t("hosts.failedToDuplicateHost"));
    }
  }

  const allHosts = collectAllHosts(children);
  const allFolders = collectAllFolders(children);

  const visibleRows = collectVisibleRows(children, query, openFolders);
  const stripeMap = new Map<Host | HostFolder, number>(
    visibleRows.map((r, i) => [r.item, i]),
  );

  if (loading) {
    return (
      <div className="relative flex flex-col flex-1 min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1.5">
          {[28, 20, 24, 20, 28, 20].map((w, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 px-3 py-2 ${i % 2 === 1 ? "ml-4" : ""}`}
            >
              <div className="size-3 rounded-sm bg-muted/50 animate-pulse shrink-0" />
              <div
                className="h-3 rounded bg-muted/50 animate-pulse"
                style={{ width: `${w * 3}px` }}
              />
            </div>
          ))}
          <div className="flex items-center justify-center gap-2 pt-4 text-muted-foreground/40">
            <Loader2 className="size-3.5 animate-spin" />
            <span className="text-xs">{t("hosts.loadingHosts")}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {visibleRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <Server className="size-8 text-muted-foreground/20 mb-2" />
            <span className="text-sm font-semibold text-muted-foreground/60">
              {query ? t("hosts.noHostsMatchSearch") : t("hosts.noHostsYet")}
            </span>
          </div>
        ) : (
          children.map((child, i) =>
            isFolder(child) ? (
              <FolderItem
                key={i}
                folder={child}
                onOpenTab={onOpenTab}
                onEditHost={onEditHost}
                onShareHost={onShareHost}
                onDeleteHost={handleDeleteHost}
                onDuplicateHost={handleDuplicateHost}
                query={query}
                stripeMap={stripeMap}
                openFolders={openFolders}
                onToggleFolder={toggleFolder}
                selectionMode={selectionMode}
                selectedHostIds={selectedHostIds}
                onToggleSelect={toggleSelect}
                openMenuHostId={openMenuHostId}
                onMenuOpenChange={setOpenMenuHostId}
                openTrayHostId={openTrayHostId}
                onTrayOpenChange={setOpenTrayHostId}
              />
            ) : (
              <HostItem
                key={i}
                host={child}
                onOpenTab={(type) => onOpenTab(child, type)}
                onEditHost={() => onEditHost(child)}
                onShareHost={onShareHost ? () => onShareHost(child) : undefined}
                onDelete={() => handleDeleteHost(child)}
                onDuplicate={() => handleDuplicateHost(child)}
                query={query}
                stripeIndex={stripeMap.get(child) ?? 0}
                selectionMode={selectionMode}
                selected={selectedHostIds.has(child.id)}
                onToggleSelect={() => toggleSelect(child.id)}
                isMenuOpen={openMenuHostId === child.id}
                onMenuOpenChange={(open) =>
                  setOpenMenuHostId(open ? child.id : null)
                }
                isTrayOpen={openTrayHostId === child.id}
                onTrayOpenChange={(open) =>
                  setOpenTrayHostId(open ? child.id : null)
                }
              />
            ),
          )
        )}
      </div>

      {/* Floating selection bar */}
      {selectionMode && (
        <div className="absolute bottom-4 inset-x-3 z-50">
          <div className="bg-popover border border-border shadow-xl px-2.5 py-2 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold tabular-nums shrink-0">
              {t("hosts.nSelected", { count: selectedHostIds.size })}
            </span>
            <div className="w-px h-4 bg-border mx-0.5" />
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 hover:bg-muted rounded transition-colors"
              onClick={() => {
                if (selectedHostIds.size === allHosts.length)
                  setSelectedHostIds(new Set());
                else setSelectedHostIds(new Set(allHosts.map((h) => h.id)));
              }}
            >
              {selectedHostIds.size === allHosts.length
                ? t("hosts.deselectAll")
                : t("hosts.selectAll")}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 hover:bg-muted rounded transition-colors flex items-center gap-1 disabled:opacity-40"
                  disabled={selectedHostIds.size === 0}
                >
                  {t("hosts.featuresMenu")} <ChevronDown className="size-2.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="text-xs">
                {[
                  {
                    labelKey: "hosts.enableTerminalFeature",
                    field: "enableTerminal",
                    value: true,
                    icon: Terminal,
                  },
                  {
                    labelKey: "hosts.disableTerminalFeature",
                    field: "enableTerminal",
                    value: false,
                    icon: Terminal,
                  },
                  {
                    labelKey: "hosts.enableFilesFeature",
                    field: "enableFileManager",
                    value: true,
                    icon: FolderSearch,
                  },
                  {
                    labelKey: "hosts.disableFilesFeature",
                    field: "enableFileManager",
                    value: false,
                    icon: FolderSearch,
                  },
                  {
                    labelKey: "hosts.enableTunnelsFeature",
                    field: "enableTunnel",
                    value: true,
                    icon: Network,
                  },
                  {
                    labelKey: "hosts.disableTunnelsFeature",
                    field: "enableTunnel",
                    value: false,
                    icon: Network,
                  },
                  {
                    labelKey: "hosts.enableDockerFeature",
                    field: "enableDocker",
                    value: true,
                    icon: Box,
                  },
                  {
                    labelKey: "hosts.disableDockerFeature",
                    field: "enableDocker",
                    value: false,
                    icon: Box,
                  },
                ].map(({ labelKey, field, value, icon: Icon }) => (
                  <DropdownMenuItem
                    key={labelKey}
                    onClick={async () => {
                      const ids = Array.from(selectedHostIds).map(Number);
                      try {
                        await bulkUpdateSSHHosts(ids, { [field]: value });
                        window.dispatchEvent(
                          new CustomEvent("termix:hosts-changed"),
                        );
                        toast.success(
                          t("hosts.updatedCount", { count: ids.length }),
                        );
                      } catch {
                        toast.error(t("hosts.bulkUpdateFailed"));
                      }
                    }}
                  >
                    <Icon className="size-3.5 mr-2" />
                    {t(labelKey)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 hover:bg-muted rounded transition-colors flex items-center gap-1 disabled:opacity-40"
                  disabled={selectedHostIds.size === 0}
                >
                  {t("hosts.moveMenu")} <ChevronDown className="size-2.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="text-xs">
                <DropdownMenuItem
                  onClick={async () => {
                    const ids = Array.from(selectedHostIds).map(Number);
                    try {
                      await bulkUpdateSSHHosts(ids, { folder: "" });
                      window.dispatchEvent(
                        new CustomEvent("termix:hosts-changed"),
                      );
                      toast.success(t("hosts.movedToRoot"));
                    } catch {
                      toast.error(t("hosts.failedToMoveHosts"));
                    }
                  }}
                >
                  <FolderOpen className="size-3.5 mr-2" />
                  {t("hosts.noFolderOption")}
                </DropdownMenuItem>
                {allFolders.map((f) => (
                  <DropdownMenuItem
                    key={f}
                    onClick={async () => {
                      const ids = Array.from(selectedHostIds).map(Number);
                      try {
                        await bulkUpdateSSHHosts(ids, { folder: f });
                        window.dispatchEvent(
                          new CustomEvent("termix:hosts-changed"),
                        );
                        toast.success(t("hosts.movedToFolder", { folder: f }));
                      } catch {
                        toast.error(t("hosts.failedToMoveHosts"));
                      }
                    }}
                  >
                    <FolderOpen className="size-3.5 mr-2" />
                    {f}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              className="text-[10px] text-destructive hover:text-destructive px-1.5 py-1 hover:bg-destructive/10 rounded transition-colors disabled:opacity-40"
              disabled={selectedHostIds.size === 0}
              onClick={() => {
                setConfirmDialog({
                  message: t("hosts.deleteHostsConfirm", {
                    count: selectedHostIds.size,
                    plural: selectedHostIds.size !== 1 ? "s" : "",
                  }),
                  onConfirm: async () => {
                    const ids = Array.from(selectedHostIds);
                    const results = await Promise.allSettled(
                      ids.map((id) => deleteSSHHost(Number(id))),
                    );
                    const succeeded = results.filter(
                      (r) => r.status === "fulfilled",
                    ).length;
                    const failed = results.filter(
                      (r) => r.status === "rejected",
                    ).length;
                    setSelectedHostIds(new Set());
                    window.dispatchEvent(
                      new CustomEvent("termix:hosts-changed"),
                    );
                    if (succeeded > 0)
                      toast.success(
                        t("hosts.deletedCount", { count: succeeded }),
                      );
                    if (failed > 0)
                      toast.error(
                        t("hosts.failedToDeleteCount", { count: failed }),
                      );
                  },
                });
              }}
            >
              {t("hosts.deleteSelected")}
            </button>
            <div className="flex-1" />
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 hover:bg-muted rounded transition-colors"
              onClick={() => {
                onToggleSelectionMode();
                setSelectedHostIds(new Set());
              }}
            >
              {t("hosts.cancelSelection")}
            </button>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      {confirmDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-popover border border-border shadow-xl w-full max-w-xs flex flex-col gap-4 p-4">
            <p className="text-sm text-foreground">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-3 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
              >
                {t("hosts.cancelBtn")}
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                className="px-3 py-1.5 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded transition-colors"
              >
                {t("hosts.deleteConfirmBtn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
