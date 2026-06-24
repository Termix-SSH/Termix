import { useState, useEffect } from "react";
import { HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios";
import { RadialGauge, Sparkline, MiniStat } from "@/components/charts";
import { MetricCard } from "./MetricCard";
import { LineChart, type LineChartSeries } from "@/components/charts/LineChart";
import {
  getMetricsHistory,
  type MetricsHistoryRow,
} from "@/api/host-metrics-api";
import { CardTimeTabs, type HistoryTab } from "./CardTimeTabs";

export function DiskCard({
  metrics,
  history,
  hostId,
}: {
  metrics: ServerMetrics | null;
  history: number[];
  hostId: number | null;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<HistoryTab>("live");
  const [rows, setRows] = useState<MetricsHistoryRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (activeTab === "live" || hostId == null) return;
    let cancelled = false;
    setLoading(true);
    setRows(null);
    getMetricsHistory(hostId, { range: activeTab })
      .then((res) => {
        if (!cancelled) {
          setRows(res.rows);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, hostId]);

  const percent = metrics?.disk?.percent ?? null;
  const usedHuman = metrics?.disk?.usedHuman ?? null;
  const totalHuman = metrics?.disk?.totalHuman ?? null;
  const availableHuman = metrics?.disk?.availableHuman ?? null;

  const series: LineChartSeries[] = [
    {
      key: "disk",
      label: t("hostMetrics.diskUsage"),
      color: "var(--chart-4)",
      data: rows?.map((r) => r.disk_percent) ?? [],
    },
  ];
  const timestamps = rows?.map((r) => r.ts) ?? [];

  return (
    <MetricCard
      title={t("hostMetrics.diskUsage")}
      icon={<HardDrive className="size-3.5" />}
      action={
        hostId != null ? (
          <CardTimeTabs value={activeTab} onChange={setActiveTab} />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {activeTab === "live" && (
          <div className="flex items-center gap-4">
            <RadialGauge value={percent} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <MiniStat
                  caption={t("hostMetrics.disk")}
                  value={
                    usedHuman && totalHuman
                      ? `${usedHuman}/${totalHuman}`
                      : "N/A"
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
        )}
        {activeTab !== "live" && (
          <>
            {loading && (
              <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">
                {t("common.loading")}
              </div>
            )}
            {!loading && rows !== null && rows.length === 0 && (
              <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">
                {t("metricsHistory.noData")}
              </div>
            )}
            {!loading && rows !== null && rows.length > 0 && (
              <LineChart
                series={series}
                timestamps={timestamps}
                domain={[0, 100]}
                yFormatter={(v) => `${v.toFixed(0)}%`}
                height={160}
              />
            )}
          </>
        )}
      </div>
    </MetricCard>
  );
}
