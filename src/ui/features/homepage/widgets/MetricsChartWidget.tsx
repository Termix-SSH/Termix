import { useEffect, useState, useRef } from "react";
import { TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  MetricsChartConfig,
  MetricsChartMetric,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { getMetricsHistory } from "@/api/host-metrics-api";
import { getSSHHosts } from "@/api/ssh-host-management-api";
import type { MetricsHistoryRow } from "@/api/host-metrics-api";
import { WidgetTitle } from "./WidgetTitle";

function getAccentColor(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-brand")
      .trim() || "#f59145"
  );
}

function getMetricValue(
  row: MetricsHistoryRow,
  metric: MetricsChartMetric,
): number | null {
  switch (metric) {
    case "cpu":
      return row.cpu_percent;
    case "memory":
      return row.mem_percent;
    case "disk":
      return row.disk_percent;
    case "net_rx":
      return row.net_rx_bytes != null ? row.net_rx_bytes / 1_000_000 : null;
    case "net_tx":
      return row.net_tx_bytes != null ? row.net_tx_bytes / 1_000_000 : null;
  }
}

function getMetricLabel(
  metric: MetricsChartMetric,
  t: (k: string) => string,
): string {
  switch (metric) {
    case "cpu":
      return t("homepage.metricCpu");
    case "memory":
      return t("homepage.metricMemory");
    case "disk":
      return t("homepage.metricDisk");
    case "net_rx":
      return "RX MB/s";
    case "net_tx":
      return "TX MB/s";
  }
}

function getMetricUnit(metric: MetricsChartMetric): string {
  if (metric === "net_rx" || metric === "net_tx") return " MB/s";
  return "%";
}

interface SparklineProps {
  values: number[];
  width: number;
  height: number;
  color: string;
}

function Sparkline({ values, width, height, color }: SparklineProps) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = 0;
  const range = max - min;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const polyPts = [`0,${height}`, ...pts, `${width},${height}`].join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="overflow-visible"
    >
      <defs>
        <linearGradient
          id={`mg-${color.replace("#", "")}`}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={polyPts} fill={`url(#mg-${color.replace("#", "")})`} />
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MetricsChartWidget({
  widget,
  config,
}: WidgetComponentProps<MetricsChartConfig>) {
  const { t } = useTranslation();
  const { hostId, metric, range, showCurrentValue } = config;
  const [hostName, setHostName] = useState<string | null>(null);
  const [values, setValues] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!hostId) return;
    getSSHHosts()
      .then((hosts) => {
        const h = hosts.find((x) => x.id === hostId);
        if (h) setHostName(h.name);
      })
      .catch(() => {});
  }, [hostId]);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const e = entries[0]?.contentRect;
      if (e) setDims({ w: Math.floor(e.width), h: Math.floor(e.height) });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const fetchData = () => {
    if (!hostId) return;
    getMetricsHistory(hostId, { range })
      .then((res) => {
        const vals = res.rows
          .map((r) => getMetricValue(r, metric))
          .filter((v): v is number => v != null);
        setValues(vals);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 60_000);
    return () => clearInterval(iv);
  }, [hostId, metric, range]);

  const accent = getAccentColor();
  const current = values.length > 0 ? values[values.length - 1] : null;
  const unit = getMetricUnit(metric);
  const label = getMetricLabel(metric, t);

  if (!hostId) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.noHostSelected")}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle title={widget.title} icon={<TrendingUp size={11} />} />
      <div className="flex flex-col flex-1 p-2 gap-1 overflow-hidden">
        <div className="flex items-center justify-between gap-1 shrink-0">
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-semibold text-foreground truncate">
              {hostName ?? `Host #${hostId}`}
            </span>
            <span className="text-[9px] text-muted-foreground">
              {label} · {range}
            </span>
          </div>
          {showCurrentValue && current != null && (
            <span
              className="text-sm font-bold tabular-nums shrink-0"
              style={{ color: accent }}
            >
              {metric === "net_rx" || metric === "net_tx"
                ? current.toFixed(2)
                : Math.round(current)}
              {unit}
            </span>
          )}
        </div>

        <div ref={containerRef} className="flex-1 min-h-0 relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/60">
              {t("homepage.loading")}
            </div>
          ) : values.length < 2 ? (
            <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/60">
              {t("homepage.noData")}
            </div>
          ) : (
            dims.w > 0 &&
            dims.h > 0 && (
              <Sparkline
                values={values}
                width={dims.w}
                height={dims.h}
                color={accent}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

registerWidget<MetricsChartConfig>({
  id: "metrics_chart",
  name: "Metrics Chart",
  description: "Historical CPU, memory, disk, or network chart for a host",
  category: "monitoring",
  icon: <TrendingUp size={14} />,
  defaultConfig: {
    hostId: 0,
    metric: "cpu",
    range: "1h",
    showCurrentValue: true,
  },
  defaultSize: { w: GRID_SIZE * 12, h: GRID_SIZE * 6 },
  minSize: { w: GRID_SIZE * 6, h: GRID_SIZE * 4 },
  component: MetricsChartWidget,
});

export { MetricsChartWidget };
