import React from "react";
import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/ui/main-axios.ts";
import { RechartsPrimitive } from "@/components/ui/chart.tsx";

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
}

export function CpuWidget({ metrics, metricsHistory }: CpuWidgetProps) {
  const { t } = useTranslation();

  const chartData = React.useMemo(() => {
    return metricsHistory.map((m, index) => ({
      index,
      cpu: m.cpu?.percent || 0,
    }));
  }, [metricsHistory]);

  return (
    <div className="h-full w-full p-4 rounded-lg bg-elevated border border-edge/50 hover:bg-elevated/70 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 flex-shrink-0 mb-3">
        <Cpu className="h-5 w-5 text-blue-400" />
        <h3 className="font-semibold text-lg text-foreground">
          {t("serverStats.cpuUsage")}
        </h3>
      </div>

      <div className="flex flex-col flex-1 min-h-0 gap-2">
        <div className="flex items-baseline gap-3 flex-shrink-0">
          <div className="text-2xl font-bold text-blue-400">
            {typeof metrics?.cpu?.percent === "number"
              ? `${metrics.cpu.percent}%`
              : "N/A"}
          </div>
          <div className="text-xs text-muted-foreground">
            {typeof metrics?.cpu?.cores === "number"
              ? t("serverStats.cpuCores", { count: metrics.cpu.cores })
              : t("serverStats.naCpus")}
          </div>
        </div>
        <div className="text-xs text-foreground-subtle flex-shrink-0">
          {metrics?.cpu?.load
            ? t("serverStats.loadAverage", {
                avg1: metrics.cpu.load[0].toFixed(2),
                avg5: metrics.cpu.load[1].toFixed(2),
                avg15: metrics.cpu.load[2].toFixed(2),
              })
            : t("serverStats.loadAverageNA")}
        </div>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 5, left: -25, bottom: 5 }}
            >
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
    </div>
  );
}
