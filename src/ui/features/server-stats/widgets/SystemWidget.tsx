import { Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios.ts";
import { SectionCard } from "@/components/section-card";

interface SystemWidgetProps {
  metrics: ServerMetrics | null;
  metricsHistory: ServerMetrics[];
}

export function SystemWidget({ metrics }: SystemWidgetProps) {
  const { t } = useTranslation();

  const metricsWithSystem = metrics as ServerMetrics & {
    system?: { hostname?: string; os?: string; kernel?: string; arch?: string };
    uptime?: { formatted?: string };
  };
  const system = metricsWithSystem?.system;
  const uptime = metricsWithSystem?.uptime;

  const rows = [
    { label: t("serverStats.hostname"), value: system?.hostname },
    { label: t("serverStats.operatingSystem"), value: system?.os },
    { label: t("serverStats.kernel"), value: system?.kernel },
    { label: t("serverStats.architecture"), value: system?.arch },
    { label: t("serverStats.uptime"), value: uptime?.formatted },
  ].filter((r) => r.value);

  return (
    <SectionCard
      title={t("serverStats.systemInfo")}
      icon={<Server className="size-3.5" />}
    >
      <div className="grid grid-cols-1 gap-y-3 py-2">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex flex-col">
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
              {label}
            </span>
            <span className="text-sm font-mono font-semibold truncate">
              {value}
            </span>
          </div>
        ))}
        {rows.length === 0 && (
          <span className="text-xs text-muted-foreground">N/A</span>
        )}
      </div>
    </SectionCard>
  );
}
