import React from "react";
import { Cpu, X } from "lucide-react";
import { Progress } from "@/components/ui/progress.tsx";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/ui/main-axios.ts";

interface CpuWidgetProps {
  metrics: ServerMetrics | null;
  isEditMode: boolean;
  widgetId: string;
  onDelete: (widgetId: string, e: React.MouseEvent<HTMLButtonElement>) => void;
}

export function CpuWidget({
  metrics,
  isEditMode,
  widgetId,
  onDelete,
}: CpuWidgetProps) {
  const { t } = useTranslation();

  return (
    <div className="h-full w-full space-y-3 p-4 rounded-lg bg-dark-bg/50 border border-dark-border/50 hover:bg-dark-bg/70 transition-colors duration-200">
      {isEditMode && (
        <button
          onClick={(e) => onDelete(widgetId, e)}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 z-[9999] w-7 h-7 bg-red-500/90 hover:bg-red-600 text-white rounded-full flex items-center justify-center cursor-pointer shadow-lg"
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      <div
        className={`flex items-center gap-2 mb-3 ${isEditMode ? "drag-handle cursor-move" : ""}`}
      >
        <Cpu className="h-5 w-5 text-blue-400" />
        <h3 className="font-semibold text-lg text-white">CPU Usage</h3>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-300">
            {(() => {
              const pct = metrics?.cpu?.percent;
              const cores = metrics?.cpu?.cores;
              const pctText = typeof pct === "number" ? `${pct}%` : "N/A";
              const coresText =
                typeof cores === "number"
                  ? t("serverStats.cpuCores", { count: cores })
                  : t("serverStats.naCpus");
              return `${pctText} ${t("serverStats.of")} ${coresText}`;
            })()}
          </span>
        </div>
        <div className="relative">
          <Progress
            value={
              typeof metrics?.cpu?.percent === "number"
                ? metrics!.cpu!.percent!
                : 0
            }
            className="h-2"
          />
        </div>
        <div className="text-xs text-gray-500">
          {metrics?.cpu?.load
            ? `Load: ${metrics.cpu.load[0].toFixed(2)}, ${metrics.cpu.load[1].toFixed(2)}, ${metrics.cpu.load[2].toFixed(2)}`
            : "Load: N/A"}
        </div>
      </div>
    </div>
  );
}
