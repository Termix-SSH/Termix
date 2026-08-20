import React, { useEffect, useRef, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/kbd";
import {
  Command,
  CommandItem,
  CommandList,
  CommandGroup,
  CommandSeparator,
} from "@/components/command";
import {
  Server,
  Settings,
  Terminal,
  FolderOpen,
  FolderSearch,
  Box,
  Globe,
  HardDrive,
  Plus,
  MessagesSquare,
  LifeBuoy,
  Search,
  Activity,
  Network,
  User,
  KeyRound,
  Layers, // --- tmux-monitor ---
  Monitor,
  MousePointerClick,
  Clock,
  Folder,
  Pencil,
  Play,
  Clipboard,
} from "lucide-react";
import {
  getRecentActivity,
  getSnippets,
  type RecentActivityItem,
} from "@/main-axios";
import type { Host, TabType, Tab, Snippet } from "@/types/ui-types";
import { canEditHost } from "@/sidebar/host-permissions";
import { RAIL_ITEMS, RAIL_UTILITY_ITEMS } from "@/sidebar/rail-items";
import { useAiAvailability } from "@/hooks/use-ai-availability";
import { useSnippetRunner } from "@/hooks/use-snippet-runner.tsx";

interface CommandPaletteProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  hosts: Host[];
  terminalTabs?: Tab[];
  activeTabId?: string;
  onOpenTab: (type: TabType, label?: string, pendingEvent?: string) => void;
  /** Opens a sidebar panel. Kept separate from onOpenTab, which is TabType-shaped. */
  onOpenPanel?: (view: string) => void;
}

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  terminal: <Terminal className="size-3.5" />,
  file_manager: <FolderOpen className="size-3.5" />,
  server_stats: <Activity className="size-3.5" />,
  tunnel: <Network className="size-3.5" />,
  docker: <Box className="size-3.5" />,
  telnet: <MessagesSquare className="size-3.5" />,
  vnc: <MousePointerClick className="size-3.5" />,
  rdp: <Monitor className="size-3.5" />,
};

const ACTIVITY_TAB_TYPE: Record<string, TabType> = {
  terminal: "terminal",
  file_manager: "files",
  server_stats: "host-metrics",
  tunnel: "tunnel",
  docker: "docker",
  telnet: "telnet",
  vnc: "vnc",
  rdp: "rdp",
};

function getSshActions(host: Host): {
  type: TabType;
  icon: React.ElementType;
  label: string;
}[] {
  const metricsEnabled = host.statsConfig?.metricsEnabled !== false;
  return [
    host.enableTerminal !== false && {
      type: "terminal",
      icon: Terminal,
      label: "Terminal",
    },
    host.enableFileManager && {
      type: "files",
      icon: FolderSearch,
      label: "Files",
    },
    host.enableDocker && { type: "docker", icon: Box, label: "Docker" },
    // --- tmux-monitor --- opt-in per host, off by default
    host.enableTerminal !== false &&
      host.enableTmuxMonitor && {
        type: "tmux_monitor",
        icon: Layers,
        label: "Tmux Monitor",
      },
    host.enableTunnel && { type: "tunnel", icon: Network, label: "Tunnels" },
    metricsEnabled && {
      type: "host-metrics",
      icon: Activity,
      label: "Host Metrics",
    },
    host.enableProxmoxStats === true && {
      type: "proxmox-stats",
      icon: HardDrive,
      label: "Proxmox Stats",
    },
  ].filter(Boolean) as {
    type: TabType;
    icon: React.ElementType;
    label: string;
  }[];
}

