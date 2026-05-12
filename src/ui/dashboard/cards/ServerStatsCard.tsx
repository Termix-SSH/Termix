import React from "react";
import { useTranslation } from "react-i18next";
import { ChartLine, Loader2, Server } from "lucide-react";
import { Button } from "@/components/button";

interface ServerStat {
  id: number;
  name: string;
  cpu: number | null;
  ram: number | null;
}

interface ServerStatsCardProps {
  serverStats: ServerStat[];
  loading: boolean;
  onServerClick: (serverId: number, serverName: string) => void;
}

export function ServerStatsCard({
  serverStats,
  loading,
  onServerClick,
}: ServerStatsCardProps): React.ReactElement {
  const { t } = useTranslation();

  const visibleStats = serverStats.filter(
    (s) => s.cpu !== null || s.ram !== null,
  );

  return (
    <div className="border-2 border-edge rounded-md flex flex-col overflow-hidden transition-all duration-150 hover:border-primary/20 !bg-elevated">
      <div className="flex flex-col mx-3 my-2 flex-1 overflow-hidden">
        <p className="text-xl font-semibold mb-3 mt-1 flex flex-row items-center">
          <ChartLine className="mr-3" />
          {t("dashboard.serverStats")}
        </p>
        <div
          className={`grid gap-4 grid-cols-3 auto-rows-min overflow-x-hidden thin-scrollbar ${loading ? "overflow-y-hidden" : "overflow-y-auto"}`}
        >
          {loading ? (
            <div className="flex flex-row items-center text-muted-foreground text-sm animate-pulse">
              <Loader2 className="animate-spin mr-2" size={16} />
              <span>{t("dashboard.loadingServerStats")}</span>
            </div>
          ) : visibleStats.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("dashboard.noServerData")}
            </p>
          ) : (
            visibleStats.map((server) => (
              <Button
                key={server.id}
                variant="outline"
                className="border-2 !border-edge h-auto p-3 min-w-0 !bg-canvas"
                onClick={() => onServerClick(server.id, server.name)}
              >
                <div className="flex flex-col w-full">
                  <div className="flex flex-row items-center mb-2">
                    <Server size={20} className="shrink-0" />
                    <p className="truncate ml-2 font-semibold">{server.name}</p>
                  </div>
                  <div className="flex flex-row justify-start gap-4 text-xs text-muted-foreground">
                    {server.cpu !== null && (
                      <span>
                        {t("dashboard.cpu")}: {server.cpu.toFixed(1)}%
                      </span>
                    )}
                    {server.ram !== null && (
                      <span>
                        {t("dashboard.ram")}: {server.ram.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              </Button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
