import React from "react";
import { Server, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/ui/main-axios.ts";

interface SystemWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

export function SystemWidget({ metrics }: SystemWidgetProps) {
  const { t } = useTranslation();

  const system = (metrics as any)?.system;

  return (
    <div className="h-full w-full p-4 rounded-lg bg-dark-bg/50 border border-dark-border/50 hover:bg-dark-bg/70 transition-colors duration-200 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 flex-shrink-0 mb-3">
        <Server className="h-5 w-5 text-purple-400" />
        <h3 className="font-semibold text-lg text-white">
          {t("serverStats.systemInfo")}
        </h3>
      </div>

      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <Info className="h-4 w-4 text-purple-400 mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-400 mb-1.5">
              {t("serverStats.hostname")}
            </p>
            <p className="text-sm text-white font-mono truncate font-medium">
              {system?.hostname || "N/A"}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Info className="h-4 w-4 text-purple-400 mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-400 mb-1.5">
              {t("serverStats.operatingSystem")}
            </p>
            <p className="text-sm text-white font-mono truncate font-medium">
              {system?.os || "N/A"}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <Info className="h-4 w-4 text-purple-400 mt-0.5 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-400 mb-1.5">
              {t("serverStats.kernel")}
            </p>
            <p className="text-sm text-white font-mono truncate font-medium">
              {system?.kernel || "N/A"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
