import React from "react";
import { Clock, Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/ui/main-axios.ts";

interface UptimeWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

export function UptimeWidget({ metrics }: UptimeWidgetProps) {
  const { t } = useTranslation();

  const metricsWithUptime = metrics as ServerMetrics & {
    uptime?: {
      formatted?: string;
      seconds?: number;
    };
  };
  const uptime = metricsWithUptime?.uptime;

  return (
    <div className="h-full w-full p-4 rounded-lg bg-canvas/50 border border-edge/50 hover:bg-canvas/70 transition-colors duration-200 flex flex-col overflow-hidden">

      <div className="flex items-center gap-2 flex-shrink-0 mb-3">
        <Clock className="h-5 w-5 text-cyan-400" />
        <h3 className="font-semibold text-lg text-foreground">
          {t("serverStats.uptime")}
        </h3>
      </div>

      <div className="flex flex-col items-center justify-center flex-1">
        <div className="relative mb-4">
          <div className="w-24 h-24 rounded-full bg-cyan-500/10 flex items-center justify-center">
            <Activity className="h-12 w-12 text-cyan-400" />
          </div>
        </div>

        <div className="text-center">
          <div className="text-3xl font-bold text-cyan-400 mb-2">
            {uptime?.formatted || "N/A"}
          </div>
          <div className="text-sm text-muted-foreground">
            {t("serverStats.totalUptime")}
          </div>
          {uptime?.seconds && (
            <div className="text-xs text-foreground-subtle mt-2">
              {Math.floor(uptime.seconds).toLocaleString()}{" "}
              {t("serverStats.seconds")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
