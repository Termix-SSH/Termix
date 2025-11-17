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
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { BiMoney, BiSupport } from "react-icons/bi";
import { BsDiscord } from "react-icons/bs";
import { GrUpdate } from "react-icons/gr";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { getRecentActivity, getSSHHosts } from "@/ui/main-axios.ts";
import type { RecentActivityItem } from "@/ui/main-axios.ts";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button.tsx";

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
  defaultPath: string;
  tunnelConnections: unknown[];
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
      updateTab(sshManagerTab.id, { initialTab: "add_host" });
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
      updateTab(sshManagerTab.id, { initialTab: "add_credential" });
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
    addTab({ type: "server", title, hostConfig: host });
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
          "w-3/4 max-w-2xl max-h-[60vh] rounded-lg border-2 border-dark-border shadow-md flex flex-col",
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
          className="w-full h-auto flex-grow overflow-y-auto"
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
                      <div className="flex items-center gap-2">
                        <Server className="h-4 w-4" />
                        <span>{title}</span>
                      </div>
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              className="!px-2 h-7 border-1 border-dark-border"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <EllipsisVertical className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            side="right"
                            className="w-56 bg-dark-bg border-dark-border text-white"
                          >
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleHostServerDetailsClick(host);
                              }}
                              className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-dark-hover text-gray-300"
                            >
                              <Server className="h-4 w-4" />
                              <span className="flex-1">
                                {t("commandPalette.openServerDetails")}
                              </span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleHostFileManagerClick(host);
                              }}
                              className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-dark-hover text-gray-300"
                            >
                              <FolderOpen className="h-4 w-4" />
                              <span className="flex-1">
                                {t("commandPalette.openFileManager")}
                              </span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleHostEditClick(host);
                              }}
                              className="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-dark-hover text-gray-300"
                            >
                              <Pencil className="h-4 w-4" />
                              <span className="flex-1">
                                {t("commandPalette.edit")}
                              </span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
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
        <div className="border-t border-dark-border px-4 py-2 bg-dark-hover/50 flex items-center justify-between text-xs text-muted-foreground">
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
