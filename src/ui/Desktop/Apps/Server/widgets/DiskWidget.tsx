import React from "react";
import { HardDrive, X, Maximize2 } from "lucide-react";
import { Progress } from "@/components/ui/progress.tsx";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/ui/main-axios.ts";
import type { WidgetSize } from "@/types/stats-widgets";
import { ChartContainer, RechartsPrimitive } from "@/components/ui/chart.tsx";

const { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } =
  RechartsPrimitive;

interface DiskWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
  isEditMode: boolean;
  widgetId: string;
  widgetSize: WidgetSize;
  onDelete: (widgetId: string, e: React.MouseEvent<HTMLButtonButton>) => void;
  onChangeSize: (
    widgetId: string,
    newSize: WidgetSize,
    e: React.MouseEvent<HTMLButtonButton>,
  ) => void;
}

export function DiskWidget({
  metrics,
  metricsHistory,
  isEditMode,
  widgetId,
  widgetSize,
  onDelete,
  onChangeSize,
}: DiskWidgetProps) {
  const { t } = useTranslation();

  const sizeOrder: WidgetSize[] = ["small", "medium", "large"];
  const nextSize =
    sizeOrder[(sizeOrder.indexOf(widgetSize) + 1) % sizeOrder.length];

  // Prepare radial chart data
  const radialData = React.useMemo(() => {
    const percent = metrics?.disk?.percent || 0;
    return [
      {
        name: "Disk",
        value: percent,
        fill: "#fb923c",
      },
    ];
  }, [metrics]);

  return (
    <div className="h-full w-full p-4 rounded-lg bg-dark-bg/50 border border-dark-border/50 hover:bg-dark-bg/70 transition-colors duration-200 flex flex-col overflow-hidden">
      {isEditMode && (
        <>
          <button
            onClick={(e) => onChangeSize(widgetId, nextSize, e)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute top-2 right-11 z-[9999] w-7 h-7 bg-blue-500/90 hover:bg-blue-600 text-white rounded-full flex items-center justify-center cursor-pointer shadow-lg"
            type="button"
            title={`Change to ${nextSize}`}
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => onDelete(widgetId, e)}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute top-2 right-2 z-[9999] w-7 h-7 bg-red-500/90 hover:bg-red-600 text-white rounded-full flex items-center justify-center cursor-pointer shadow-lg"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </>
      )}
      <div
        className={`flex items-center gap-2 flex-shrink-0 mb-3 ${isEditMode ? "drag-handle cursor-move" : ""}`}
      >
        <HardDrive className="h-5 w-5 text-orange-400" />
        <h3 className="font-semibold text-lg text-white">Disk Usage</h3>
      </div>

      {widgetSize === "small" && (
        <div className="flex flex-col items-center justify-center flex-1">
          <div className="text-4xl font-bold text-orange-400">
            {typeof metrics?.disk?.percent === "number"
              ? `${metrics.disk.percent}%`
              : "N/A"}
          </div>
          <div className="text-sm text-gray-400 mt-2">
            {(() => {
              const used = metrics?.disk?.usedHuman;
              const total = metrics?.disk?.totalHuman;
              if (used && total) {
                return `${used} / ${total}`;
              }
              return "N/A";
            })()}
          </div>
        </div>
      )}

      {widgetSize === "medium" && (
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
      )}

      {widgetSize === "large" && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                cx="50%"
                cy="50%"
                innerRadius="60%"
                outerRadius="90%"
                data={radialData}
                startAngle={90}
                endAngle={-270}
              >
                <PolarAngleAxis
                  type="number"
                  domain={[0, 100]}
                  angleAxisId={0}
                  tick={false}
                />
                <RadialBar
                  background
                  dataKey="value"
                  cornerRadius={10}
                  fill="#fb923c"
                />
                <text
                  x="50%"
                  y="50%"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="text-2xl font-bold fill-orange-400"
                >
                  {typeof metrics?.disk?.percent === "number"
                    ? `${metrics.disk.percent}%`
                    : "N/A"}
                </text>
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-shrink-0 space-y-1 text-center pb-2">
            <div className="text-xs text-gray-400">
              {(() => {
                const used = metrics?.disk?.usedHuman;
                const total = metrics?.disk?.totalHuman;
                if (used && total) {
                  return `${used} / ${total}`;
                }
                return "N/A";
              })()}
            </div>
            <div className="text-xs text-gray-500">
              {(() => {
                const available = metrics?.disk?.availableHuman;
                return available ? `Available: ${available}` : "Available: N/A";
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
