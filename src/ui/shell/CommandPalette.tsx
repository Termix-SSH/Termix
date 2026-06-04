import React, { useEffect, useRef, useState } from "react";
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
  Plus,
  MessagesSquare,
  LifeBuoy,
  Search,
  Activity,
  Network,
  User,
  KeyRound,
  Monitor,
  MousePointerClick,
  Clock,
  Folder,
  Pencil,
} from "lucide-react";
import { getRecentActivity, type RecentActivityItem } from "@/main-axios";
import type { Host, TabType } from "@/types/ui-types";

interface CommandPaletteProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  hosts: Host[];
  onOpenTab: (type: TabType, label?: string, pendingEvent?: string) => void;
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
  server_stats: "stats",
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
    host.enableTunnel && { type: "tunnel", icon: Network, label: "Tunnels" },
    metricsEnabled && { type: "stats", icon: Activity, label: "Stats" },
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
  onOpenTab,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>(
    [],
  );

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSearch("");
      getRecentActivity(5)
        .then(setRecentActivity)
        .catch(() => {});
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setIsOpen]);

  const filteredHosts = hosts.filter(
    (h) =>
      h.name.toLowerCase().includes(search.toLowerCase()) ||
      h.ip.toLowerCase().includes(search.toLowerCase()) ||
      h.username.toLowerCase().includes(search.toLowerCase()),
  );

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

  const handleAction = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  if (!isOpen) return null;

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
        <Command className="rounded-none">
          <div className="flex items-center border-b border-border px-4 py-1">
            <Search className="size-4 text-muted-foreground mr-3" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("commandPalette.searchPlaceholder")}
              className="flex-1 h-12 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center gap-1.5 ml-2">
              <Kbd className="bg-muted/50 border-none h-6 px-2 text-[11px] rounded-none">
                ESC
              </Kbd>
            </div>
          </div>

          <CommandList className="max-h-[60vh] thin-scrollbar">
            <CommandGroup
              heading={t("commandPalette.quickActions")}
              className="px-2"
            >
              <CommandItem
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

            <CommandSeparator className="my-2" />

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
                                handleAction(() => onOpenTab("rdp", host.name));
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
                                handleAction(() => onOpenTab("vnc", host.name));
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
                          <div className="w-px h-3.5 bg-border/60 mx-0.5 shrink-0" />
                          <button
                            title="Edit Host"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsOpen(false);
                              onOpenTab("host-manager");
                              setTimeout(() => {
                                window.dispatchEvent(
                                  new CustomEvent("host-manager:edit-host", {
                                    detail: host.id,
                                  }),
                                );
                              }, 100);
                            }}
                            className="flex items-center justify-center size-7 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted-foreground/10 transition-colors"
                          >
                            <Pencil className="size-3.5" />
                          </button>
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

            <CommandSeparator className="my-2" />

            <CommandGroup heading={t("commandPalette.links")} className="px-2">
              <div className="grid grid-cols-3 gap-1">
                <CommandItem
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
              <Kbd className="h-5 px-1.5 bg-background rounded-none">Shift</Kbd>
              <span>+</span>
              <Kbd className="h-5 px-1.5 bg-background rounded-none">Shift</Kbd>
            </div>
          </div>
        </Command>
      </div>
    </div>
  );
}
