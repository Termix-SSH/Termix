import React from "react";
import { HardDrive } from "lucide-react";
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

interface DiskWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

export function DiskWidget({ metrics, metricsHistory }: DiskWidgetProps) {
  const { t } = useTranslation();

  const chartData = React.useMemo(() => {
    return metricsHistory.map((m, index) => ({
      index,
      disk: m.disk?.percent || 0,
    }));
  }, [metricsHistory]);

  return (
    <div className="h-full w-full p-4 rounded-lg bg-elevated border border-edge/50 hover:bg-elevated/70 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 flex-shrink-0 mb-3">
        <HardDrive className="h-5 w-5 text-orange-400" />
        <h3 className="font-semibold text-lg text-foreground">
          {t("serverStats.diskUsage")}
        </h3>
      </div>

      <div className="flex flex-col flex-1 min-h-0 gap-2">
        <div className="flex items-baseline gap-3 flex-shrink-0">
          <div className="text-2xl font-bold text-orange-400">
            {typeof metrics?.disk?.percent === "number"
              ? `${metrics.disk.percent}%`
              : "N/A"}
          </div>
          <div className="text-xs text-muted-foreground">
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
        <div className="text-xs text-foreground-subtle flex-shrink-0">
          {(() => {
            const available = metrics?.disk?.availableHuman;
            return available
              ? `${t("serverStats.available")}: ${available}`
              : `${t("serverStats.available")}: N/A`;
          })()}
        </div>
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 5, right: 5, left: -25, bottom: 5 }}
            >
              <defs>
                <linearGradient id="diskGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#fb923c" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#fb923c" stopOpacity={0.1} />
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
                formatter={(value: number) => [`${value.toFixed(1)}%`, "Disk"]}
                cursor={{
                  stroke: "#fb923c",
                  strokeWidth: 1,
                  strokeDasharray: "3 3",
                }}
              />
              <Area
                type="monotone"
                dataKey="disk"
                stroke="#fb923c"
                strokeWidth={2}
                fill="url(#diskGradient)"
                animationDuration={300}
                activeDot={{
                  r: 4,
                  fill: "#fb923c",
                  stroke: "#fff",
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
