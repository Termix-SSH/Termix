import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios";
import { StatRow } from "@/components/charts";
import { MetricCard } from "./MetricCard";

export function ProcessesCard({ metrics }: { metrics: ServerMetrics | null }) {
  const { t } = useTranslation();
  const procs = metrics?.processes;
  const top = procs?.top ?? [];

  return (
    <MetricCard
      title={t("hostMetrics.processes")}
      icon={<Cpu className="size-3.5" />}
      scroll
    >
      <div className="mb-2 flex items-center gap-4 text-xs">
        {procs?.total != null && (
          <span>
            <span className="font-bold text-foreground">{procs.total}</span>{" "}
            <span className="text-muted-foreground">
              {t("hostMetrics.processesTotal")}
            </span>
          </span>
        )}
        {procs?.running != null && (
          <span>
            <span className="font-bold text-accent-brand">{procs.running}</span>{" "}
            <span className="text-muted-foreground">
              {t("hostMetrics.processesRunning")}
            </span>
          </span>
        )}
      </div>
      {top.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          {t("hostMetrics.noProcessesFound")}
        </span>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {top.slice(0, 10).map((p) => (
            <StatRow
              key={p.pid}
              label={p.command}
              value={`${p.cpu}% cpu · ${p.mem}% mem`}
              mono
            />
          ))}
        </div>
      )}
    </MetricCard>
  );
}
