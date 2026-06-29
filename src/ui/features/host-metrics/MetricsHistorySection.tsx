import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LineChart, type LineChartSeries } from "@/components/charts/LineChart";
import {
  getMetricsHistory,
  type MetricsHistoryRow,
} from "@/api/host-metrics-api";

export type HistoryRange = "1h" | "6h" | "24h" | "7d" | "30d";

interface MetricsHistorySectionProps {
  hostId: number;
  timeRange: HistoryRange;
}

function computeNetRates(rows: MetricsHistoryRow[]): {
  rxRates: Array<number | null>;
  txRates: Array<number | null>;
} {
  const rxRates: Array<number | null> = [];
  const txRates: Array<number | null> = [];
  for (let i = 0; i < rows.length; i++) {
    if (i === 0) {
      rxRates.push(null);
      txRates.push(null);
      continue;
    }
    const prev = rows[i - 1];
    const curr = rows[i];
    const dtSec =
      (new Date(curr.ts).getTime() - new Date(prev.ts).getTime()) / 1000;
    if (
      dtSec < 0.5 ||
      prev.net_rx_bytes == null ||
      curr.net_rx_bytes == null ||
      prev.net_tx_bytes == null ||
      curr.net_tx_bytes == null
    ) {
      rxRates.push(null);
      txRates.push(null);
      continue;
    }
    const rxDelta = curr.net_rx_bytes - prev.net_rx_bytes;
    const txDelta = curr.net_tx_bytes - prev.net_tx_bytes;
    rxRates.push(rxDelta < 0 ? null : rxDelta / dtSec);
    txRates.push(txDelta < 0 ? null : txDelta / dtSec);
  }
  return { rxRates, txRates };
}

function formatBytes(bps: number): string {
  if (bps >= 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

function maxOrZero(arr: Array<number | null>): number {
  return arr.reduce<number>((m, v) => (v != null && v > m ? v : m), 0);
}

export function MetricsHistorySection({
  hostId,
  timeRange,
}: MetricsHistorySectionProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<MetricsHistoryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getMetricsHistory(hostId, { range: timeRange })
      .then((res) => {
        if (!cancelled) {
          setRows(res.rows);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load history",
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hostId, timeRange]);

  const timestamps = rows?.map((r) => r.ts) ?? [];

  const cpuSeries: LineChartSeries = {
    key: "cpu",
    label: t("hostMetrics.cpuUsage"),
    color: "var(--accent-brand)",
    data: rows?.map((r) => r.cpu_percent) ?? [],
  };
  const memSeries: LineChartSeries = {
    key: "mem",
    label: t("hostMetrics.memoryUsage"),
    color: "var(--chart-3)",
    data: rows?.map((r) => r.mem_percent) ?? [],
  };
  const diskSeries: LineChartSeries = {
    key: "disk",
    label: t("hostMetrics.diskUsage"),
    color: "var(--chart-4)",
    data: rows?.map((r) => r.disk_percent) ?? [],
  };

  const { rxRates, txRates } = rows
    ? computeNetRates(rows)
    : { rxRates: [], txRates: [] };
  const netMax = Math.max(maxOrZero(rxRates), maxOrZero(txRates), 1024);
  const rxSeries: LineChartSeries = {
    key: "rx",
    label: t("metricsHistory.download"),
    color: "var(--chart-2)",
    data: rxRates,
  };
  const txSeries: LineChartSeries = {
    key: "tx",
    label: t("metricsHistory.upload"),
    color: "var(--chart-5)",
    data: txRates,
  };

  const hasData = rows !== null && rows.length > 0;
  const hasNetData = rxRates.some((v) => v !== null);

  if (loading) {
    return (
      <div className="flex flex-col gap-4 px-3 pb-3">
        {["cpu", "mem", "disk", "net"].map((k) => (
          <div key={k} className="border border-border bg-card p-4">
            <div className="mb-3 h-3 w-24 animate-pulse rounded bg-muted" />
            <div className="h-40 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-3 flex h-40 items-center justify-center border border-border bg-card text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="mx-3 flex h-40 items-center justify-center border border-border bg-card text-sm text-muted-foreground">
        {t("metricsHistory.noData")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-3 pb-3">
      <div className="border border-border bg-card p-4">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("hostMetrics.cpuUsage")}
        </div>
        <LineChart
          series={[cpuSeries]}
          timestamps={timestamps}
          domain={[0, 100]}
          yFormatter={(v) => `${v.toFixed(0)}%`}
          height={160}
        />
      </div>
      <div className="border border-border bg-card p-4">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("hostMetrics.memoryUsage")}
        </div>
        <LineChart
          series={[memSeries]}
          timestamps={timestamps}
          domain={[0, 100]}
          yFormatter={(v) => `${v.toFixed(0)}%`}
          height={160}
        />
      </div>
      <div className="border border-border bg-card p-4">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("hostMetrics.diskUsage")}
        </div>
        <LineChart
          series={[diskSeries]}
          timestamps={timestamps}
          domain={[0, 100]}
          yFormatter={(v) => `${v.toFixed(0)}%`}
          height={160}
        />
      </div>
      <div className="border border-border bg-card p-4">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {t("metricsHistory.network")}
        </div>
        {hasNetData ? (
          <LineChart
            series={[rxSeries, txSeries]}
            timestamps={timestamps}
            domain={[0, netMax]}
            yFormatter={formatBytes}
            height={160}
          />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            {t("metricsHistory.noData")}
          </div>
        )}
      </div>
    </div>
  );
}
