import React from "react";
import { useTranslation } from "react-i18next";
import {
  Clock,
  Loader2,
  Terminal,
  FolderOpen,
  Server,
  ArrowDownUp,
  Container,
  Monitor,
  Eye,
  MessagesSquare,
} from "lucide-react";
import { Button } from "@/components/button";
import { type RecentActivityItem } from "@/main-axios";

interface RecentActivityCardProps {
  activities: RecentActivityItem[];
  loading: boolean;
  onReset: () => void;
  onActivityClick: (item: RecentActivityItem) => void;
}

function formatRelativeTime(
  timestamp: string,
  t: (key: string) => string,
): string {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  if (diffMs < 0) return t("dashboard.justNow");
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return t("dashboard.justNow");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  return `${Math.floor(diffHour / 24)}d`;
}

export function RecentActivityCard({
  activities,
  loading,
  onReset,
  onActivityClick,
}: RecentActivityCardProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="border-2 border-edge rounded-md flex flex-col overflow-hidden transition-all duration-150 hover:border-primary/20 !bg-elevated">
      <div className="flex flex-col mx-3 my-2 flex-1 overflow-hidden">
        <div className="flex flex-row items-center justify-between mb-3 mt-1">
          <p className="text-xl font-semibold flex flex-row items-center">
            <Clock className="mr-3" />
            {t("dashboard.recentActivity")}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="border-2 !border-edge h-7 !bg-canvas"
            onClick={onReset}
          >
            {t("dashboard.reset")}
          </Button>
        </div>
        <div
          className={`grid gap-4 grid-cols-3 auto-rows-min overflow-x-hidden thin-scrollbar ${loading ? "overflow-y-hidden" : "overflow-y-auto"}`}
        >
          {loading ? (
            <div className="flex flex-row items-center text-muted-foreground text-sm animate-pulse">
              <Loader2 className="animate-spin mr-2" size={16} />
              <span>{t("dashboard.loadingRecentActivity")}</span>
            </div>
          ) : activities.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("dashboard.noRecentActivity")}
            </p>
          ) : (
            activities
              .filter((item, index, array) => {
                if (index === 0) return true;

                const prevItem = array[index - 1];
                return !(
                  item.hostId === prevItem.hostId && item.type === prevItem.type
                );
              })
              .map((item) => (
                <Button
                  key={item.id}
                  variant="outline"
                  className="border-2 !border-edge min-w-0 !bg-canvas"
                  onClick={() => onActivityClick(item)}
                >
                  {item.type === "terminal" ? (
                    <Terminal size={20} className="shrink-0" />
                  ) : item.type === "file_manager" ? (
                    <FolderOpen size={20} className="shrink-0" />
                  ) : item.type === "server_stats" ? (
                    <Server size={20} className="shrink-0" />
                  ) : item.type === "tunnel" ? (
                    <ArrowDownUp size={20} className="shrink-0" />
                  ) : item.type === "docker" ? (
                    <Container size={20} className="shrink-0" />
                  ) : item.type === "telnet" ? (
                    <MessagesSquare size={20} className="shrink-0" />
                  ) : item.type === "vnc" ? (
                    <Eye size={20} className="shrink-0" />
                  ) : item.type === "rdp" ? (
                    <Monitor size={20} className="shrink-0" />
                  ) : (
                    <Terminal size={20} className="shrink-0" />
                  )}
                  <div className="flex flex-col items-start min-w-0 ml-2">
                    <p className="truncate font-semibold leading-none">
                      {item.hostName}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-none">
                      {formatRelativeTime(item.timestamp, t)}
                    </p>
                  </div>
                </Button>
              ))
          )}
        </div>
      </div>
    </div>
  );
}
