import React from "react";
import { MemoryStick, X, Maximize2 } from "lucide-react";
import { Progress } from "@/components/ui/progress.tsx";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/ui/main-axios.ts";
import type { WidgetSize } from "@/types/stats-widgets";
import { ChartContainer, RechartsPrimitive } from "@/components/ui/chart.tsx";

const {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} = RechartsPrimitive;

interface MemoryWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
  isEditMode: boolean;
  widgetId: string;
  widgetSize: WidgetSize;
  onDelete: (widgetId: string, e: React.MouseEvent<HTMLButtonElement>) => void;
  onChangeSize: (
    widgetId: string,
    newSize: WidgetSize,
    e: React.MouseEvent<HTMLButtonElement>,
  ) => void;
}

export function MemoryWidget({
  metrics,
  metricsHistory,
  isEditMode,
  widgetId,
  widgetSize,
  onDelete,
  onChangeSize,
}: MemoryWidgetProps) {
  const { t } = useTranslation();

  const sizeOrder: WidgetSize[] = ["small", "medium", "large"];
  const nextSize =
    sizeOrder[(sizeOrder.indexOf(widgetSize) + 1) % sizeOrder.length];

  // Prepare chart data
  const chartData = React.useMemo(() => {
    return metricsHistory.map((m, index) => ({
      index,
      memory: m.memory?.percent || 0,
    }));
  }, [metricsHistory]);

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
        <MemoryStick className="h-5 w-5 text-green-400" />
        <h3 className="font-semibold text-lg text-white">Memory Usage</h3>
      </div>

      {widgetSize === "small" && (
        <div className="flex flex-col items-center justify-center flex-1">
          <div className="text-4xl font-bold text-green-400">
            {typeof metrics?.memory?.percent === "number"
              ? `${metrics.memory.percent}%`
              : "N/A"}
          </div>
          <div className="text-sm text-gray-400 mt-2">
            {(() => {
              const used = metrics?.memory?.usedGiB;
              const total = metrics?.memory?.totalGiB;
              if (typeof used === "number" && typeof total === "number") {
                return `${used.toFixed(1)} / ${total.toFixed(1)} GiB`;
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
                const pct = metrics?.memory?.percent;
                const used = metrics?.memory?.usedGiB;
                const total = metrics?.memory?.totalGiB;
                const pctText = typeof pct === "number" ? `${pct}%` : "N/A";
                const usedText =
                  typeof used === "number" ? `${used.toFixed(1)} GiB` : "N/A";
                const totalText =
                  typeof total === "number" ? `${total.toFixed(1)} GiB` : "N/A";
                return `${pctText} (${usedText} ${t("serverStats.of")} ${totalText})`;
              })()}
            </span>
          </div>
          <div className="relative">
            <Progress
              value={
                typeof metrics?.memory?.percent === "number"
                  ? metrics!.memory!.percent!
                  : 0
              }
              className="h-2"
            />
          </div>
          <div className="text-xs text-gray-500">
            {(() => {
              const used = metrics?.memory?.usedGiB;
              const total = metrics?.memory?.totalGiB;
              const free =
                typeof used === "number" && typeof total === "number"
                  ? (total - used).toFixed(1)
                  : "N/A";
              return `Free: ${free} GiB`;
            })()}
          </div>
        </div>
      )}

      {widgetSize === "large" && (
        <div className="flex flex-col flex-1 min-h-0 gap-2">
          <div className="flex items-baseline gap-3 flex-shrink-0">
            <div className="text-2xl font-bold text-green-400">
              {typeof metrics?.memory?.percent === "number"
                ? `${metrics.memory.percent}%`
                : "N/A"}
            </div>
            <div className="text-xs text-gray-400">
              {(() => {
                const used = metrics?.memory?.usedGiB;
                const total = metrics?.memory?.totalGiB;
                if (typeof used === "number" && typeof total === "number") {
                  return `${used.toFixed(1)} / ${total.toFixed(1)} GiB`;
                }
                return "N/A";
              })()}
            </div>
          </div>
          <div className="text-xs text-gray-500 flex-shrink-0">
            {(() => {
              const used = metrics?.memory?.usedGiB;
              const total = metrics?.memory?.totalGiB;
              const free =
                typeof used === "number" && typeof total === "number"
                  ? (total - used).toFixed(1)
                  : "N/A";
              return `Free: ${free} GiB`;
            })()}
          </div>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient
                    id="memoryGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="index"
                  stroke="#9ca3af"
                  tick={{ fill: "#9ca3af" }}
                  hide
                />
                <YAxis
                  domain={[0, 100]}
                  stroke="#9ca3af"
                  tick={{ fill: "#9ca3af" }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1f2937",
                    border: "1px solid #374151",
                    borderRadius: "6px",
                    color: "#fff",
                  }}
                  formatter={(value: number) => [
                    `${value.toFixed(1)}%`,
                    "Memory",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="memory"
                  stroke="#34d399"
                  strokeWidth={2}
                  fill="url(#memoryGradient)"
                  animationDuration={300}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