export function CommandPalette({
  isOpen,
  setIsOpen,
  hosts,
  terminalTabs = [],
  activeTabId = "",
  onOpenTab,
  onOpenPanel,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const { globallyEnabled: aiGloballyEnabled } = useAiAvailability();
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>(
    [],
  );
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const { runSnippet, dialog: runSnippetDialog } = useSnippetRunner();

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSearch("");
      getRecentActivity(5)
        .then(setRecentActivity)
        .catch(() => {});
      getSnippets()
        .then((data) => setSnippets((data ?? []) as unknown as Snippet[]))
        .catch(() => {});
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, setIsOpen]);

  const filteredHosts = hosts.filter((h) => {
    const query = search.toLowerCase();
    return (
      h.name.toLowerCase().includes(query) ||
      h.ip.toLowerCase().includes(query) ||
      h.username.toLowerCase().includes(query) ||
      h.tags?.some((tag) => tag.toLowerCase().includes(query))
    );
  });

  // Group hosts by folder; ungrouped hosts appear first under an implicit root group
  const groupedHosts: { folder: string | null; hosts: Host[] }[] = [];
  const folderMap = new Map<string, Host[]>();
  const ungrouped: Host[] = [];
  for (const h of filteredHosts) {
    if (h.folder) {
      if (!folderMap.has(h.folder)) folderMap.set(h.folder, []);
      folderMap.get(h.folder)!.push(h);
    } else {
      ungrouped.push(h);
    }
  }
  if (ungrouped.length > 0)
    groupedHosts.push({ folder: null, hosts: ungrouped });
  for (const [folder, fhosts] of folderMap) {
    groupedHosts.push({ folder, hosts: fhosts });
  }

  const filteredSnippets = search.trim()
    ? snippets.filter((s) => {
        const query = search.toLowerCase();
        return (
          s.name.toLowerCase().includes(query) ||
          s.content.toLowerCase().includes(query)
        );
      })
    : [];

  const activeTargetTab =
    terminalTabs.find((tab) => tab.id === activeTabId) ?? terminalTabs[0];

  const handleAction = (action: () => void) => {
    action();
    setIsOpen(false);
  };
  const showHostResultsFirst = search.trim().length > 0;

  // Closing the palette unmounts this component (AppShell only renders it
  // while commandPaletteOpen is true), so keep rendering just the variables
  // dialog after close if a snippet run is still pending its inputs.
  if (!isOpen) return runSnippetDialog;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-background/40 backdrop-blur-sm transition-all duration-200 animate-in fade-in",
      )}
      onClick={() => setIsOpen(false)}
    >
      <div
        className={cn(
          "w-full max-w-2xl mx-4 overflow-hidden rounded-none border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-200",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <Command className="rounded-none" shouldFilter={false} loop>
          <div className="flex items-center border-b border-border px-4 py-1">
            <Search className="size-4 text-muted-foreground mr-3" />
            <CommandPrimitive.Input
              ref={inputRef}
              value={search}
              onValueChange={setSearch}
              placeholder={t("commandPalette.searchPlaceholder")}
              className="flex-1 h-12 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center gap-1.5 ml-2">
              <Kbd className="bg-muted/50 border-none h-6 px-2 text-[11px] rounded-none">
                ESC
              </Kbd>
            </div>
          </div>

          <CommandList className="max-h-[60vh] thin-scrollbar flex flex-col">
            <CommandGroup
              heading={t("commandPalette.quickActions")}
              className="px-2"
            >
              {window.electronAPI?.isElectron && (
                <CommandItem
                  value="quick-action-local-terminal"
                  onSelect={() =>
                    handleAction(() => onOpenTab("local-terminal"))
                  }
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-none hover:bg-accent-brand/10 cursor-pointer"
                >
                  <div className="size-8 rounded-none bg-muted flex items-center justify-center group-hover:bg-accent-brand/20 transition-colors">
                    <Terminal className="size-4 text-accent-brand" />
                  </div>
                  <div className="flex flex-col flex-1">
                    <span className="text-sm font-semibold">
                      {t("commandPalette.localTerminal")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t("commandPalette.localTerminalDesc")}
                    </span>
                  </div>
                </CommandItem>
              )}
              <CommandItem
                value="quick-action-add-host"
                onSelect={() =>
                  handleAction(() =>
                    onOpenTab(
                      "host-manager",
                      undefined,
                      "host-manager:add-host",
                    ),
                  )
                }
                className="group flex items-center gap-3 px-3 py-2.5 rounded-none hover:bg-accent-brand/10 cursor-pointer"
              >
                <div className="size-8 rounded-none bg-muted flex items-center justify-center group-hover:bg-accent-brand/20 transition-colors">
                  <Plus className="size-4 text-accent-brand" />
                </div>
                <div className="flex flex-col flex-1">
                  <span className="text-sm font-semibold">
                    {t("commandPalette.addNewHost")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("commandPalette.addNewHostDesc")}
                  </span>
                </div>
              </CommandItem>

              <CommandItem
                value="quick-action-admin-settings"
                onSelect={() => handleAction(() => onOpenTab("admin-settings"))}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-none hover:bg-accent-brand/10 cursor-pointer"
              >
                <div className="size-8 rounded-none bg-muted flex items-center justify-center group-hover:bg-accent-brand/20 transition-colors">
                  <Settings className="size-4 text-accent-brand" />
                </div>
                <div className="flex flex-col flex-1">
                  <span className="text-sm font-semibold">
                    {t("commandPalette.adminSettings")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("commandPalette.adminSettingsDesc")}
                  </span>
                </div>
              </CommandItem>

              <CommandItem
                value="quick-action-user-profile"
                onSelect={() => handleAction(() => onOpenTab("user-profile"))}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-none hover:bg-accent-brand/10 cursor-pointer"
              >
                <div className="size-8 rounded-none bg-muted flex items-center justify-center group-hover:bg-accent-brand/20 transition-colors">
                  <User className="size-4 text-accent-brand" />
                </div>
                <div className="flex flex-col flex-1">
                  <span className="text-sm font-semibold">
                    {t("commandPalette.userProfile")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("commandPalette.userProfileDesc")}
                  </span>
                </div>
              </CommandItem>

              <CommandItem
                value="quick-action-add-credential"
                onSelect={() =>
                  handleAction(() =>
                    onOpenTab(
                      "host-manager",
                      undefined,
                      "host-manager:add-credential",
                    ),
                  )
                }
                className="group flex items-center gap-3 px-3 py-2.5 rounded-none hover:bg-accent-brand/10 cursor-pointer"
              >
                <div className="size-8 rounded-none bg-muted flex items-center justify-center group-hover:bg-accent-brand/20 transition-colors">
                  <KeyRound className="size-4 text-accent-brand" />
                </div>
                <div className="flex flex-col flex-1">
                  <span className="text-sm font-semibold">
                    {t("commandPalette.addCredential")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("commandPalette.addCredentialDesc")}
                  </span>
                </div>
              </CommandItem>
            </CommandGroup>

            {onOpenPanel && (
              <>
                <CommandSeparator className="my-2" />
                <CommandGroup
                  heading={t("commandPalette.navigation")}
                  className="px-2"
                >
                  {[...RAIL_ITEMS, ...RAIL_UTILITY_ITEMS]
                    .filter((item) => item.kind !== "tab")
                    .filter((item) => item.id !== "ai" || aiGloballyEnabled)
                    .map((item) => {
                      const Icon = item.icon;
                      return (
                        <CommandItem
                          key={`nav-${item.id}`}
                          value={`nav-${item.id} ${t(item.labelKey)}`}
                          onSelect={() =>
                            handleAction(() => onOpenPanel(item.id))
                          }
                          className="group flex items-center gap-3 px-3 py-2.5 rounded-none hover:bg-accent-brand/10 cursor-pointer"
                        >
                          <div className="size-8 rounded-none bg-muted flex items-center justify-center group-hover:bg-accent-brand/20 transition-colors">
                            <Icon className="size-4 text-accent-brand" />
                          </div>
                          <span className="text-sm font-semibold flex-1">
                            {t(item.labelKey)}
                          </span>
                        </CommandItem>
                      );
                    })}
                </CommandGroup>
              </>
            )}

            {filteredSnippets.length > 0 && (
              <>
                <CommandSeparator className="my-2" />
                <CommandGroup
                  heading={t("commandPalette.snippets")}
                  className="px-2"
                >
                  {filteredSnippets.map((snippet) => (
                    <CommandItem
                      key={snippet.id}
                      value={`snippet-${snippet.id}`}
                      onSelect={() => {
                        if (!activeTargetTab) return;
                        handleAction(() =>
                          runSnippet(snippet, [activeTargetTab]),
                        );
                      }}
                      className={cn(
                        "group flex items-center gap-3 px-3 py-2.5 rounded-none hover:bg-accent-brand/10 cursor-pointer",
                        !activeTargetTab && "pointer-events-none opacity-50",
                      )}
                    >
                      <div className="size-8 rounded-none bg-muted flex items-center justify-center group-hover:bg-accent-brand/20 transition-colors shrink-0">
                        {snippet.isNote ? (
                          <Clipboard className="size-4 text-accent-brand" />
                        ) : (
                          <Play className="size-4 text-accent-brand" />
                        )}
                      </div>
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-sm font-semibold truncate">
                          {snippet.name}
                        </span>
                        <span className="text-xs text-muted-foreground truncate font-mono">
                          {snippet.content}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground/60 shrink-0">
                        {activeTargetTab
                          ? t("commandPalette.runSnippetDesc")
                          : t("newUi.sidebar.snippets.noTerminalTabsOpen")}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {recentActivity.length > 0 && (
              <>
                <CommandSeparator className="my-2" />
                <CommandGroup
                  heading={t("commandPalette.recentActivity")}
                  className="px-2"
                >
                  {recentActivity.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`recent-activity-${item.id}`}
                      onSelect={() =>
                        handleAction(() =>
                          onOpenTab(
                            ACTIVITY_TAB_TYPE[item.type],
                            item.hostName,
                          ),
                        )
                      }
                      className="group flex items-center gap-3 px-3 py-2 rounded-none hover:bg-accent-brand/10 cursor-pointer"
                    >
                      <div className="size-7 rounded-none bg-muted flex items-center justify-center group-hover:bg-accent-brand/20 transition-colors text-muted-foreground group-hover:text-accent-brand">
                        {ACTIVITY_ICONS[item.type]}
                      </div>
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-sm font-semibold truncate">
                          {item.hostName}
                        </span>
                        <span className="text-xs text-muted-foreground capitalize">
                          {item.type.replace("_", " ")}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground/50">
                        <Clock className="size-3" />
                        <span className="text-[10px]">
                          {new Date(item.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            <div className={cn(showHostResultsFirst && "order-first")}>
              {!showHostResultsFirst && <CommandSeparator className="my-2" />}

              <CommandGroup
                heading={t("commandPalette.serversAndHosts")}
                className="px-2"
              >
                {filteredHosts.length > 0 ? (
                  groupedHosts.map(({ folder, hosts: groupHosts }) => (
                    <div key={folder ?? "__root__"}>
                      {folder && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wide">
                          <Folder className="size-3" />
                          {folder}
                        </div>
                      )}
                      {groupHosts.map((host, i) => (
                        <CommandItem
                          key={i}
                          value={`host-${host.id}`}
                          onSelect={() =>
                            handleAction(() => {
                              const type = host.enableSsh
                                ? "terminal"
                                : host.enableRdp
                                  ? "rdp"
                                  : host.enableVnc
                                    ? "vnc"
                                    : host.enableTelnet
                                      ? "telnet"
                                      : "terminal";
                              onOpenTab(type, host.name);
                            })
                          }
                          className="group flex items-center gap-3 px-3 py-2.5 rounded-none hover:bg-accent-brand/10 cursor-pointer"
                        >
                          <div className="size-8 rounded-none bg-muted flex items-center justify-center group-hover:bg-accent-brand/20 transition-colors shrink-0">
                            <Server
                              className={cn(
                                "size-4",
                                host.online
                                  ? "text-accent-brand"
                                  : "text-muted-foreground",
                              )}
                            />
                          </div>
                          <div className="flex flex-col flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold truncate">
                                {host.name}
                              </span>
                              {host.isShared && (
                                <span className="text-[9px] px-1 py-px border border-accent-brand/30 bg-accent-brand/10 text-accent-brand shrink-0 leading-none uppercase tracking-wider">
                                  {t("hosts.sharing.sharedBadge")}
                                </span>
                              )}
                              {host.online && (
                                <span className="size-1.5 rounded-full bg-accent-brand animate-pulse shrink-0" />
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground font-mono">
                              {host.username}@{host.ip}
                            </span>
                          </div>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {host.enableSsh &&
                              getSshActions(host).map(
                                ({ type, icon: Icon, label }) => (
                                  <button
                                    key={type}
                                    title={label}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAction(() =>
                                        onOpenTab(type, host.name),
                                      );
                                    }}
                                    className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
                                  >
                                    <Icon className="size-3.5" />
                                  </button>
                                ),
                              )}
                            {host.enableSsh &&
                              (host.enableRdp ||
                                host.enableVnc ||
                                host.enableTelnet) && (
                                <div className="w-px h-3.5 bg-border/60 mx-0.5 shrink-0" />
                              )}
                            {host.enableRdp && (
                              <button
                                title="RDP"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction(() =>
                                    onOpenTab("rdp", host.name),
                                  );
                                }}
                                className="flex items-center gap-1 px-2 h-6 rounded text-xs font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted-foreground/10 transition-colors border border-border/40"
                              >
                                <Monitor className="size-3" />
                                RDP
                              </button>
                            )}
                            {host.enableVnc && (
                              <button
                                title="VNC"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction(() =>
                                    onOpenTab("vnc", host.name),
                                  );
                                }}
                                className="flex items-center gap-1 px-2 h-6 rounded text-xs font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted-foreground/10 transition-colors border border-border/40"
                              >
                                <MousePointerClick className="size-3" />
                                VNC
                              </button>
                            )}
                            {host.enableTelnet && (
                              <button
                                title="Telnet"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction(() =>
                                    onOpenTab("telnet", host.name),
                                  );
                                }}
                                className="flex items-center gap-1 px-2 h-6 rounded text-xs font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted-foreground/10 transition-colors border border-border/40"
                              >
                                <Terminal className="size-3" />
                                Telnet
                              </button>
                            )}
                            {canEditHost(host) && (
                              <>
                                <div className="w-px h-3.5 bg-border/60 mx-0.5 shrink-0" />
                                <button
                                  title="Edit Host"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setIsOpen(false);
                                    onOpenTab("host-manager");
                                    setTimeout(() => {
                                      window.dispatchEvent(
                                        new CustomEvent(
                                          "host-manager:edit-host",
                                          {
                                            detail: host.id,
                                          },
                                        ),
                                      );
                                    }, 100);
                                  }}
                                  className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </div>
                  ))
                ) : (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {t("commandPalette.noHostsFound", { search })}
                  </div>
                )}
              </CommandGroup>
            </div>

            <CommandSeparator className="my-2" />

            <CommandGroup heading={t("commandPalette.links")} className="px-2">
              <div className="grid grid-cols-3 gap-1">
                <CommandItem
                  value="link-github"
                  onSelect={() =>
                    window.open(
                      "https://github.com/Termix-SSH/Termix",
                      "_blank",
                    )
                  }
                  className="flex items-center gap-3 px-3 py-2 rounded-none hover:bg-accent-brand/10 cursor-pointer"
                >
                  <Globe className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">GitHub</span>
                </CommandItem>
                <CommandItem
                  value="link-discord"
                  onSelect={() =>
                    window.open(
                      "https://discord.com/invite/jVQGdvHDrf",
                      "_blank",
                    )
                  }
                  className="flex items-center gap-3 px-3 py-2 rounded-none hover:bg-accent-brand/10 cursor-pointer"
                >
                  <MessagesSquare className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Discord</span>
                </CommandItem>
                <CommandItem
                  value="link-support"
                  onSelect={() =>
                    window.open(
                      "https://github.com/Termix-SSH/Support/issues/new",
                      "_blank",
                    )
                  }
                  className="flex items-center gap-3 px-3 py-2 rounded-none hover:bg-accent-brand/10 cursor-pointer"
                >
                  <LifeBuoy className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Support</span>
                </CommandItem>
              </div>
            </CommandGroup>
          </CommandList>

          <div className="border-t border-border px-4 py-3 bg-muted/30 flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Kbd className="h-5 px-1 bg-background rounded-none">↑↓</Kbd>
                <span>{t("commandPalette.navigate")}</span>
              </div>
              <div className="flex items-center gap-1">
                <Kbd className="h-5 px-1 bg-background rounded-none">ENTER</Kbd>
                <span>{t("commandPalette.select")}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span>{t("commandPalette.toggleWith")}</span>
              <Kbd className="h-5 px-1.5 bg-background rounded-none">Ctrl</Kbd>
              <span>+</span>
              <Kbd className="h-5 px-1.5 bg-background rounded-none">K</Kbd>
              <span>{t("commandPalette.orShortcut")}</span>
              <Kbd className="h-5 px-1.5 bg-background rounded-none">Shift</Kbd>
              <span>+</span>
              <Kbd className="h-5 px-1.5 bg-background rounded-none">Shift</Kbd>
            </div>
          </div>
        </Command>
      </div>

      {runSnippetDialog}
    </div>
  );
}
