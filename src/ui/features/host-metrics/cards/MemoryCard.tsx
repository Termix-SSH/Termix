import { useState, useEffect } from "react";
import { MemoryStick } from "lucide-react";
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

export function MemoryCard({
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

  const percent = metrics?.memory?.percent ?? null;
  const usedGiB = metrics?.memory?.usedGiB ?? null;
  const totalGiB = metrics?.memory?.totalGiB ?? null;
  const freeGiB =
    usedGiB !== null && totalGiB !== null ? totalGiB - usedGiB : null;

  const series: LineChartSeries[] = [
    {
      key: "mem",
      label: t("hostMetrics.memoryUsage"),
      color: "var(--chart-3)",
      data: rows?.map((r) => r.mem_percent) ?? [],
    },
  ];
  const timestamps = rows?.map((r) => r.ts) ?? [];

  return (
    <MetricCard
      title={t("hostMetrics.memoryUsage")}
      icon={<MemoryStick className="size-3.5" />}
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
                  caption={t("hostMetrics.memory")}
                  value={
                    usedGiB !== null && totalGiB !== null
                      ? `${usedGiB.toFixed(1)}/${totalGiB.toFixed(1)}G`
                      : "N/A"
                  }
                />
                <MiniStat
                  caption={t("hostMetrics.free")}
                  value={freeGiB !== null ? `${freeGiB.toFixed(1)}G` : "N/A"}
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
