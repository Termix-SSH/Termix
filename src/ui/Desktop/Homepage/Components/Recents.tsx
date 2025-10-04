import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Clock, 
  Server, 
  FileText, 
  Pin, 
  Terminal, 
  Network,
  ExternalLink,
  Trash2,
  RefreshCw
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getRecentConnections, getRecentFilesFromHomepage } from "@/ui/main-axios.ts";
import { useTabs } from "@/ui/Desktop/Navigation/Tabs/TabContext.tsx";

interface RecentConnection {
  id: number;
  hostId: number;
  connectedAt: string;
  disconnectedAt?: string;
  duration?: number;
  connectionType: string;
  hostName: string;
  hostIp: string;
  hostPort: number;
  hostUsername: string;
}

interface RecentFile {
  id: number;
  hostId: number;
  name: string;
  path: string;
  lastOpened: string;
  hostName: string;
  hostIp: string;
}

interface PinnedFile {
  id: number;
  hostId: number;
  name: string;
  path: string;
  pinnedAt: string;
  hostName: string;
  hostIp: string;
}

interface RecentsProps {
  onSelectView: (view: string) => void;
}

export function Recents({ onSelectView }: RecentsProps): React.ReactElement {
  const { t } = useTranslation();
  const { addTab } = useTabs();
  const [recentConnections, setRecentConnections] = useState<RecentConnection[]>([]);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [pinnedFiles, setPinnedFiles] = useState<PinnedFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRecentsData();
  }, []);

  const fetchRecentsData = async () => {
    try {
      const [connections, files] = await Promise.all([
        getRecentConnections(30),
        getRecentFilesFromHomepage(30),
      ]);

      setRecentConnections(connections || []);
      setRecentFiles(files?.recentFiles || []);
      setPinnedFiles(files?.pinnedFiles || []);
    } catch (error) {
      console.error("Failed to fetch recents data:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) return t("homepage.justNow");
    if (diffInMinutes < 60) return t("homepage.minutesAgo", { minutes: diffInMinutes });
    if (diffInMinutes < 1440) return t("homepage.hoursAgo", { hours: Math.floor(diffInMinutes / 60) });
    return t("homepage.daysAgo", { days: Math.floor(diffInMinutes / 1440) });
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds || seconds <= 0) return null;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return null; // Don't show anything for very short durations
  };

  const getConnectionIcon = (type: string) => {
    switch (type) {
      case "terminal": return <Terminal className="h-4 w-4" />;
      case "tunnel": return <Network className="h-4 w-4" />;
      case "file_manager": return <FileText className="h-4 w-4" />;
      default: return <Server className="h-4 w-4" />;
    }
  };

  const handleConnectionClick = async (connection: RecentConnection) => {
    try {
      // Fetch the full host data to get authentication details
      const { getSSHHosts } = await import("@/ui/main-axios.ts");
      const hosts = await getSSHHosts();
      const fullHost = hosts.find(h => h.id === connection.hostId);
      
      if (!fullHost) {
        console.error("Host not found:", connection.hostId);
        return;
      }
      
      const title = connection.hostName || `${connection.hostUsername}@${connection.hostIp}`;
      addTab({ type: "terminal", title, hostConfig: fullHost });
    } catch (error) {
      console.error("Failed to fetch host data:", error);
    }
  };

  const handleFileClick = (hostId: number, path: string) => {
    onSelectView("file-manager");
    // TODO: Pass hostId and path to pre-select the file
  };

  if (loading) {
    return (
      <Card className="h-full border-0 rounded-none bg-dark-bg">
        <CardContent className="flex-1 overflow-hidden">
          <div className="p-4">
            <div className="flex items-center gap-2 text-white mb-4">
              <Clock className="h-5 w-5" />
              {t("homepage.recentActivity")}
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
              <Clock className="h-5 w-5" />
              {t("homepage.recentActivity")}
              <Button
                variant="outline"
                size="sm"
                onClick={fetchRecentsData}
                className="h-6 w-6 p-0 ml-auto border-1 border-dark-border"
              >
                <RefreshCw className="h-3 w-3 text-primary" />
              </Button>
            </div>
            {/* Recent Connections */}
            {recentConnections.length > 0 && (
              <div className="space-y-2">
                {recentConnections.map((connection) => (
                    <div
                      key={connection.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-dark-bg-input hover:bg-dark-active cursor-pointer transition-colors border-1 border-dark-border"
                      onClick={() => handleConnectionClick(connection)}
                    >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {getConnectionIcon(connection.connectionType)}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate text-white">
                          {connection.hostName || `${connection.hostUsername}@${connection.hostIp}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {connection.hostIp}:{connection.hostPort}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {formatDuration(connection.duration) && (
                        <Badge variant="secondary" className="text-xs">
                          {formatDuration(connection.duration)}
                        </Badge>
                      )}
                      <span>{formatTimeAgo(connection.connectedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pinned Files */}
            {pinnedFiles.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  <Pin className="h-4 w-4" />
                  Pinned Files
                </h4>
                <div className="space-y-2">
                  {pinnedFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-dark-bg-input hover:bg-dark-active cursor-pointer transition-colors border-1 border-dark-border"
                      onClick={() => handleFileClick(file.hostId, file.path)}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <FileText className="h-4 w-4 text-primary" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate text-white">
                            {file.name}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {file.hostName} • {file.path}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Pin className="h-3 w-3 text-yellow-400" />
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Files */}
            {recentFiles.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Recent Files
                </h4>
                <div className="space-y-2">
                  {recentFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-dark-bg-input hover:bg-dark-active cursor-pointer transition-colors border-1 border-dark-border"
                      onClick={() => handleFileClick(file.hostId, file.path)}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <FileText className="h-4 w-4 text-primary" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate text-white">
                            {file.name}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {file.hostName} • {file.path}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatTimeAgo(file.lastOpened)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {recentConnections.length === 0 && recentFiles.length === 0 && pinnedFiles.length === 0 && (
              <div className="text-center text-muted-foreground py-8">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No recent activity</p>
                <p className="text-xs">Start connecting to servers to see recent activity here</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
