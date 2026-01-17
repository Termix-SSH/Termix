import React from "react";
import { useTranslation } from "react-i18next";
import {
  Server,
  History,
  Clock,
  Database,
  Key,
  ArrowDownUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { UpdateLog } from "@/ui/desktop/apps/dashboard/apps/UpdateLog";

interface ServerOverviewCardProps {
  loggedIn: boolean;
  versionText: string;
  versionStatus: "up_to_date" | "requires_update";
  uptime: string;
  dbHealth: "healthy" | "error";
  totalServers: number;
  totalTunnels: number;
  totalCredentials: number;
}

export function ServerOverviewCard({
  loggedIn,
  versionText,
  versionStatus,
  uptime,
  dbHealth,
  totalServers,
  totalTunnels,
  totalCredentials,
}: ServerOverviewCardProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="border-2 border-edge rounded-md flex flex-col overflow-hidden transition-all duration-150 hover:border-primary/20 !bg-elevated">
      <div className="flex flex-col mx-3 my-2 overflow-y-auto overflow-x-hidden thin-scrollbar">
        <p className="text-xl font-semibold mb-3 mt-1 flex flex-row items-center">
          <Server className="mr-3" />
          {t("dashboard.serverOverview")}
        </p>
        <div className="w-full h-auto border-2 border-edge rounded-md px-3 py-3 !bg-canvas">
          <div className="flex flex-row items-center justify-between mb-3 min-w-0 gap-2">
            <div className="flex flex-row items-center min-w-0">
              <History size={20} className="shrink-0" />
              <p className="ml-2 leading-none truncate">
                {t("dashboard.version")}
              </p>
            </div>

            <div className="flex flex-row items-center">
              <p className="leading-none text-muted-foreground">
                {versionText}
              </p>
              <Button
                variant="outline"
                size="sm"
                className={`ml-2 text-sm border-1 border-edge ${versionStatus === "up_to_date" ? "text-green-400" : "text-yellow-400"}`}
              >
                {versionStatus === "up_to_date"
                  ? t("dashboard.upToDate")
                  : t("dashboard.updateAvailable")}
              </Button>
              <UpdateLog loggedIn={loggedIn} />
            </div>
          </div>

          <div className="flex flex-row items-center justify-between mb-5 min-w-0 gap-2">
            <div className="flex flex-row items-center min-w-0">
              <Clock size={20} className="shrink-0" />
              <p className="ml-2 leading-none truncate">
                {t("dashboard.uptime")}
              </p>
            </div>

            <div className="flex flex-row items-center">
              <p className="leading-none text-muted-foreground">{uptime}</p>
            </div>
          </div>

          <div className="flex flex-row items-center justify-between min-w-0 gap-2">
            <div className="flex flex-row items-center min-w-0">
              <Database size={20} className="shrink-0" />
              <p className="ml-2 leading-none truncate">
                {t("dashboard.database")}
              </p>
            </div>

            <div className="flex flex-row items-center">
              <p
                className={`leading-none ${dbHealth === "healthy" ? "text-green-400" : "text-red-400"}`}
              >
                {dbHealth === "healthy"
                  ? t("dashboard.healthy")
                  : t("dashboard.error")}
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-col grid grid-cols-2 gap-2 mt-2">
          <div className="flex flex-row items-center justify-between w-full h-auto mt-3 border-2 border-edge rounded-md px-3 py-3 min-w-0 gap-2 !bg-canvas">
            <div className="flex flex-row items-center min-w-0">
              <Server size={16} className="mr-3 shrink-0" />
              <p className="m-0 leading-none truncate">
                {t("dashboard.totalServers")}
              </p>
            </div>
            <p className="m-0 leading-none text-muted-foreground font-semibold">
              {totalServers}
            </p>
          </div>
          <div className="flex flex-row items-center justify-between w-full h-auto mt-3 border-2 border-edge rounded-md px-3 py-3 min-w-0 gap-2 !bg-canvas">
            <div className="flex flex-row items-center min-w-0">
              <ArrowDownUp size={16} className="mr-3 shrink-0" />
              <p className="m-0 leading-none truncate">
                {t("dashboard.totalTunnels")}
              </p>
            </div>
            <p className="m-0 leading-none text-muted-foreground font-semibold">
              {totalTunnels}
            </p>
          </div>
        </div>
        <div className="flex flex-col grid grid-cols-2 gap-2 mt-2">
          <div className="flex flex-row items-center justify-between w-full h-auto mt-3 border-2 border-edge rounded-md px-3 py-3 min-w-0 gap-2 !bg-canvas">
            <div className="flex flex-row items-center min-w-0">
              <Key size={16} className="mr-3 shrink-0" />
              <p className="m-0 leading-none truncate">
                {t("dashboard.totalCredentials")}
              </p>
            </div>
            <p className="m-0 leading-none text-muted-foreground font-semibold">
              {totalCredentials}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
