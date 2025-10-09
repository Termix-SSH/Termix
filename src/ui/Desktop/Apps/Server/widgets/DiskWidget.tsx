import React from "react";
import { HardDrive, X } from "lucide-react";
import { Progress } from "@/components/ui/progress.tsx";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/ui/main-axios.ts";

interface DiskWidgetProps {
  metrics: ServerMetrics | null;
  isEditMode: boolean;
  widgetId: string;
  onDelete: (widgetId: string, e: React.MouseEvent<HTMLButtonElement>) => void;
}

export function DiskWidget({
  metrics,
  isEditMode,
  widgetId,
  onDelete,
}: DiskWidgetProps) {
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
        <HardDrive className="h-5 w-5 text-orange-400" />
        <h3 className="font-semibold text-lg text-white">Disk Usage</h3>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-300">
            {(() => {
              const pct = metrics?.disk?.percent;
              const used = metrics?.disk?.usedHuman;
              const total = metrics?.disk?.totalHuman;
              const pctText = typeof pct === "number" ? `${pct}%` : "N/A";
              const usedText = used ?? "N/A";
              const totalText = total ?? "N/A";
              return `${pctText} (${usedText} ${t("serverStats.of")} ${totalText})`;
            })()}
          </span>
        </div>
        <div className="relative">
          <Progress
            value={
              typeof metrics?.disk?.percent === "number"
                ? metrics!.disk!.percent!
                : 0
            }
            className="h-2"
          />
        </div>
        <div className="text-xs text-gray-500">
          {(() => {
            const available = metrics?.disk?.availableHuman;
            return available ? `Available: ${available}` : "Available: N/A";
          })()}
        </div>
      </div>
    </div>
  );
}
