import React from "react";
import { MemoryStick } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/ui/main-axios.ts";
import { RechartsPrimitive } from "@/components/ui/chart.tsx";

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
}

export function MemoryWidget({ metrics, metricsHistory }: MemoryWidgetProps) {
  const { t } = useTranslation();

  const chartData = React.useMemo(() => {
    return metricsHistory.map((m, index) => ({
      index,
      memory: m.memory?.percent || 0,
    }));
  }, [metricsHistory]);

  return (
    <div className="h-full w-full p-4 rounded-lg bg-dark-bg-darker border border-dark-border/50 hover:bg-dark-bg/70 transition-colors duration-200 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 flex-shrink-0 mb-3">
        <MemoryStick className="h-5 w-5 text-green-400" />
        <h3 className="font-semibold text-lg text-white">
          {t("serverStats.memoryUsage")}
        </h3>
      </div>

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
            return `${t("serverStats.free")}: ${free} GiB`;
          })()}
        </div>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="memoryGradient" x1="0" y1="0" x2="0" y2="1">
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
    </div>
  );
}
