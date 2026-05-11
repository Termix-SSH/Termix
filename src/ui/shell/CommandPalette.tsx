import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/kbd";
import {
  Command,
  CommandInput,
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
} from "lucide-react";
import { Button } from "@/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";

type Host = {
  name: string;
  user: string;
  address: string;
  online: boolean;
  cpu: number;
  ram: number;
  lastAccess: string;
  tags?: string[];
  enableTerminal?: boolean;
  enableFileManager?: boolean;
  enableDocker?: boolean;
  enableTunnel?: boolean;
};

interface CommandPaletteProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  hosts: Host[];
  onOpenTab: (type: any, label?: string, pendingEvent?: string) => void;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  Terminal: <Terminal className="size-3" />,
  Files: <FolderOpen className="size-3" />,
  Docker: <Box className="size-3" />,
  Stats: <Activity className="size-3" />,
  Tunnels: <Network className="size-3" />,
};

const ACTION_TAB_TYPE: Record<string, string> = {
  Terminal: "terminal",
  Files: "files",
  Docker: "docker",
  Stats: "stats",
  Tunnels: "tunnel",
};

export function CommandPalette({
  isOpen,
  setIsOpen,
  hosts,
  onOpenTab,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSearch("");
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
      h.ip.toLowerCase().includes(search.toLowerCase()),
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

            <CommandSeparator className="my-2" />

            <CommandGroup heading="Servers & Hosts" className="px-2">
              {filteredHosts.length > 0 ? (
                filteredHosts.map((host, i) => {
                  const actions = [
                    host.enableTerminal !== false && "Terminal",
                    host.enableFileManager !== false && "Files",
                    host.enableDocker && "Docker",
                    host.enableTunnel && "Tunnels",
                    "Stats",
                  ].filter(Boolean) as string[];

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
                          {host.ip}
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {actions.map((action) => (
                          <Button
                            key={action}
                            variant="ghost"
                            size="icon"
                            title={action}
                            className="size-7 rounded-none hover:bg-accent-brand/20 hover:text-accent-brand"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAction(() =>
                                onOpenTab(
                                  ACTION_TAB_TYPE[action] as any,
                                  host.name,
                                ),
                              );
                            }}
                          >
                            {ACTION_ICONS[action]}
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
                                handleAction(() => onOpenTab("host-manager"));
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
                  No hosts found matching "{search}"
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
