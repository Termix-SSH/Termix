import { MemoryStick } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios";
import { RadialGauge, Sparkline, MiniStat } from "@/components/charts";
import { MetricCard } from "./MetricCard";

export function MemoryCard({
  metrics,
  history,
}: {
  metrics: ServerMetrics | null;
  history: number[];
}) {
  const { t } = useTranslation();
  const percent = metrics?.memory?.percent ?? null;
  const usedGiB = metrics?.memory?.usedGiB ?? null;
  const totalGiB = metrics?.memory?.totalGiB ?? null;
  const freeGiB =
    usedGiB !== null && totalGiB !== null ? totalGiB - usedGiB : null;

  return (
    <MetricCard
      title={t("hostMetrics.memoryUsage")}
      icon={<MemoryStick className="size-3.5" />}
    >
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-center gap-4">
          <RadialGauge value={percent} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <MiniStat
                caption={t("hostMetrics.memory")}
                value={
                  usedGiB !== null && totalGiB !== null
                    ? `${usedGiB.toFixed(1)}/${totalGiB.toFixed(1)}G`
                    : "N/A"
                }
              />
              <MiniStat
                caption={t("hostMetrics.free")}
                value={freeGiB !== null ? `${freeGiB.toFixed(1)}G` : "N/A"}
              />
            </div>
            <Sparkline
              data={[...history, percent ?? 0]}
              domain={[0, 100]}
              height={48}
            />
          </div>
        </div>
      </div>
    </MetricCard>
  );
}
