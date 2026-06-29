import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  MetricsChartConfig,
  MetricsChartMetric,
  MetricsChartRange,
  WidgetEditFormProps,
} from "@/types/homepage-types";
import { getSSHHosts } from "@/api/ssh-host-management-api";

const METRICS: { id: MetricsChartMetric; label: string }[] = [
  { id: "cpu", label: "CPU" },
  { id: "memory", label: "Memory" },
  { id: "disk", label: "Disk" },
  { id: "net_rx", label: "RX MB/s" },
  { id: "net_tx", label: "TX MB/s" },
];

const RANGES: { id: MetricsChartRange; label: string }[] = [
  { id: "15m", label: "15m" },
  { id: "1h", label: "1h" },
  { id: "6h", label: "6h" },
  { id: "24h", label: "24h" },
];

export function MetricsChartEditForm({
  config,
  onChange,
}: WidgetEditFormProps<MetricsChartConfig>) {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    getSSHHosts()
      .then((h) => setHosts(h.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.host")}
        </label>
        <select
          value={config.hostId}
          onChange={(e) =>
            onChange({ ...config, hostId: Number(e.target.value) })
          }
          className="h-8 text-xs bg-background border border-border px-2 text-foreground"
        >
          <option value={0}>{t("homepage.selectHost")}</option>
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.chartMetric")}
        </label>
        <div className="flex flex-wrap gap-1">
          {METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange({ ...config, metric: m.id })}
              className={`px-2 py-0.5 text-[10px] font-medium border transition-colors ${config.metric === m.id ? "bg-accent-brand border-accent-brand text-white" : "border-border text-muted-foreground hover:border-accent-brand/50"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.metricRange")}
        </label>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onChange({ ...config, range: r.id })}
              className={`px-2 py-0.5 text-[10px] font-medium border transition-colors ${config.range === r.id ? "bg-accent-brand border-accent-brand text-white" : "border-border text-muted-foreground hover:border-accent-brand/50"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={config.showCurrentValue}
          onChange={(e) =>
            onChange({ ...config, showCurrentValue: e.target.checked })
          }
          className="accent-accent-brand"
        />
        {t("homepage.showCurrentValue")}
      </label>
    </div>
  );
}
