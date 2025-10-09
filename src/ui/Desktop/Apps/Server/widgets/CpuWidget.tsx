import React from "react";
import { Cpu, X, Maximize2 } from "lucide-react";
import { Progress } from "@/components/ui/progress.tsx";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/ui/main-axios.ts";
import type { WidgetSize } from "@/types/stats-widgets";
import { ChartContainer, RechartsPrimitive } from "@/components/ui/chart.tsx";

const {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} = RechartsPrimitive;

interface CpuWidgetProps {
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

export function CpuWidget({
  metrics,
  metricsHistory,
  isEditMode,
  widgetId,
  widgetSize,
  onDelete,
  onChangeSize,
}: CpuWidgetProps) {
  const { t } = useTranslation();

  const sizeOrder: WidgetSize[] = ["small", "medium", "large"];
  const nextSize =
    sizeOrder[(sizeOrder.indexOf(widgetSize) + 1) % sizeOrder.length];

  // Prepare chart data
  const chartData = React.useMemo(() => {
    return metricsHistory.map((m, index) => ({
      index,
      cpu: m.cpu?.percent || 0,
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
        <Cpu className="h-5 w-5 text-blue-400" />
        <h3 className="font-semibold text-lg text-white">CPU Usage</h3>
      </div>

      {widgetSize === "small" && (
        <div className="flex flex-col items-center justify-center flex-1">
          <div className="text-4xl font-bold text-blue-400">
            {typeof metrics?.cpu?.percent === "number"
              ? `${metrics.cpu.percent}%`
              : "N/A"}
          </div>
          <div className="text-sm text-gray-400 mt-2">
            {typeof metrics?.cpu?.cores === "number"
              ? t("serverStats.cpuCores", { count: metrics.cpu.cores })
              : t("serverStats.naCpus")}
          </div>
        </div>
      )}

      {widgetSize === "medium" && (
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
      )}

      {widgetSize === "large" && (
        <div className="flex flex-col flex-1 min-h-0 gap-2">
          <div className="flex items-baseline gap-3 flex-shrink-0">
            <div className="text-2xl font-bold text-blue-400">
              {typeof metrics?.cpu?.percent === "number"
                ? `${metrics.cpu.percent}%`
                : "N/A"}
            </div>
            <div className="text-xs text-gray-400">
              {typeof metrics?.cpu?.cores === "number"
                ? t("serverStats.cpuCores", { count: metrics.cpu.cores })
                : t("serverStats.naCpus")}
            </div>
          </div>
          <div className="text-xs text-gray-500 flex-shrink-0">
            {metrics?.cpu?.load
              ? `Load: ${metrics.cpu.load[0].toFixed(2)} / ${metrics.cpu.load[1].toFixed(2)} / ${metrics.cpu.load[2].toFixed(2)}`
              : "Load: N/A"}
          </div>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
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
                  formatter={(value: number) => [`${value.toFixed(1)}%`, "CPU"]}
                />
                <Line
                  type="monotone"
                  dataKey="cpu"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  dot={false}
                  animationDuration={300}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
