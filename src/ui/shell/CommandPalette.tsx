import React, { useEffect, useRef, useState } from "react";
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
  Box,
  Globe,
  Plus,
  MessagesSquare,
  LifeBuoy,
  DollarSign,
  Search,
  Activity,
  Network,
  MoreHorizontal,
  Edit3,
  User,
  KeyRound,
  LayoutDashboard,
  Monitor,
  Clock,
} from "lucide-react";
import { Button } from "@/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import { getRecentActivity, type RecentActivityItem } from "@/main-axios";
import type { Host } from "@/types/ui-types";

interface CommandPaletteProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  hosts: Host[];
  onOpenTab: (type: any, label?: string, pendingEvent?: string) => void;
}

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  terminal: <Terminal className="size-3.5" />,
  file_manager: <FolderOpen className="size-3.5" />,
  server_stats: <Activity className="size-3.5" />,
  tunnel: <Network className="size-3.5" />,
  docker: <Box className="size-3.5" />,
  telnet: <Terminal className="size-3.5" />,
  vnc: <Monitor className="size-3.5" />,
  rdp: <Monitor className="size-3.5" />,
};

const ACTIVITY_TAB_TYPE: Record<string, string> = {
  terminal: "terminal",
  file_manager: "files",
  server_stats: "stats",
  tunnel: "tunnel",
  docker: "docker",
  telnet: "telnet",
  vnc: "vnc",
  rdp: "rdp",
};

