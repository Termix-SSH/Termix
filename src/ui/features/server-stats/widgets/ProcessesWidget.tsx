import { List, Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios.ts";
import { SectionCard } from "@/components/section-card";

interface ProcessesWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

export function ProcessesWidget({ metrics }: ProcessesWidgetProps) {
  const { t } = useTranslation();

  const metricsWithProcesses = metrics as ServerMetrics & {
    processes?: {
      total?: number;
      running?: number;
      top?: Array<{
        pid: number;
        cpu: number;
        mem: number;
        command: string;
        user: string;
      }>;
    };
  };
  const processes = metricsWithProcesses?.processes;
  const topProcesses = processes?.top ?? [];

  return (
    <SectionCard
      title={t("serverStats.processes")}
      icon={<List className="size-3.5" />}
    >
      <div className="flex flex-col gap-1.5 py-1">
        <div className="grid grid-cols-4 text-[10px] text-muted-foreground font-bold uppercase tracking-wider pb-1 border-b border-border min-w-0">
          <span>PID</span>
          <span>CPU</span>
          <span>MEM</span>
          <span>CMD</span>
        </div>
        {topProcesses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-muted-foreground gap-2">
            <Activity className="size-6 opacity-40" />
            <span className="text-xs">{t("serverStats.noProcessesFound")}</span>
          </div>
        ) : (
          <div className="overflow-y-auto max-h-[280px]">
            {topProcesses.map((proc, i) => (
              <div
                key={i}
                className="grid grid-cols-4 text-xs font-mono py-1 border-b border-border/50 last:border-0 min-w-0"
              >
                <span className="text-muted-foreground">{proc.pid}</span>
                <span className="text-accent-brand font-bold">{proc.cpu}%</span>
                <span>{proc.mem}%</span>
                <span className="truncate font-semibold" title={proc.command}>
                  {proc.command.split("/").pop()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
