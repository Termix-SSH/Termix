import { List, Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios";
import { MetricCard } from "./MetricCard";

export function ProcessesCard({ metrics }: { metrics: ServerMetrics | null }) {
  const { t } = useTranslation();
  const top = metrics?.processes?.top ?? [];

  return (
    <MetricCard
      title={t("hostMetrics.processes")}
      icon={<List className="size-3.5" />}
      scroll
    >
      <div className="flex flex-col">
        <div className="grid grid-cols-[3rem_3rem_3rem_1fr] gap-2 border-b border-border pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>PID</span>
          <span>CPU</span>
          <span>MEM</span>
          <span>CMD</span>
        </div>
        {top.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-muted-foreground">
            <Activity className="size-6 opacity-40" />
            <span className="text-xs">{t("hostMetrics.noProcessesFound")}</span>
          </div>
        ) : (
          top.map((proc, i) => (
            <div
              key={`${proc.pid}-${i}`}
              className="grid grid-cols-[3rem_3rem_3rem_1fr] gap-2 border-b border-border/50 py-1 font-mono text-xs last:border-0"
            >
              <span className="truncate text-muted-foreground">{proc.pid}</span>
              <span className="font-bold text-accent-brand">{proc.cpu}%</span>
              <span>{proc.mem}%</span>
              <span className="truncate font-semibold" title={proc.command}>
                {proc.command}
              </span>
            </div>
          ))
        )}
      </div>
    </MetricCard>
  );
}