export function CommandPalette({
  isOpen,
  setIsOpen,
  hosts,
  onOpenTab,
}: CommandPaletteProps) {
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
              placeholder="Search hosts, commands, or settings..."
              className="flex-1 h-12 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center gap-1.5 ml-2">
              <Kbd className="bg-muted/50 border-none h-6 px-2 text-[11px] rounded-none">
                ESC
              </Kbd>
            </div>
          </div>

          <CommandList className="max-h-[60vh] thin-scrollbar">
            <CommandGroup heading="Quick Actions" className="px-2">
              <CommandItem
                onSelect={() => handleAction(() => onOpenTab("host-manager"))}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-none hover:bg-accent-brand/10 cursor-pointer"
              >
                <div className="size-8 rounded-none bg-muted flex items-center justify-center group-hover:bg-accent-brand/20 transition-colors">
                  <LayoutDashboard className="size-4 text-accent-brand" />
                </div>
                <div className="flex flex-col flex-1">
                  <span className="text-sm font-semibold">Host Manager</span>
                  <span className="text-xs text-muted-foreground">
                    Manage, add, or edit hosts
                  </span>
                </div>
              </CommandItem>

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
                  <span className="text-sm font-semibold">Add New Host</span>
                  <span className="text-xs text-muted-foreground">
                    Register a new host
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
                  <span className="text-sm font-semibold">Admin Settings</span>
                  <span className="text-xs text-muted-foreground">
                    Configure system preferences and users
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
                  <span className="text-sm font-semibold">User Profile</span>
                  <span className="text-xs text-muted-foreground">
                    Manage your account and preferences
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
                  <span className="text-sm font-semibold">Add Credential</span>
                  <span className="text-xs text-muted-foreground">
                    Store SSH keys or passwords
                  </span>
                </div>
              </CommandItem>
            </CommandGroup>

            {recentActivity.length > 0 && (
              <>
                <CommandSeparator className="my-2" />
                <CommandGroup heading="Recent Activity" className="px-2">
                  {recentActivity.map((item) => (
                    <CommandItem
                      key={item.id}
                      onSelect={() =>
                        handleAction(() =>
                          onOpenTab(
                            ACTIVITY_TAB_TYPE[item.type] as any,
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

            <CommandGroup heading="Servers & Hosts" className="px-2">
              {filteredHosts.length > 0 ? (
                filteredHosts.map((host, i) => {
                  const actions = [
                    host.enableSsh &&
                      host.enableTerminal !== false && {
                        type: "terminal",
                        icon: <Terminal className="size-3" />,
                        label: "Terminal",
                      },
                    host.enableSsh &&
                      host.enableFileManager && {
                        type: "files",
                        icon: <FolderOpen className="size-3" />,
                        label: "Files",
                      },
                    host.enableSsh &&
                      host.enableDocker && {
                        type: "docker",
                        icon: <Box className="size-3" />,
                        label: "Docker",
                      },
                    host.enableSsh &&
                      host.enableTunnel && {
                        type: "tunnel",
                        icon: <Network className="size-3" />,
                        label: "Tunnels",
                      },
                    host.enableSsh && {
                      type: "stats",
                      icon: <Activity className="size-3" />,
                      label: "Stats",
                    },
                    host.enableRdp && {
                      type: "rdp",
                      icon: <Monitor className="size-3" />,
                      label: "RDP",
                    },
                    host.enableVnc && {
                      type: "vnc",
                      icon: <Monitor className="size-3" />,
                      label: "VNC",
                    },
                    host.enableTelnet && {
                      type: "telnet",
                      icon: <Terminal className="size-3" />,
                      label: "Telnet",
                    },
                  ].filter(Boolean) as {
                    type: string;
                    icon: React.ReactNode;
                    label: string;
                  }[];

                  return (
                    <CommandItem
                      key={i}
                      onSelect={() =>
                        handleAction(() => onOpenTab("terminal", host.name))
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
                        {actions.map((action) => (
                          <Button
                            key={action.type}
                            variant="ghost"
                            size="icon"
                            title={action.label}
                            className="size-7 rounded-none hover:bg-accent-brand/20 hover:text-accent-brand"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAction(() =>
                                onOpenTab(action.type as any, host.name),
                              );
                            }}
                          >
                            {action.icon}
                          </Button>
                        ))}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 rounded-none hover:bg-muted"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreHorizontal className="size-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="rounded-none border-border bg-card w-40"
                          >
                            <DropdownMenuItem
                              className="rounded-none text-xs font-semibold hover:bg-accent-brand/10 hover:text-accent-brand cursor-pointer"
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
                            >
                              <Edit3 className="size-3.5 mr-2" /> Edit Host
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CommandItem>
                  );
                })
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No hosts found matching &ldquo;{search}&rdquo;
                </div>
              )}
            </CommandGroup>

            <CommandSeparator className="my-2" />

            <CommandGroup heading="Links" className="px-2">
              <div className="grid grid-cols-2 gap-1">
                <CommandItem
                  onSelect={() => window.open("https://github.com", "_blank")}
                  className="flex items-center gap-3 px-3 py-2 rounded-none hover:bg-accent-brand/10 cursor-pointer"
                >
                  <Globe className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">GitHub</span>
                </CommandItem>
                <CommandItem
                  onSelect={() => window.open("https://discord.com", "_blank")}
                  className="flex items-center gap-3 px-3 py-2 rounded-none hover:bg-accent-brand/10 cursor-pointer"
                >
                  <MessagesSquare className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Discord</span>
                </CommandItem>
                <CommandItem className="flex items-center gap-3 px-3 py-2 rounded-none hover:bg-accent-brand/10 cursor-pointer">
                  <LifeBuoy className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Support</span>
                </CommandItem>
                <CommandItem className="flex items-center gap-3 px-3 py-2 rounded-none hover:bg-accent-brand/10 cursor-pointer">
                  <DollarSign className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Donate</span>
                </CommandItem>
              </div>
            </CommandGroup>
          </CommandList>

          <div className="border-t border-border px-4 py-3 bg-muted/30 flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Kbd className="h-5 px-1 bg-background rounded-none">↑↓</Kbd>
                <span>Navigate</span>
              </div>
              <div className="flex items-center gap-1">
                <Kbd className="h-5 px-1 bg-background rounded-none">ENTER</Kbd>
                <span>Select</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span>Toggle with</span>
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
