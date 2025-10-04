import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Network, 
  Play, 
  Pause, 
  Settings, 
  ExternalLink,
  AlertCircle,
  CheckCircle,
  Clock,
  Zap
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getActiveTunnels, getCookie } from "@/ui/main-axios.ts";

interface Tunnel {
  id: string;
  hostId: number;
  hostName: string;
  hostIp: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  status: "active" | "inactive" | "unknown";
  autoStart: boolean;
}

interface TunnelsProps {
  onSelectView: (view: string) => void;
}

export function Tunnels({ onSelectView }: TunnelsProps): React.ReactElement {
  const { t } = useTranslation();
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTunnelsData();
    // Refresh every 10 seconds
    const interval = setInterval(fetchTunnelsData, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchTunnelsData = async () => {
    try {
      const tunnelsData = await getActiveTunnels();
      setTunnels(tunnelsData || []);
    } catch (error) {
      console.error("Failed to fetch tunnels data:", error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "active":
        return <CheckCircle className="h-4 w-4 text-green-400" />;
      case "inactive":
        return <AlertCircle className="h-4 w-4 text-red-400" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "text-green-400";
      case "inactive": return "text-red-400";
      default: return "text-yellow-400";
    }
  };

  const handleTunnelToggle = async (tunnelId: string, currentStatus: string) => {
    try {
      const jwt = getCookie("jwt");
      if (!jwt) return;

      const newStatus = currentStatus === "active" ? "inactive" : "active";
      
      // This would be a real API call to toggle tunnel status
      console.log(`Toggling tunnel ${tunnelId} to ${newStatus}`);
      
      // Update local state optimistically
      setTunnels(prev => prev.map(tunnel => 
        tunnel.id === tunnelId 
          ? { ...tunnel, status: newStatus as "active" | "inactive" }
          : tunnel
      ));
    } catch (error) {
      console.error("Failed to toggle tunnel:", error);
    }
  };

  const handleTunnelConfigure = (hostId: number) => {
    onSelectView("host-manager");
    // You might want to pass the hostId to pre-select the host for tunnel configuration
  };

  const handleTunnelStop = async (tunnelId: string) => {
    try {
      // TODO: Implement actual tunnel stop functionality
      console.log(`Stopping tunnel ${tunnelId}`);
      
      // Update local state optimistically
      setTunnels(prev => prev.map(tunnel => 
        tunnel.id === tunnelId 
          ? { ...tunnel, status: "inactive" as "active" | "inactive" }
          : tunnel
      ));
    } catch (error) {
      console.error("Failed to stop tunnel:", error);
    }
  };

  if (loading) {
    return (
      <Card className="h-full border-0 rounded-none bg-dark-bg">
        <CardHeader className="pb-2 pt-2">
          <CardTitle className="flex items-center gap-2 text-white">
            <Network className="h-5 w-5" />
            {t("homepage.activeTunnels")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden">
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const activeTunnels = tunnels.filter(t => t.status === "active");
  const inactiveTunnels = tunnels.filter(t => t.status === "inactive");
  const totalTunnels = tunnels.length;

  return (
    <Card className="h-full border-0 rounded-none bg-dark-bg">
      <CardHeader className="pb-2 pt-2">
        <CardTitle className="flex items-center gap-2 text-white">
          <Network className="h-5 w-5" />
          {t("homepage.activeTunnels")}
          <Badge variant="secondary" className="ml-auto">
            {activeTunnels.length} {t("homepage.active").toLowerCase()}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-4">
            {/* Active Tunnels */}
            {activeTunnels.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-400" />
                  {t("homepage.activeTunnels")} ({activeTunnels.length})
                </h4>
                <div className="space-y-2">
                  {activeTunnels.map((tunnel) => (
                    <div
                      key={tunnel.id}
                      className="bg-dark-bg-input rounded-lg p-3 hover:bg-dark-active transition-colors border-1 border-dark-border"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(tunnel.status)}
                          <span className="font-medium text-white">{tunnel.hostName}</span>
                          <Badge variant="outline" className="text-xs">
                            {tunnel.hostIp}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleTunnelStop(tunnel.id)}
                          className="h-6 px-2 text-xs hover:bg-destructive/10 hover:text-destructive border-1 border-dark-border bg-destructive/10"
                        >
                          <Pause className="h-3 w-3 mr-1" />
                          {t("homepage.stop")}
                        </Button>
                      </div>
                      
                      <div className="bg-dark-bg rounded p-2 mb-2">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{t("homepage.local")}:</span>
                            <code className="text-primary">localhost:{tunnel.localPort}</code>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => window.open(`http://localhost:${tunnel.localPort}`, '_blank')}
                            className="h-5 px-2 text-xs hover:bg-dark-active border-1 border-dark-border bg-dark-bg-input"
                          >
                            <ExternalLink className="h-3 w-3 mr-1 text-primary" />
                            {t("homepage.open")}
                          </Button>
                        </div>
                        <div className="flex items-center gap-2 text-sm mt-1">
                          <span className="text-muted-foreground">{t("homepage.remote")}:</span>
                          <code className="text-primary">{tunnel.remoteHost}:{tunnel.remotePort}</code>
                        </div>
                      </div>
                      
                      {tunnel.autoStart && (
                        <div className="flex items-center gap-1 text-xs text-yellow-400">
                          <Zap className="h-3 w-3" />
                          <span>{t("homepage.autoStartEnabled")}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTunnels.length === 0 && (
              <div className="flex items-center justify-center h-full min-h-[200px]">
                <div className="text-center text-muted-foreground">
                  <Network className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium mb-2">{t("homepage.noActiveTunnels")}</p>
                  <p className="text-sm">{t("homepage.noActiveTunnelsDesc")}</p>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
