import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios";
import { RadialGauge, Sparkline, MiniStat } from "@/components/charts";
import { MetricCard } from "./MetricCard";

export function CpuCard({
  metrics,
  history,
}: {
  metrics: ServerMetrics | null;
  history: number[];
}) {
  const { t } = useTranslation();
  const percent = metrics?.cpu?.percent ?? null;
  const cores = metrics?.cpu?.cores ?? null;
  const load = metrics?.cpu?.load ?? null;

  return (
    <MetricCard
      title={t("hostMetrics.cpuUsage")}
      icon={<Cpu className="size-3.5" />}
    >
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-center gap-4">
          <RadialGauge
            value={percent}
            caption={
              cores !== null
                ? t("hostMetrics.cpuCores", { count: cores })
                : undefined
            }
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {load && (
              <div className="grid grid-cols-3 gap-2">
                <MiniStat caption="1m" value={load[0].toFixed(2)} />
                <MiniStat caption="5m" value={load[1].toFixed(2)} />
                <MiniStat caption="15m" value={load[2].toFixed(2)} />
              </div>
            )}
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
