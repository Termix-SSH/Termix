import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios.ts";
import { SectionCard } from "@/components/section-card";

interface UptimeWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

export function UptimeWidget({ metrics }: UptimeWidgetProps) {
  const { t } = useTranslation();

  const metricsWithUptime = metrics as ServerMetrics & {
    uptime?: { formatted?: string; seconds?: number };
  };
  const uptime = metricsWithUptime?.uptime;

  return (
    <SectionCard
      title={t("serverStats.uptime")}
      icon={<Clock className="size-3.5" />}
    >
      <div className="flex flex-col gap-3 py-2">
        <span className="text-xl md:text-3xl font-bold text-accent-brand">
          {uptime?.formatted ?? "N/A"}
        </span>
        {uptime?.seconds && (
          <span className="text-xs text-muted-foreground font-mono">
            {Math.floor(uptime.seconds).toLocaleString()}{" "}
            {t("serverStats.seconds")}
          </span>
        )}
      </div>
    </SectionCard>
  );
}
