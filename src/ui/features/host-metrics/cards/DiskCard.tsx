import { HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios";
import { RadialGauge, Sparkline, MiniStat } from "@/components/charts";
import { MetricCard } from "./MetricCard";

export function DiskCard({
  metrics,
  history,
}: {
  metrics: ServerMetrics | null;
  history: number[];
}) {
  const { t } = useTranslation();
  const percent = metrics?.disk?.percent ?? null;
  const usedHuman = metrics?.disk?.usedHuman ?? null;
  const totalHuman = metrics?.disk?.totalHuman ?? null;
  const availableHuman = metrics?.disk?.availableHuman ?? null;

  return (
    <MetricCard
      title={t("hostMetrics.diskUsage")}
      icon={<HardDrive className="size-3.5" />}
    >
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-center gap-4">
          <RadialGauge value={percent} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <MiniStat
                caption={t("hostMetrics.disk")}
                value={
                  usedHuman && totalHuman ? `${usedHuman}/${totalHuman}` : "N/A"
                }
              />
              <MiniStat
                caption={t("hostMetrics.available")}
                value={availableHuman ?? "N/A"}
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
