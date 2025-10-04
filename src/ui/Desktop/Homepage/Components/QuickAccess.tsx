import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Zap, 
  Server, 
  Key, 
  Settings, 
  Plus,
  Terminal,
  FileText,
  Network,
  User,
  RefreshCw,
  HelpCircle,
  History,
  Keyboard
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTabs } from "@/ui/Desktop/Navigation/Tabs/TabContext.tsx";
import { useHomepage } from "../HomepageContext.tsx";
import { getQuickAccessData } from "@/ui/main-axios.ts";
import { HomepageUpdateLog } from "./HompageUpdateLog.tsx";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface PinnedHost {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  enableTerminal: boolean;
  enableFileManager: boolean;
  enableTunnel: boolean;
}

interface RecentCredential {
  id: number;
  name: string;
  username: string;
  authType: string;
  lastUsed?: string;
}

interface QuickAccessProps {
  onSelectView: (view: string) => void;
  isAdmin: boolean;
  loggedIn: boolean;
}

export function QuickAccess({ onSelectView, isAdmin, loggedIn }: QuickAccessProps): React.ReactElement {
  const { t } = useTranslation();
  const { addTab, setCurrentTab, tabs: tabList, allSplitScreenTab } = useTabs() as any;
  const { pinnedHosts, recentCredentials, quickAccessLoading } = useHomepage();
  
  const isSplitScreenActive = Array.isArray(allSplitScreenTab) && allSplitScreenTab.length > 0;


  const formatTimeAgo = (dateString?: string) => {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) return "Just now";
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return `${Math.floor(diffInMinutes / 1440)}d ago`;
  };

  const handleHostAction = (hostId: number, action: string) => {
    if (isSplitScreenActive) return;
    
    if (action === "terminal") {
      const host = pinnedHosts.find(h => h.id === hostId);
      if (host) {
        const title = host.name || `${host.username}@${host.ip}`;
        addTab({ type: "terminal", title, hostConfig: host });
      }
    } else {
      onSelectView(action);
    }
  };

  const openAdminTab = () => {
    if (isSplitScreenActive) return;
    const adminTab = tabList.find((t: any) => t.type === "admin");
    if (adminTab) {
      setCurrentTab(adminTab.id);
      return;
    }
    const id = addTab({ type: "admin" } as any);
    setCurrentTab(id);
  };

  const openUserProfileTab = () => {
    if (isSplitScreenActive) return;
    const userProfileTab = tabList.find((t: any) => t.type === "user_profile");
    if (userProfileTab) {
      setCurrentTab(userProfileTab.id);
      return;
    }
    const id = addTab({ type: "user_profile" } as any);
    setCurrentTab(id);
  };

  const openHostManagerTab = () => {
    if (isSplitScreenActive) return;
    const sshManagerTab = tabList.find((t: any) => t.type === "ssh_manager");
    if (sshManagerTab) {
      setCurrentTab(sshManagerTab.id);
      return;
    }
    const id = addTab({ type: "ssh_manager", initialTab: "add_host" } as any);
    setCurrentTab(id);
  };

  const openCredentialsTab = () => {
    if (isSplitScreenActive) return;
    const sshManagerTab = tabList.find((t: any) => t.type === "ssh_manager");
    if (sshManagerTab) {
      setCurrentTab(sshManagerTab.id);
      return;
    }
    const id = addTab({ type: "ssh_manager", initialTab: "add_credential" } as any);
    setCurrentTab(id);
  };

  const quickActions = [
    {
      id: "add-host",
      title: t("homepage.addHost"),
      description: "Connect to a new server",
      icon: <Plus className="h-5 w-5" />,
      color: "text-primary",
      bgColor: "bg-dark-bg",
      action: openHostManagerTab,
    },
    {
      id: "add-credential",
      title: t("homepage.addCredential"),
      description: "Create reusable credentials",
      icon: <Key className="h-5 w-5" />,
      color: "text-primary",
      bgColor: "bg-dark-bg",
      action: openCredentialsTab,
    },
    ...(isAdmin ? [{
      id: "admin-settings",
      title: t("homepage.adminSettings"),
      description: "System configuration",
      icon: <Settings className="h-5 w-5" />,
      color: "text-primary",
      bgColor: "bg-dark-bg",
      action: openAdminTab,
    }] : []),
    {
      id: "user-profile",
      title: t("homepage.userProfile"),
      description: "Account settings",
      icon: <User className="h-5 w-5" />,
      color: "text-primary",
      bgColor: "bg-dark-bg",
      action: openUserProfileTab,
    },
    {
      id: "recent-updates",
      title: "Recent Updates",
      description: "View changelog",
      icon: <History className="h-5 w-5" />,
      color: "text-primary",
      bgColor: "bg-dark-bg",
      action: () => {
        // This will be handled by the Sheet component
      },
    },
  ];


  if (quickAccessLoading) {
    return (
      <Card className="h-full border-0 rounded-none bg-dark-bg">
        <CardContent className="flex-1 overflow-hidden">
          <div className="p-4">
            <div className="flex items-center gap-2 text-white mb-4">
              <Zap className="h-5 w-5" />
              {t("homepage.quickAccess")}
            </div>
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full border-0 rounded-none bg-dark-bg">
      <CardContent className="p-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-4">
            {/* Header as regular content */}
            <div className="flex items-center gap-2 text-white mb-4">
              <Zap className="h-5 w-5" />
              {t("homepage.quickAccess")}
            </div>
            <div>
              <div className="grid grid-cols-2 gap-2">
                {quickActions.map((action) => {
                  if (action.id === "recent-updates") {
                    return (
                      <Sheet key={action.id}>
                        <SheetTrigger asChild>
                          <Button
                            variant="outline"
                            className="h-auto p-3 flex flex-col items-center gap-2 border-1 border-dark-border bg-dark-bg-input dark:border-dark-border"
                          >
                            <div className={action.color}>
                              {action.icon}
                            </div>
                            <div className="text-center">
                              <div className="text-sm font-medium text-white">{action.title}</div>
                              <div className="text-xs text-muted-foreground">{action.description}</div>
                            </div>
                          </Button>
                        </SheetTrigger>
                        <SheetContent side="right" className="w-[600px] bg-dark-bg border-dark-border">
                          <SheetHeader>
                            <SheetTitle className="text-white flex items-center gap-2">
                              <History className="h-5 w-5 text-primary" />
                              Recent Updates
                            </SheetTitle>
                          </SheetHeader>
                          <ScrollArea className="h-full">
                            <div className="p-4">
                              <HomepageUpdateLog loggedIn={loggedIn} />
                            </div>
                          </ScrollArea>
                        </SheetContent>
                      </Sheet>
                    );
                  }
                  
                  return (
                    <Button
                      key={action.id}
                      variant="outline"
                      className="h-auto p-3 flex flex-col items-center gap-2 border-1 border-dark-border bg-dark-bg-input dark:border-dark-border"
                      onClick={action.action}
                    >
                      <div className={action.color}>
                        {action.icon}
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-medium text-white">{action.title}</div>
                        <div className="text-xs text-muted-foreground">{action.description}</div>
                      </div>
                    </Button>
                  );
                })}
              </div>
            </div>


            {/* Pinned Hosts */}
            {pinnedHosts.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  {t("homepage.pinnedHosts")} ({pinnedHosts.length})
                </h4>
                <div className="space-y-2">
                  {pinnedHosts.map((host) => (
                    <div
                      key={host.id}
                      className="bg-dark-bg-input border-1 border-dark-border rounded-lg p-3 dark:border-dark-border"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Server className="h-4 w-4 text-primary" />
                          <span className="font-medium text-white">{host.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {host.ip}:{host.port}
                          </Badge>
                        </div>
                      </div>
                      
                      <div className="flex gap-1">
                        {host.enableTerminal && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleHostAction(host.id, "terminal")}
                            className="h-6 px-2 text-xs border-1 border-dark-border bg-dark-bg-input dark:border-dark-border"
                          >
                            <Terminal className="h-3 w-3 mr-1 text-primary" />
                            {t("homepage.terminal")}
                          </Button>
                        )}
                        {host.enableFileManager && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleHostAction(host.id, "file-manager")}
                            className="h-6 px-2 text-xs border-1 border-dark-border bg-dark-bg-input dark:border-dark-border"
                          >
                            <FileText className="h-3 w-3 mr-1 text-primary" />
                            {t("homepage.files")}
                          </Button>
                        )}
                        {host.enableTunnel && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleHostAction(host.id, "tunnels")}
                            className="h-6 px-2 text-xs border-1 border-dark-border bg-dark-bg-input dark:border-dark-border"
                          >
                            <Network className="h-3 w-3 mr-1 text-primary" />
                            {t("homepage.tunnels")}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
