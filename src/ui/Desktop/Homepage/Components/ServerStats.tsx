import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Status, StatusIndicator } from "@/components/ui/shadcn-io/status";
import { 
  Server, 
  Activity, 
  HardDrive, 
  Cpu, 
  MemoryStick,
  Network,
  Users,
  Key,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle,
  Clock,
  RefreshCw
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTabs } from "@/ui/Desktop/Navigation/Tabs/TabContext.tsx";
import { useHomepage } from "../HomepageContext.tsx";
import { SystemStatus } from "./SystemStatus.tsx";

interface ServerStats {
  totalHosts: number;
  pinnedHosts: number;
  tunnelHosts: number;
  recentConnections: number;
  credentialsCount: number;
  totalUsers: number;
}

interface ServerInfo {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  status: "online" | "offline" | "unknown";
  lastSeen?: string;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
}

interface ServerStatsProps {
  onSelectView: (view: string) => void;
}

export function ServerStats({ onSelectView }: ServerStatsProps): React.ReactElement {
  const { t } = useTranslation();
  const { addTab } = useTabs();
  const { serverStats, servers, serverStatsLoading, refreshServerStats } = useHomepage();


  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) return "Just now";
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    return `${Math.floor(diffInMinutes / 1440)}d ago`;
  };

  const handleServerClick = (server: any) => {
    const title = server.name?.trim()
      ? server.name
      : `${server.username}@${server.ip}:${server.port}`;
    
    addTab({ type: "server", title, hostConfig: server });
  };

  if (serverStatsLoading) {
    return (
      <Card className="h-full border-0 rounded-none bg-dark-bg">
        <CardContent className="flex-1 overflow-hidden">
          <div className="p-4">
            <div className="flex items-center gap-2 text-white mb-4">
              <Server className="h-5 w-5" />
              {t("homepage.serverOverview")}
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
              <Server className="h-5 w-5" />
              {t("homepage.serverOverview")}
              <Button
                variant="outline"
                size="sm"
                onClick={refreshServerStats}
                className="h-6 w-6 p-0 ml-auto border-1 border-dark-border"
              >
                <RefreshCw className="h-3 w-3 text-primary" />
              </Button>
            </div>
            {/* Stats Overview */}
            {serverStats && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-dark-bg-input rounded-lg p-3 border-1 border-dark-border">
                  <div className="flex items-center gap-2 mb-1">
                    <Server className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-white">{t("homepage.totalServers")}</span>
                  </div>
                  <div className="text-2xl font-bold text-white">{serverStats.totalHosts}</div>
                </div>
                <div className="bg-dark-bg-input rounded-lg p-3 border-1 border-dark-border">
                  <div className="flex items-center gap-2 mb-1">
                    <Network className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-white">{t("homepage.tunnelHosts")}</span>
                  </div>
                  <div className="text-2xl font-bold text-white">{serverStats.tunnelHosts}</div>
                </div>
                <div className="bg-dark-bg-input rounded-lg p-3 border-1 border-dark-border">
                  <div className="flex items-center gap-2 mb-1">
                    <Key className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-white">{t("homepage.credentials")}</span>
                  </div>
                  <div className="text-2xl font-bold text-white">{serverStats.credentialsCount}</div>
                </div>
                <div className="bg-dark-bg-input rounded-lg p-3 border-1 border-dark-border">
                  <div className="flex items-center gap-2 mb-1">
                    <Users className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-white">{t("homepage.totalUsers")}</span>
                  </div>
                  <div className="text-2xl font-bold text-white">{serverStats.totalUsers}</div>
                </div>
              </div>
            )}

            {/* System Status */}
            <SystemStatus className="mb-4" />

            {/* Server List */}
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                <Users className="h-4 w-4" />
                {t("homepage.allServers")} ({servers.length})
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {servers.map((server) => (
                  <div
                    key={server.id}
                    className="bg-dark-bg-input rounded-lg p-2 border-1 border-dark-border hover:bg-dark-active cursor-pointer transition-colors"
                    onClick={() => handleServerClick(server)}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-2 w-2 rounded-full flex-shrink-0 ${
                          server.status === "online" 
                            ? "bg-emerald-500" 
                            : "bg-red-500"
                        }`}
                      />
                      <span className="font-medium text-white text-sm truncate flex-1">{server.name}</span>
                    </div>
                    
                    {server.status === "online" && (server.cpuUsage !== undefined || server.memoryUsage !== undefined) && (
                      <div className="flex items-center gap-3 text-xs mt-1">
                        {server.cpuUsage !== undefined && (
                          <div className="flex items-center gap-1">
                            <Cpu className="h-3 w-3 text-primary" />
                            <span className="text-white font-medium">{Math.round(server.cpuUsage)}%</span>
                          </div>
                        )}
                        {server.memoryUsage !== undefined && (
                          <div className="flex items-center gap-1">
                            <MemoryStick className="h-3 w-3 text-primary" />
                            <span className="text-white font-medium">{Math.round(server.memoryUsage)}%</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {servers.length === 0 && (
              <div className="text-center text-muted-foreground py-8">
                <Server className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>{t("homepage.noServersConfigured")}</p>
                <p className="text-xs">{t("homepage.noServersConfiguredDesc")}</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
