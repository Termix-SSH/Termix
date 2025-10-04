import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Activity, 
  Database, 
  Clock,
  CheckCircle,
  AlertCircle,
  Server,
  Users
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { getCookie, getVersionInfo, getSystemStatus } from "@/ui/main-axios.ts";

interface SystemStatus {
  database: "healthy" | "warning" | "error" | "unknown";
  authentication: "healthy" | "warning" | "error" | "unknown";
  uptime: string;
  version: string;
  lastBackup?: string;
  activeConnections: number;
  totalUsers: number;
  upToDate?: boolean;
}

interface SystemStatusProps {
  className?: string;
}

export function SystemStatus({ className }: SystemStatusProps): React.ReactElement {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSystemStatus();
    // Refresh every 30 seconds
    const interval = setInterval(fetchSystemStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchSystemStatus = async () => {
    try {
      const jwt = getCookie("jwt");
      if (!jwt) return;

      // Get real system status from backend
      const systemStatus = await getSystemStatus();
      
      if (systemStatus) {
        // Get version info to determine if up-to-date
        try {
          const versionInfo = await getVersionInfo();
          systemStatus.upToDate = versionInfo.status === "up_to_date";
        } catch (error) {
          systemStatus.upToDate = undefined; // Don't show anything if can't check
        }
        
        setStatus(systemStatus);
      } else {
        // Fallback to basic status without fake data
        setStatus({
          database: "unknown",
          authentication: "unknown", 
          uptime: "unknown",
          version: "unknown",
          activeConnections: 0,
          totalUsers: 0,
          upToDate: undefined,
        });
      }
    } catch (error) {
      console.error("Failed to fetch system status:", error);
      // Fallback to basic status without fake data
      setStatus({
        database: "unknown",
        authentication: "unknown",
        uptime: "unknown", 
        version: "unknown",
        activeConnections: 0,
        totalUsers: 0,
        upToDate: undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "healthy":
        return <CheckCircle className="h-4 w-4 text-green-400" />;
      case "warning":
        return <AlertCircle className="h-4 w-4 text-yellow-400" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-400" />;
      case "unknown":
        return <AlertCircle className="h-4 w-4 text-gray-400" />;
      default:
        return <Activity className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "healthy": return "text-green-400";
      case "warning": return "text-yellow-400";
      case "error": return "text-red-400";
      case "unknown": return "text-gray-400";
      default: return "text-gray-400";
    }
  };

  const formatTimeAgo = (dateString?: string) => {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return "Less than 1h ago";
    if (diffInHours < 24) return `${diffInHours}h ago`;
    return `${Math.floor(diffInHours / 24)}d ago`;
  };

  if (loading) {
    return (
      <Card className={`${className} bg-dark-bg-input border-1 border-dark-border`}>
        <CardHeader className="pb-1 pt-1">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {t("homepage.systemStatus")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="flex items-center justify-center h-16">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!status) return null;

  return (
    <Card className={`${className} bg-dark-bg-input border-1 border-dark-border`}>
      <CardHeader className="pb-2 pt-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4" />
          {t("homepage.systemStatus")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pb-4">
        {/* Database Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-3 w-3 text-blue-400" />
            <span className="text-xs">{t("homepage.database")}</span>
          </div>
          <div className="flex items-center gap-1">
            {getStatusIcon(status.database)}
            <span className={`text-xs ${getStatusColor(status.database)}`}>
              {status.database}
            </span>
          </div>
        </div>

        {/* Uptime */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-3 w-3 text-purple-400" />
            <span className="text-xs">{t("homepage.uptime")}</span>
          </div>
          <span className="text-xs text-gray-400">{status.uptime}</span>
        </div>

        {/* Version */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-3 w-3 text-orange-400" />
            <span className="text-xs">{t("homepage.version")}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              v{status.version}
            </Badge>
            {status.upToDate !== undefined && (
              <Badge 
                variant="outline" 
                className={`text-xs ${
                  status.upToDate 
                    ? "border-green-600/30 text-green-400 bg-green-600/20" 
                    : "border-yellow-600/30 text-yellow-400 bg-yellow-600/20"
                }`}
              >
                {status.upToDate ? t("homepage.upToDate") : t("homepage.outOfDate")}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
