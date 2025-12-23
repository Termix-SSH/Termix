import React from "react";
import { UserCheck, UserX, MapPin, Activity } from "lucide-react";
import { useTranslation } from "react-i18next";

interface LoginRecord {
  user: string;
  ip: string;
  time: string;
  status: "success" | "failed";
}

interface LoginStatsMetrics {
  recentLogins: LoginRecord[];
  failedLogins: LoginRecord[];
  totalLogins: number;
  uniqueIPs: number;
}

interface ServerMetrics {
  login_stats?: LoginStatsMetrics;
}

interface LoginStatsWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

export function LoginStatsWidget({ metrics }: LoginStatsWidgetProps) {
  const { t } = useTranslation();

  const loginStats = metrics?.login_stats;
  const recentLogins = loginStats?.recentLogins || [];
  const failedLogins = loginStats?.failedLogins || [];
  const totalLogins = loginStats?.totalLogins || 0;
  const uniqueIPs = loginStats?.uniqueIPs || 0;

  return (
    <div className="h-full w-full p-4 rounded-lg bg-canvas/50 border border-edge/50 hover:bg-canvas/70 transition-colors duration-200 flex flex-col overflow-hidden">

      <div className="flex items-center gap-2 flex-shrink-0 mb-3">
        <UserCheck className="h-5 w-5 text-green-400" />
        <h3 className="font-semibold text-lg text-foreground">
          {t("serverStats.loginStats")}
        </h3>
      </div>

      <div className="flex flex-col flex-1 min-h-0 gap-3">
        <div className="grid grid-cols-2 gap-2 flex-shrink-0">
          <div className="bg-elevated p-2 rounded border border-edge/30">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <Activity className="h-3 w-3" />
              <span>{t("serverStats.totalLogins")}</span>
            </div>
            <div className="text-xl font-bold text-green-400">
              {totalLogins}
            </div>
          </div>
          <div className="bg-elevated p-2 rounded border border-edge/30">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <MapPin className="h-3 w-3" />
              <span>{t("serverStats.uniqueIPs")}</span>
            </div>
            <div className="text-xl font-bold text-blue-400">{uniqueIPs}</div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto thin-scrollbar space-y-2">
          <div className="flex-shrink-0">
            <div className="flex items-center gap-2 mb-1">
              <UserCheck className="h-4 w-4 text-green-400" />
              <span className="text-sm font-semibold text-foreground-secondary">
                {t("serverStats.recentSuccessfulLogins")}
              </span>
            </div>
            {recentLogins.length === 0 ? (
              <div className="text-xs text-foreground-subtle italic p-2">
                {t("serverStats.noRecentLoginData")}
              </div>
            ) : (
              <div className="space-y-1">
                {recentLogins.slice(0, 5).map((login) => (
                  <div

                    key={`${login.user}-${login.time}-${login.ip}`}
                    className="text-xs bg-dark-bg-darker p-2 rounded border border-dark-border/30 flex justify-between items-center"

                    key={idx}
                    className="text-xs bg-elevated p-2 rounded border border-edge/30 flex justify-between items-center"

                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-green-400 font-mono truncate">
                        {login.user}
                      </span>
                      <span className="text-foreground-subtle">
                        {t("serverStats.from")}
                      </span>
                      <span className="text-blue-400 font-mono truncate">
                        {login.ip}
                      </span>
                    </div>
                    <span className="text-foreground-subtle text-[10px] flex-shrink-0 ml-2">
                      {new Date(login.time).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {failedLogins.length > 0 && (
            <div className="flex-shrink-0">
              <div className="flex items-center gap-2 mb-1">
                <UserX className="h-4 w-4 text-red-400" />
                <span className="text-sm font-semibold text-foreground-secondary">
                  {t("serverStats.recentFailedAttempts")}
                </span>
              </div>
              <div className="space-y-1">
                {failedLogins.slice(0, 3).map((login) => (
                  <div
                    key={`failed-${login.user}-${login.time}-${login.ip || "unknown"}`}
                    className="text-xs bg-red-900/20 p-2 rounded border border-red-500/30 flex justify-between items-center"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-red-400 font-mono truncate">
                        {login.user}
                      </span>
                      <span className="text-foreground-subtle">
                        {t("serverStats.from")}
                      </span>
                      <span className="text-blue-400 font-mono truncate">
                        {login.ip}
                      </span>
                    </div>
                    <span className="text-foreground-subtle text-[10px] flex-shrink-0 ml-2">
                      {new Date(login.time).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
