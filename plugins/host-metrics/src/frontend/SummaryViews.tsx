import { usePermission, useTranslation } from "@termix/plugin-sdk/frontend";
import type { MetricsSummaryStore } from "./summary-store";
import { useMetricsSummary } from "./summary-store";

type MetricKey =
  "cpu" | "memory" | "disk" | "uptime" | "system" | "network" | "processes";

function RowBar({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 90
      ? ["bg-red-500", "text-red-400"]
      : value >= 70
        ? ["bg-yellow-500", "text-yellow-400"]
        : ["bg-accent-brand", "text-accent-brand"];
  return (
    <div className="flex flex-col gap-0.5 w-16">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className={`text-[10px] font-bold ${tone[1]}`}>
          {value.toFixed(0)}%
        </span>
      </div>
      <div className="h-0.5 bg-muted w-full">
        <div className={`h-full ${tone[0]}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

/** CPU, RAM and disk bars in a dashboard host row ("dashboard.hostMetrics"). */
export function createDashboardHostMetrics(store: MetricsSummaryStore) {
  return function DashboardHostMetrics(props: Record<string, unknown>) {
    const { t } = useTranslation();
    const allowed = usePermission("use");
    const hostId = Number(props.hostId) || null;
    const online = props.online === true;
    const metrics = useMetricsSummary(store, allowed && online ? hostId : null);

    const cpu = metrics?.cpu?.percent ?? null;
    const ram = metrics?.memory?.percent ?? null;
    const disk = metrics?.disk?.percent ?? null;
    if (!allowed) return null;
    if (!online || (cpu === null && ram === null && disk === null)) {
      return (
        <div className="flex items-center gap-3">
          {[0, 1, 2].map((slot) => (
            <span
              key={slot}
              className="text-[10px] text-muted-foreground w-16 text-center"
            >
              -
            </span>
          ))}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3">
        {cpu !== null && <RowBar label={t("dashboard.cpu")} value={cpu} />}
        {ram !== null && <RowBar label={t("dashboard.ram")} value={ram} />}
        {disk !== null && (
          <RowBar label={t("dashboardTab.disk")} value={disk} />
        )}
      </div>
    );
  };
}

function accentColor(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-brand")
      .trim() || "#f59145"
  );
}

function WidgetBar({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: number | null;
  sublabel?: string;
}) {
  const pct = value ?? 0;
  const color = pct > 90 ? "#ef4444" : pct > 70 ? "#f97316" : accentColor();
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

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
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

/** The numbers under core's homepage host status widget ("homepage.hostMetrics"). */
export function createHomepageHostMetrics(store: MetricsSummaryStore) {
  return function HomepageHostMetrics(props: Record<string, unknown>) {
    const { t } = useTranslation();
    const allowed = usePermission("use");
    const hostId = Number(props.hostId) || null;
    const shown = (
      Array.isArray(props.shownMetrics) ? props.shownMetrics : []
    ) as MetricKey[];
    const online = props.online === true;
    const metrics = useMetricsSummary(store, allowed ? hostId : null);
    if (!allowed || shown.length === 0) return null;

    const interfaces = metrics?.network?.interfaces ?? [];
    const sum = (pick: (iface: (typeof interfaces)[number]) => unknown) =>
      interfaces.reduce((total, iface) => {
        const raw = pick(iface);
        return raw ? total + parseFloat(String(raw)) : total;
      }, 0);
    const totalRx = sum((iface) => iface.rxBytes);
    const totalTx = sum((iface) => iface.txBytes);

    return (
      <div className="flex flex-col gap-2">
        {shown.includes("cpu") && (
          <WidgetBar
            label={t("homepage.metricCpu")}
            value={metrics?.cpu?.percent ?? null}
            sublabel={metrics?.cpu?.cores ? `${metrics.cpu.cores}c` : undefined}
          />
        )}
        {shown.includes("memory") && (
          <WidgetBar
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
        {shown.includes("disk") && (
          <WidgetBar
            label={t("homepage.metricDisk")}
            value={metrics?.disk?.percent ?? null}
            sublabel={
              metrics?.disk?.usedHuman && metrics?.disk?.totalHuman
                ? `${metrics.disk.usedHuman}/${metrics.disk.totalHuman}`
                : undefined
            }
          />
        )}
        {shown.includes("uptime") && (
          <InfoRow
            label={t("homepage.metricUptime")}
            value={metrics?.uptime?.formatted ?? null}
          />
        )}
        {shown.includes("system") && metrics?.system && (
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
        {shown.includes("network") && interfaces.length > 0 && (
          <div className="flex flex-col gap-0.5 border-t border-border/40 pt-1.5 mt-0.5">
            <div className="text-[10px] font-medium text-muted-foreground mb-0.5">
              {t("homepage.metricNetwork")}
            </div>
            {interfaces.slice(0, 3).map((iface) => (
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
        {shown.includes("processes") && metrics?.processes && (
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
                <span className="text-foreground shrink-0">{proc.cpu}%</span>
              </div>
            ))}
          </div>
        )}
        {!metrics && online && (
          <span className="text-[10px] text-muted-foreground/60 italic">
            {t("homepage.metricsNotAvailable")}
          </span>
        )}
      </div>
    );
  };
}
