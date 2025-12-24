import React from "react";
import { List, Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/ui/main-axios.ts";

interface ProcessesWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

export function ProcessesWidget({ metrics }: ProcessesWidgetProps) {
  const { t } = useTranslation();

  const metricsWithProcesses = metrics as ServerMetrics & {
    processes?: {
      total?: number;
      running?: number;
      top?: Array<{
        pid: number;
        cpu: number;
        mem: number;
        command: string;
        user: string;
      }>;
    };
  };
  const processes = metricsWithProcesses?.processes;
  const topProcesses = processes?.top || [];

  return (
    <div className="h-full w-full p-4 rounded-lg bg-canvas/50 border border-edge/50 hover:bg-canvas/70 transition-colors duration-200 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 flex-shrink-0 mb-3">
        <List className="h-5 w-5 text-yellow-400" />
        <h3 className="font-semibold text-lg text-foreground">
          {t("serverStats.processes")}
        </h3>
      </div>

      <div className="flex items-center justify-between mb-3 pb-2 border-b border-edge/30">
        <div className="text-sm text-muted-foreground">
          {t("serverStats.totalProcesses")}:{" "}
          <span className="text-foreground font-semibold">
            {processes?.total ?? "N/A"}
          </span>
        </div>
        <div className="text-sm text-muted-foreground">
          {t("serverStats.running")}:{" "}
          <span className="text-green-400 font-semibold">
            {processes?.running ?? "N/A"}
          </span>
        </div>
      </div>

      <div className="overflow-auto thin-scrollbar flex-1">
        {topProcesses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Activity className="h-10 w-10 mb-3 opacity-50" />
            <p className="text-sm">{t("serverStats.noProcessesFound")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {topProcesses.map((proc, index) => (
              <div
                key={index}
                className="p-2.5 rounded-lg bg-canvas/30 hover:bg-canvas/50 transition-colors border border-edge/20"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-mono text-muted-foreground font-medium">
                    PID: {proc.pid}
                  </span>
                  <div className="flex gap-3 text-xs font-medium">
                    <span className="text-blue-400">CPU: {proc.cpu}%</span>
                    <span className="text-green-400">MEM: {proc.mem}%</span>
                  </div>
                </div>
                <div className="text-xs text-foreground font-mono truncate mb-1">
                  {proc.command}
                </div>
                <div className="text-xs text-foreground-subtle">
                  User: {proc.user}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
