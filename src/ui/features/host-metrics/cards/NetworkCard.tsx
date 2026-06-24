import { useState, useEffect } from "react";
import { Cable, Container, Network, Wifi, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServerMetrics } from "@/main-axios";
import { MetricCard } from "./MetricCard";
import { LineChart, type LineChartSeries } from "@/components/charts/LineChart";
import {
  getMetricsHistory,
  type MetricsHistoryRow,
} from "@/api/host-metrics-api";
import { CardTimeTabs, type HistoryTab } from "./CardTimeTabs";

function ifaceIcon(name: string) {
  if (/^(wl|wlan|wifi|ath)/.test(name))
    return <Wifi className="size-3 text-muted-foreground/60" />;
  if (/^(eth|en|enp|eno|ens)/.test(name))
    return <Cable className="size-3 text-muted-foreground/60" />;
  if (/^(docker|br-|veth|virbr|vlan|bond|tun|tap|wg|lo)/.test(name))
    return <Container className="size-3 text-muted-foreground/60" />;
  return <Network className="size-3 text-muted-foreground/60" />;
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

export function NetworkCard({
  metrics,
  hostId,
}: {
  metrics: ServerMetrics | null;
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

  const interfaces = metrics?.network?.interfaces ?? [];

  const { rxRates, txRates } = rows
    ? computeNetRates(rows)
    : { rxRates: [], txRates: [] };
  const netMax = Math.max(
    rxRates.reduce<number>((m, v) => (v != null && v > m ? v : m), 0),
    txRates.reduce<number>((m, v) => (v != null && v > m ? v : m), 0),
    1024,
  );
  const timestamps = rows?.map((r) => r.ts) ?? [];
  const hasNetData = rxRates.some((v) => v !== null);

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

  return (
    <MetricCard
      title={t("hostMetrics.networkInterfaces")}
      icon={<Network className="size-3.5" />}
      scroll={activeTab === "live"}
      action={
        hostId != null ? (
          <CardTimeTabs value={activeTab} onChange={setActiveTab} />
        ) : undefined
      }
    >
      {activeTab === "live" &&
        (interfaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-muted-foreground">
            <WifiOff className="size-6 opacity-40" />
            <span className="text-xs">
              {t("hostMetrics.noInterfacesFound")}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {interfaces.map((iface, i) => (
              <div
                key={`${iface.name}-${i}`}
                className="flex flex-col gap-1 border border-border bg-muted/30 p-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {ifaceIcon(iface.name)}
                    <span
                      className={`size-1.5 rounded-full ${iface.state === "UP" ? "bg-accent-brand" : "bg-muted-foreground/50"}`}
                    />
                    <span className="font-mono text-sm font-bold">
                      {iface.name}
                    </span>
                  </div>
                  <span className="border border-border px-1.5 py-px text-[10px] font-semibold uppercase text-muted-foreground">
                    {iface.state}
                  </span>
                </div>
                <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                  <span className="truncate">{iface.ip}</span>
                  {(iface.rx || iface.tx) && (
                    <span className="shrink-0">
                      &#8595; {iface.rx ?? "—"} / &#8593; {iface.tx ?? "—"}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      {activeTab !== "live" && (
        <>
          {loading && (
            <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">
              {t("common.loading")}
            </div>
          )}
          {!loading && rows !== null && !hasNetData && (
            <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">
              {t("metricsHistory.noData")}
            </div>
          )}
          {!loading && hasNetData && (
            <LineChart
              series={[rxSeries, txSeries]}
              timestamps={timestamps}
              domain={[0, netMax]}
              yFormatter={formatBytes}
              height={160}
            />
          )}
        </>
      )}
    </MetricCard>
  );
}
