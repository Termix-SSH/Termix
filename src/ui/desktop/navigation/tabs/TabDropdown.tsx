import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  ChevronDown,
  Home,
  Terminal as TerminalIcon,
  Server as ServerIcon,
  Folder as FolderIcon,
  ArrowDownUp as TunnelIcon,
  Container as DockerIcon,
  Shield as AdminIcon,
  Network as SshManagerIcon,
  User as UserIcon,
  Network,
  X,
} from "lucide-react";
import { useTabs, type Tab } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { useTranslation } from "react-i18next";

export function TabDropdown(): React.ReactElement {
  const { tabs, currentTab, setCurrentTab, removeTab } = useTabs();
  const { t } = useTranslation();

  const getTabIcon = (tabType: Tab["type"]) => {
    switch (tabType) {
      case "home":
        return <Home className="h-4 w-4" />;
      case "terminal":
        return <TerminalIcon className="h-4 w-4" />;
      case "server_stats":
        return <ServerIcon className="h-4 w-4" />;
      case "file_manager":
        return <FolderIcon className="h-4 w-4" />;
      case "tunnel":
        return <TunnelIcon className="h-4 w-4" />;
      case "docker":
        return <DockerIcon className="h-4 w-4" />;
      case "user_profile":
        return <UserIcon className="h-4 w-4" />;
      case "ssh_manager":
        return <SshManagerIcon className="h-4 w-4" />;
      case "admin":
        return <AdminIcon className="h-4 w-4" />;
      case "network_graph":
        return <Network className="h-4 w-4" />;
      default:
        return <TerminalIcon className="h-4 w-4" />;
    }
  };

  const getTabDisplayTitle = (tab: Tab) => {
    switch (tab.type) {
      case "home":
        return t("nav.home");
      case "server_stats":
        return tab.title || t("nav.serverStats");
      case "file_manager":
        return tab.title || t("nav.fileManager");
      case "tunnel":
        return tab.title || t("nav.tunnels");
      case "docker":
        return tab.title || t("nav.docker");
      case "user_profile":
        return tab.title || t("nav.userProfile");
      case "ssh_manager":
        return tab.title || t("nav.sshManager");
      case "admin":
        return tab.title || t("nav.admin");
      case "network_graph":
        return tab.title || t("dashboard.networkGraph");
      case "terminal":
      default:
        return tab.title || t("nav.terminal");
    }
  };

  const handleTabSwitch = (tabId: number) => {
    setCurrentTab(tabId);
  };

  const handleCloseTab = (
    e: React.MouseEvent,
    tabId: number,
    tabType: Tab["type"],
  ) => {
    e.stopPropagation();
    if (tabType === "home") return;
    removeTab(tabId);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-[30px] h-[30px] border-edge"
          title={t("nav.tabNavigation", { defaultValue: "Tab Navigation" })}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 bg-canvas border-edge text-foreground"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === currentTab;
          const canClose = tab.type !== "home";
          return (
            <DropdownMenuItem
              key={tab.id}
              onClick={() => handleTabSwitch(tab.id)}
              className={`flex items-center gap-2 cursor-pointer px-3 py-2 ${
                isActive
                  ? "bg-active text-foreground"
                  : "hover:bg-hover text-foreground-secondary"
              }`}
            >
              {getTabIcon(tab.type)}
              <span className="flex-1 truncate">{getTabDisplayTitle(tab)}</span>
              {canClose && (
                <button
                  onClick={(e) => handleCloseTab(e, tab.id, tab.type)}
                  className="ml-1 p-0.5 rounded hover:bg-hover-secondary flex-shrink-0 transition-colors"
                  title={t("nav.closeTab", { defaultValue: "Close tab" })}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
