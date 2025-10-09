import React from "react";
import { HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/ui/main-axios.ts";
import { RechartsPrimitive } from "@/components/ui/chart.tsx";

const { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } =
  RechartsPrimitive;

interface DiskWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

export function DiskWidget({ metrics, metricsHistory }: DiskWidgetProps) {
  const { t } = useTranslation();

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
      <div className="flex items-center gap-2 flex-shrink-0 mb-3">
        <HardDrive className="h-5 w-5 text-orange-400" />
        <h3 className="font-semibold text-lg text-white">
          {t("serverStats.diskUsage")}
        </h3>
      </div>

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
              return available
                ? `${t("serverStats.available")}: ${available}`
                : `${t("serverStats.available")}: N/A`;
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
