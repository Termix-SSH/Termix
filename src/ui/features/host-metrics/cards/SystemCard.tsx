import { Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios";
import { StatRow } from "@/components/charts";
import { MetricCard } from "./MetricCard";

export function SystemCard({ metrics }: { metrics: ServerMetrics | null }) {
  const { t } = useTranslation();
  const system = metrics?.system;
  const uptime = metrics?.uptime;

  const rows = [
    { label: t("hostMetrics.hostname"), value: system?.hostname },
    { label: t("hostMetrics.operatingSystem"), value: system?.os },
    { label: t("hostMetrics.kernel"), value: system?.kernel },
    { label: t("hostMetrics.architecture"), value: system?.arch },
    { label: t("hostMetrics.uptime"), value: uptime?.formatted },
  ].filter((r) => r.value);

  return (
    <MetricCard
      title={t("hostMetrics.systemInfo")}
      icon={<Server className="size-3.5" />}
      scroll
    >
      {rows.length === 0 ? (
        <span className="text-xs text-muted-foreground">N/A</span>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {rows.map(({ label, value }) => (
            <StatRow key={label} label={label} value={value} mono />
          ))}
        </div>
      )}
    </MetricCard>
  );
}
