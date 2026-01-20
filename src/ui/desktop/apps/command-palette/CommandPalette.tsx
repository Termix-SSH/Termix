import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  CommandGroup,
  CommandSeparator,
} from "@/components/ui/command.tsx";
import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  Key,
  Server,
  Settings,
  User,
  Github,
  Terminal,
  FolderOpen,
  Pencil,
  EllipsisVertical,
  ArrowDownUp,
  Container,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { BiMoney, BiSupport } from "react-icons/bi";
import { BsDiscord } from "react-icons/bs";
import { GrUpdate } from "react-icons/gr";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { getRecentActivity, getSSHHosts } from "@/ui/main-axios.ts";
import type { RecentActivityItem } from "@/ui/main-axios.ts";
import { DEFAULT_STATS_CONFIG } from "@/types/stats-widgets";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button.tsx";
import { ButtonGroup } from "@/components/ui/button-group.tsx";

interface SSHHost {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  folder: string;
  tags: string[];
  pin: boolean;
  authType: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  enableTerminal: boolean;
  enableTunnel: boolean;
  enableFileManager: boolean;
  enableDocker: boolean;
  defaultPath: string;
  tunnelConnections: unknown[];
  statsConfig?: string;
  createdAt: string;
  updatedAt: string;
}

export function CommandPalette({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const { addTab, setCurrentTab, tabs: tabList, updateTab } = useTabs();
  const [recentActivity, setRecentActivity] = useState<RecentActivityItem[]>(
    [],
  );
  const [hosts, setHosts] = useState<SSHHost[]>([]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      getRecentActivity(50).then((activity) => {
        setRecentActivity(activity.slice(0, 5));
      });
      getSSHHosts().then((allHosts) => {
        setHosts(allHosts);
      });
    }
  }, [isOpen]);

  const handleAddHost = () => {
    const sshManagerTab = tabList.find((t) => t.type === "ssh_manager");
    if (sshManagerTab) {
      updateTab(sshManagerTab.id, {
        initialTab: "add_host",
        hostConfig: undefined,
      });
      setCurrentTab(sshManagerTab.id);
    } else {
      const id = addTab({
        type: "ssh_manager",
        title: t("commandPalette.hostManager"),
        initialTab: "add_host",
      });
      setCurrentTab(id);
    }
    setIsOpen(false);
  };

  const handleAddCredential = () => {
    const sshManagerTab = tabList.find((t) => t.type === "ssh_manager");
    if (sshManagerTab) {
      updateTab(sshManagerTab.id, {
        initialTab: "add_credential",
        hostConfig: undefined,
      });
      setCurrentTab(sshManagerTab.id);
    } else {
      const id = addTab({
        type: "ssh_manager",
        title: t("commandPalette.hostManager"),
        initialTab: "add_credential",
      });
      setCurrentTab(id);
    }
    setIsOpen(false);
  };

  const handleOpenAdminSettings = () => {
    const adminTab = tabList.find((t) => t.type === "admin");
    if (adminTab) {
      setCurrentTab(adminTab.id);
    } else {
      const id = addTab({
        type: "admin",
        title: t("commandPalette.adminSettings"),
      });
      setCurrentTab(id);
    }
    setIsOpen(false);
  };

  const handleOpenUserProfile = () => {
    const userProfileTab = tabList.find((t) => t.type === "user_profile");
    if (userProfileTab) {
      setCurrentTab(userProfileTab.id);
    } else {
      const id = addTab({
        type: "user_profile",
        title: t("commandPalette.userProfile"),
      });
      setCurrentTab(id);
    }
    setIsOpen(false);
  };

  const handleOpenUpdateLog = () => {
    window.open("https://github.com/Termix-SSH/Termix/releases", "_blank");
    setIsOpen(false);
  };

  const handleGitHub = () => {
    window.open("https://github.com/Termix-SSH/Termix", "_blank");
    setIsOpen(false);
  };

  const handleSupport = () => {
    window.open("https://github.com/Termix-SSH/Support/issues/new", "_blank");
    setIsOpen(false);
  };

  const handleDiscord = () => {
    window.open("https://discord.com/invite/jVQGdvHDrf", "_blank");
    setIsOpen(false);
  };

  const handleDonate = () => {
    window.open("https://github.com/sponsors/LukeGus", "_blank");
    setIsOpen(false);
  };

  const handleActivityClick = (item: RecentActivityItem) => {
    getSSHHosts().then((hosts) => {
      const host = hosts.find((h: { id: number }) => h.id === item.hostId);
      if (!host) return;

      if (item.type === "terminal") {
        addTab({
          type: "terminal",
          title: item.hostName,
          hostConfig: host,
        });
      } else if (item.type === "file_manager") {
        addTab({
          type: "file_manager",
          title: item.hostName,
          hostConfig: host,
        });
      }
    });
    setIsOpen(false);
  };

  const handleHostTerminalClick = (host: SSHHost) => {
    const title = host.name?.trim()
      ? host.name
      : `${host.username}@${host.ip}:${host.port}`;
    addTab({ type: "terminal", title, hostConfig: host });
    setIsOpen(false);
  };

  const handleHostFileManagerClick = (host: SSHHost) => {
    const title = host.name?.trim()
      ? host.name
      : `${host.username}@${host.ip}:${host.port}`;
    addTab({ type: "file_manager", title, hostConfig: host });
    setIsOpen(false);
  };

  const handleHostServerDetailsClick = (host: SSHHost) => {
    const title = host.name?.trim()
      ? host.name
      : `${host.username}@${host.ip}:${host.port}`;
    addTab({ type: "server_stats", title, hostConfig: host });
    setIsOpen(false);
  };

  const handleHostTunnelClick = (host: SSHHost) => {
    const title = host.name?.trim()
      ? host.name
      : `${host.username}@${host.ip}:${host.port}`;
    addTab({ type: "tunnel", title, hostConfig: host });
    setIsOpen(false);
  };

  const handleHostDockerClick = (host: SSHHost) => {
    const title = host.name?.trim()
      ? host.name
      : `${host.username}@${host.ip}:${host.port}`;
    addTab({ type: "docker", title, hostConfig: host });
    setIsOpen(false);
  };

  const handleHostEditClick = (host: SSHHost) => {
    const title = host.name?.trim()
      ? host.name
      : `${host.username}@${host.ip}:${host.port}`;
    addTab({
      type: "ssh_manager",
      title: t("commandPalette.hostManager"),
      hostConfig: host,
      initialTab: "add_host",
    });
    setIsOpen(false);
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/30 transition-opacity duration-200",
        !isOpen && "opacity-0 pointer-events-none",
      )}
      onClick={() => setIsOpen(false)}
    >
      <Command
        className={cn(
          "w-3/4 max-w-2xl max-h-[60vh] rounded-lg border-2 border-edge shadow-md flex flex-col bg-elevated",
          "transition-all duration-200 ease-out",
          !isOpen && "scale-95 opacity-0",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <CommandInput
          ref={inputRef}
          placeholder={t("commandPalette.searchPlaceholder")}
        />
        <CommandList
          key={recentActivity.length}
          className="w-full h-auto flex-grow overflow-y-auto thin-scrollbar"
          style={{ maxHeight: "inherit" }}
        >
          {recentActivity.length > 0 && (
            <>
              <CommandGroup heading={t("commandPalette.recentActivity")}>
                {recentActivity.map((item, index) => (
                  <CommandItem
                    key={`recent-activity-${index}-${item.type}-${item.hostId}-${item.timestamp}`}
                    value={`recent-activity-${index}-${item.hostName}-${item.type}`}
                    onSelect={() => handleActivityClick(item)}
                  >
                    {item.type === "terminal" ? <Terminal /> : <FolderOpen />}
                    <span>{item.hostName}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}
          <CommandGroup heading={t("commandPalette.navigation")}>
            <CommandItem onSelect={handleAddHost}>
              <Server />
              <span>{t("commandPalette.addHost")}</span>
            </CommandItem>
            <CommandItem onSelect={handleAddCredential}>
              <Key />
              <span>{t("commandPalette.addCredential")}</span>
            </CommandItem>
            <CommandItem onSelect={handleOpenAdminSettings}>
              <Settings />
              <span>{t("commandPalette.adminSettings")}</span>
            </CommandItem>
            <CommandItem onSelect={handleOpenUserProfile}>
              <User />
              <span>{t("commandPalette.userProfile")}</span>
            </CommandItem>
            <CommandItem onSelect={handleOpenUpdateLog}>
              <GrUpdate />
              <span>{t("commandPalette.updateLog")}</span>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          {hosts.length > 0 && (
            <>
              <CommandGroup heading={t("commandPalette.hosts")}>
                {hosts.map((host, index) => {
                  const title = host.name?.trim()
                    ? host.name
                    : `${host.username}@${host.ip}:${host.port}`;

                  let shouldShowMetrics = true;
                  try {
                    const statsConfig = host.statsConfig
                      ? JSON.parse(host.statsConfig)
                      : DEFAULT_STATS_CONFIG;
                    shouldShowMetrics = statsConfig.metricsEnabled !== false;
                  } catch {
                    shouldShowMetrics = true;
                  }

                  let hasTunnelConnections = false;
                  try {
                    const tunnelConnections = Array.isArray(
                      host.tunnelConnections,
                    )
                      ? host.tunnelConnections
                      : JSON.parse(host.tunnelConnections as string);
                    hasTunnelConnections =
                      Array.isArray(tunnelConnections) &&
                      tunnelConnections.length > 0;
                  } catch {
                    hasTunnelConnections = false;
                  }

                  const visibleButtons = [
                    host.enableTerminal && (host.showTerminalInSidebar ?? true),
                    host.enableFileManager &&
                      (host.showFileManagerInSidebar ?? false),
                    host.enableTunnel &&
                      hasTunnelConnections &&
                      (host.showTunnelInSidebar ?? false),
                    host.enableDocker && (host.showDockerInSidebar ?? false),
                    shouldShowMetrics &&
                      (host.showServerStatsInSidebar ?? false),
                  ].filter(Boolean).length;

                  return (
                    <CommandItem
                      key={`host-${index}-${host.id}`}
                      value={`host-${index}-${title}-${host.id}`}
                      onSelect={() => {
                        if (host.enableTerminal) {
                          handleHostTerminalClick(host);
                        }
                      }}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Server className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{title}</span>
                      </div>
                      <ButtonGroup
                        className="flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {host.enableTerminal &&
                          (host.showTerminalInSidebar ?? true) && (
                            <Button
                              variant="outline"
                              className="!px-2 h-7 border-1 border-edge"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleHostTerminalClick(host);
                              }}
                            >
                              <Terminal className="h-3 w-3" />
                            </Button>
                          )}

                        {host.enableFileManager &&
                          (host.showFileManagerInSidebar ?? false) && (
                            <Button
                              variant="outline"
                              className="!px-2 h-7 border-1 border-edge"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleHostFileManagerClick(host);
                              }}
                            >
                              <FolderOpen className="h-3 w-3" />
                            </Button>
                          )}

                        {host.enableTunnel &&
                          hasTunnelConnections &&
                          (host.showTunnelInSidebar ?? false) && (
                            <Button
                              variant="outline"
                              className="!px-2 h-7 border-1 border-edge"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleHostTunnelClick(host);
                              }}
                            >
                              <ArrowDownUp className="h-3 w-3" />
                            </Button>
                          )}

                        {host.enableDocker &&
                          (host.showDockerInSidebar ?? false) && (
                            <Button
                              variant="outline"
                              className="!px-2 h-7 border-1 border-edge"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleHostDockerClick(host);
                              }}
                            >
                              <Container className="h-3 w-3" />
                            </Button>
                          )}

                        {shouldShowMetrics &&
                          (host.showServerStatsInSidebar ?? false) && (
                            <Button
                              variant="outline"
                              className="!px-2 h-7 border-1 border-edge"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleHostServerDetailsClick(host);
                              }}
                            >
                              <Server className="h-3 w-3" />
                            </Button>
                          )}

                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                "!px-2 h-7 border-1 border-edge",
                                visibleButtons > 0 &&
                                  "rounded-l-none border-l-0",
                              )}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <EllipsisVertical className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            side="right"
                            className="w-56 bg-canvas border-edge text-foreground"
                          >
                            {host.enableTerminal &&
                              !(host.showTerminalInSidebar ?? true) && (
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleHostTerminalClick(host);
                                  }}
                                  className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-hover text-foreground-secondary"
                                >
                                  <Terminal className="h-4 w-4" />
                                  <span className="flex-1">
                                    {t("hosts.openTerminal")}
                                  </span>
                                </DropdownMenuItem>
                              )}
                            {shouldShowMetrics &&
                              !(host.showServerStatsInSidebar ?? false) && (
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleHostServerDetailsClick(host);
                                  }}
                                  className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-hover text-foreground-secondary"
                                >
                                  <Server className="h-4 w-4" />
                                  <span className="flex-1">
                                    {t("hosts.openServerStats")}
                                  </span>
                                </DropdownMenuItem>
                              )}
                            {host.enableFileManager &&
                              !(host.showFileManagerInSidebar ?? false) && (
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleHostFileManagerClick(host);
                                  }}
                                  className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-hover text-foreground-secondary"
                                >
                                  <FolderOpen className="h-4 w-4" />
                                  <span className="flex-1">
                                    {t("hosts.openFileManager")}
                                  </span>
                                </DropdownMenuItem>
                              )}
                            {host.enableTunnel &&
                              hasTunnelConnections &&
                              !(host.showTunnelInSidebar ?? false) && (
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleHostTunnelClick(host);
                                  }}
                                  className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-hover text-foreground-secondary"
                                >
                                  <ArrowDownUp className="h-4 w-4" />
                                  <span className="flex-1">
                                    {t("hosts.openTunnels")}
                                  </span>
                                </DropdownMenuItem>
                              )}
                            {host.enableDocker &&
                              !(host.showDockerInSidebar ?? false) && (
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleHostDockerClick(host);
                                  }}
                                  className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-hover text-foreground-secondary"
                                >
                                  <Container className="h-4 w-4" />
                                  <span className="flex-1">
                                    {t("hosts.openDocker")}
                                  </span>
                                </DropdownMenuItem>
                              )}
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleHostEditClick(host);
                              }}
                              className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-hover text-foreground-secondary"
                            >
                              <Pencil className="h-4 w-4" />
                              <span className="flex-1">{t("common.edit")}</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </ButtonGroup>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}
          <CommandGroup heading={t("commandPalette.links")}>
            <CommandItem onSelect={handleGitHub}>
              <Github />
              <span>{t("commandPalette.github")}</span>
            </CommandItem>
            <CommandItem onSelect={handleSupport}>
              <BiSupport />
              <span>{t("commandPalette.support")}</span>
            </CommandItem>
            <CommandItem onSelect={handleDiscord}>
              <BsDiscord />
              <span>{t("commandPalette.discord")}</span>
            </CommandItem>
            <CommandItem onSelect={handleDonate}>
              <BiMoney />
              <span>{t("commandPalette.donate")}</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
        <div className="border-t border-edge px-4 py-2 bg-hover/50 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>{t("commandPalette.press")}</span>
            <KbdGroup>
              <Kbd>Shift</Kbd>
              <Kbd>Shift</Kbd>
            </KbdGroup>
            <span>{t("commandPalette.toToggle")}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>{t("commandPalette.close")}</span>
            <Kbd>Esc</Kbd>
          </div>
        </div>
      </Command>
    </div>
  );
}
