import { MetricCard } from "@termix/plugin-sdk/ui";
import { type ServerMetrics } from "../../shared/metrics.js";
import { Clock } from "lucide-react";
import { useTranslation } from "@termix/plugin-sdk/frontend";

export function UptimeCard({ metrics }: { metrics: ServerMetrics | null }) {
  const { t } = useTranslation();
  const uptime = metrics?.uptime;

  return (
    <MetricCard
      title={t("hostMetrics.uptime")}
      icon={<Clock className="size-3.5" />}
    >
      <div className="flex h-full flex-col justify-center gap-2">
        <span className="text-2xl font-bold leading-none text-accent-brand md:text-3xl">
          {uptime?.formatted ?? "N/A"}
        </span>
        {uptime?.seconds != null && (
          <span className="font-mono text-xs text-muted-foreground">
            {Math.floor(uptime.seconds).toLocaleString()}{" "}
            {t("hostMetrics.seconds")}
          </span>
        )}
      </div>
    </MetricCard>
  );
}
