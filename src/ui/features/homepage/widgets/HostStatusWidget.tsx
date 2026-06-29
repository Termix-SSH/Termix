import { useEffect, useState } from "react";
import { Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  HostStatusConfig,
  HostMetricKey,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import {
  getServerStatusById,
  getServerMetricsById,
} from "@/api/host-metrics-status-api";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import type { ServerMetrics } from "@/main-axios";
import { WidgetTitle } from "./WidgetTitle";

function getAccentColor(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-brand")
      .trim() || "#f59145"
  );
}

const DEFAULT_METRICS: HostMetricKey[] = ["cpu", "memory"];

function migrateConfig(config: HostStatusConfig): HostMetricKey[] {
  if (config.shownMetrics?.length) return config.shownMetrics;
  if (config.showMetrics === false) return [];
  const metrics: HostMetricKey[] = ["cpu", "memory"];
  if (config.showDisk) metrics.push("disk");
  return metrics;
}

interface MetricBarProps {
  label: string;
  value: number | null;
  sublabel?: string;
}

function MetricBar({ label, value, sublabel }: MetricBarProps) {
  const pct = value ?? 0;
  const color = pct > 90 ? "#ef4444" : pct > 70 ? "#f97316" : getAccentColor();
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span className="text-right">
          {value != null ? `${Math.round(pct)}%` : "N/A"}
          {sublabel && <span className="ml-1 opacity-60">{sublabel}</span>}
        </span>
      </div>
      <div className="h-1 bg-muted overflow-hidden">
        <div
          className="h-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

interface InfoRowProps {
  label: string;
  value: string | null | undefined;
}

function InfoRow({ label, value }: InfoRowProps) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-[10px] gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground truncate text-right">{value}</span>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function HostStatusWidget({
  widget,
  config,
}: WidgetComponentProps<HostStatusConfig>) {
  const { t } = useTranslation();
  const shownMetrics = migrateConfig(config);
  const { hostId } = config;
  const [hostName, setHostName] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);

  const needsMetrics = shownMetrics.length > 0;

  useEffect(() => {
    if (!hostId) return;
    getSSHHosts()
      .then((hosts) => {
        const host = hosts.find((h) => h.id === hostId);
        if (host) setHostName(host.name);
      })
      .catch(() => {});
  }, [hostId]);

  useEffect(() => {
    if (!hostId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const s = await getServerStatusById(hostId);
        if (!cancelled) setOnline(s.status === "online");
      } catch {
        if (!cancelled) setOnline(false);
      }

      if (needsMetrics) {
        try {
          const m = await getServerMetricsById(hostId);
          if (!cancelled) setMetrics(m);
        } catch {
          if (!cancelled) setMetrics(null);
        }
      }
    };

    poll();
    const iv = setInterval(poll, 10000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [hostId, needsMetrics]);

  if (!hostId) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.noHostSelected")}
      </div>
    );
  }

  const onlineColor =
    online === null ? "#6b7280" : online ? getAccentColor() : "#ef4444";
  const onlineLabel =
    online === null
      ? t("common.unknown")
      : online
        ? t("common.online")
        : t("common.offline");

  const networkIfaces = metrics?.network?.interfaces ?? [];
  const totalRx = networkIfaces.reduce((sum, iface) => {
    const raw = iface.rxBytes ?? iface.rx ?? null;
    return raw ? sum + parseFloat(raw) : sum;
  }, 0);
  const totalTx = networkIfaces.reduce((sum, iface) => {
    const raw = iface.txBytes ?? iface.tx ?? null;
    return raw ? sum + parseFloat(raw) : sum;
  }, 0);

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<Server size={11} />} />
      <div
        className={`flex flex-col gap-2.5 p-3 flex-1 overflow-auto ${!needsMetrics ? "justify-center" : ""}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Server size={14} className="text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold text-foreground truncate flex-1">
            {hostName ?? `Host #${hostId}`}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            <span
              className="w-1.5 h-1.5 shrink-0 rounded-full"
              style={{ background: onlineColor }}
            />
            <span
              className="text-[10px] font-medium"
              style={{ color: onlineColor }}
            >
              {onlineLabel}
            </span>
          </span>
        </div>

        {needsMetrics && (
          <div className="flex flex-col gap-2">
            {shownMetrics.includes("cpu") && (
              <MetricBar
                label={t("homepage.metricCpu")}
                value={metrics?.cpu?.percent ?? null}
                sublabel={
                  metrics?.cpu?.cores ? `${metrics.cpu.cores}c` : undefined
                }
              />
            )}

            {shownMetrics.includes("memory") && (
              <MetricBar
                label={t("homepage.metricMemory")}
                value={metrics?.memory?.percent ?? null}
                sublabel={
                  metrics?.memory?.usedGiB != null &&
                  metrics?.memory?.totalGiB != null
                    ? `${metrics.memory.usedGiB.toFixed(1)}/${metrics.memory.totalGiB.toFixed(1)} GiB`
                    : undefined
                }
              />
            )}

            {shownMetrics.includes("disk") && (
              <MetricBar
                label={t("homepage.metricDisk")}
                value={metrics?.disk?.percent ?? null}
                sublabel={
                  metrics?.disk?.usedHuman && metrics?.disk?.totalHuman
                    ? `${metrics.disk.usedHuman}/${metrics.disk.totalHuman}`
                    : undefined
                }
              />
            )}

            {shownMetrics.includes("uptime") && (
              <InfoRow
                label={t("homepage.metricUptime")}
                value={metrics?.uptime?.formatted ?? null}
              />
            )}

            {shownMetrics.includes("system") && metrics?.system && (
              <div className="flex flex-col gap-0.5 border-t border-border/40 pt-1.5 mt-0.5">
                <InfoRow
                  label={t("homepage.metricOs")}
                  value={metrics.system.os ?? null}
                />
                <InfoRow
                  label={t("homepage.metricKernel")}
                  value={metrics.system.kernel ?? null}
                />
                <InfoRow
                  label={t("homepage.metricHostname")}
                  value={metrics.system.hostname ?? null}
                />
              </div>
            )}

            {shownMetrics.includes("network") && networkIfaces.length > 0 && (
              <div className="flex flex-col gap-0.5 border-t border-border/40 pt-1.5 mt-0.5">
                <div className="text-[10px] font-medium text-muted-foreground mb-0.5">
                  {t("homepage.metricNetwork")}
                </div>
                {networkIfaces.slice(0, 3).map((iface) => (
                  <div
                    key={iface.name}
                    className="flex justify-between text-[10px] gap-2"
                  >
                    <span className="text-muted-foreground shrink-0 truncate max-w-[60px]">
                      {iface.name}
                    </span>
                    <span className="text-foreground">
                      {iface.ip || iface.state}
                    </span>
                  </div>
                ))}
                {(totalRx > 0 || totalTx > 0) && (
                  <div className="flex justify-between text-[10px] gap-2 mt-0.5">
                    <span className="text-muted-foreground">RX/TX</span>
                    <span className="text-foreground">
                      {formatBytes(totalRx)} / {formatBytes(totalTx)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {shownMetrics.includes("processes") && metrics?.processes && (
              <div className="flex flex-col gap-0.5 border-t border-border/40 pt-1.5 mt-0.5">
                <div className="flex justify-between text-[10px]">
                  <span className="text-muted-foreground">
                    {t("homepage.metricProcesses")}
                  </span>
                  <span className="text-foreground">
                    {metrics.processes.total ?? "?"}{" "}
                    {t("homepage.metricProcessesTotal")}
                    {metrics.processes.running != null
                      ? `, ${metrics.processes.running} ${t("homepage.metricProcessesRunning")}`
                      : ""}
                  </span>
                </div>
                {metrics.processes.top?.slice(0, 3).map((proc) => (
                  <div
                    key={proc.pid}
                    className="flex justify-between text-[10px] gap-2"
                  >
                    <span className="text-muted-foreground truncate max-w-[80px]">
                      {proc.command}
                    </span>
                    <span className="text-foreground shrink-0">
                      {proc.cpu}%
                    </span>
                  </div>
                ))}
              </div>
            )}

            {needsMetrics && !metrics && online && (
              <span className="text-[10px] text-muted-foreground/60 italic">
                {t("homepage.metricsNotAvailable")}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

registerWidget<HostStatusConfig>({
  id: "host_status",
  name: "Host Status",
  description: "Shows live status and metrics for an SSH host",
  category: "system",
  icon: <Server size={14} />,
  defaultConfig: { hostId: 0, shownMetrics: DEFAULT_METRICS },
  defaultSize: { w: GRID_SIZE * 9, h: GRID_SIZE * 6 },
  minSize: { w: GRID_SIZE * 2, h: GRID_SIZE * 2 },
  component: HostStatusWidget,
});

export { HostStatusWidget };
