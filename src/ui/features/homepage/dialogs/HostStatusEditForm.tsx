import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import type {
  HostMetricKey,
  HostStatusConfig,
  WidgetEditFormProps,
} from "@/types/homepage-types";

interface SimpleHost {
  id: string;
  name: string;
  metricsEnabled: boolean;
}

const METRIC_OPTIONS: { key: HostMetricKey; labelKey: string }[] = [
  { key: "cpu", labelKey: "homepage.metricCpu" },
  { key: "memory", labelKey: "homepage.metricMemory" },
  { key: "disk", labelKey: "homepage.metricDisk" },
  { key: "uptime", labelKey: "homepage.metricUptime" },
  { key: "system", labelKey: "homepage.metricSystem" },
  { key: "network", labelKey: "homepage.metricNetwork" },
  { key: "processes", labelKey: "homepage.metricProcesses" },
];

function parseMetricsEnabled(statsConfig: unknown): boolean {
  if (!statsConfig) return false;
  try {
    const cfg =
      typeof statsConfig === "string" ? JSON.parse(statsConfig) : statsConfig;
    if (typeof cfg === "object" && cfg !== null) {
      const c = cfg as Record<string, unknown>;
      return c.metricsEnabled !== false;
    }
  } catch {
    // ignore
  }
  return false;
}

export function HostStatusEditForm({
  config,
  onChange,
}: WidgetEditFormProps<HostStatusConfig>) {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<SimpleHost[]>([]);

  const shownMetrics: HostMetricKey[] = config.shownMetrics?.length
    ? config.shownMetrics
    : config.showMetrics !== false
      ? ["cpu", "memory", ...(config.showDisk ? ["disk" as HostMetricKey] : [])]
      : [];

  useEffect(() => {
    getSSHHosts()
      .then((all) =>
        setHosts(
          all
            .filter((x) => parseMetricsEnabled(x.statsConfig))
            .map((x) => ({
              id: String(x.id),
              name: x.name,
              metricsEnabled: true,
            })),
        ),
      )
      .catch(() => {});
  }, []);

  function toggleMetric(key: HostMetricKey) {
    const next = shownMetrics.includes(key)
      ? shownMetrics.filter((k) => k !== key)
      : [...shownMetrics, key];
    onChange({ ...config, shownMetrics: next });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.host")}
        </label>
        <select
          className="h-8 border border-border bg-background text-sm px-2"
          value={config.hostId || ""}
          onChange={(e) =>
            onChange({ ...config, hostId: parseInt(e.target.value) || 0 })
          }
        >
          <option value="">{t("homepage.selectHost")}</option>
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          {t("homepage.displayedMetrics")}
        </label>
        <div className="flex flex-col gap-1">
          {METRIC_OPTIONS.map(({ key, labelKey }) => (
            <label
              key={key}
              className="flex items-center gap-2 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={shownMetrics.includes(key)}
                onChange={() => toggleMetric(key)}
                className="w-3.5 h-3.5 accent-primary"
              />
              <span className="text-xs text-foreground">{t(labelKey)}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
