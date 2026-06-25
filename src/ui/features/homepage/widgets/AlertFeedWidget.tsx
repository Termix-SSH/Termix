import { useEffect, useState } from "react";
import {
  Bell,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  Info,
  Check,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  AlertFeedConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { getAlertFirings, acknowledgeAlertFiring } from "@/api/alerts-api";
import type { AlertFiring } from "@/api/alerts-api";
import { WidgetTitle } from "./WidgetTitle";

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function SeverityIcon({ severity }: { severity: AlertFiring["severity"] }) {
  if (severity === "critical")
    return <AlertCircle size={11} className="shrink-0 text-red-500" />;
  if (severity === "warning")
    return <AlertTriangle size={11} className="shrink-0 text-amber-500" />;
  return <Info size={11} className="shrink-0 text-blue-400" />;
}

function AlertFeedWidget({
  widget,
  config,
}: WidgetComponentProps<AlertFeedConfig>) {
  const { t } = useTranslation();
  const { maxItems, showAcknowledged } = config;
  const [firings, setFirings] = useState<AlertFiring[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const data = await getAlertFirings({ limit: maxItems * 2 });
      const filtered = showAcknowledged
        ? data
        : data.filter((f) => !f.acknowledged);
      setFirings(filtered.slice(0, maxItems));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 30_000);
    return () => clearInterval(iv);
  }, [maxItems, showAcknowledged]);

  const handleAck = async (id: number) => {
    try {
      await acknowledgeAlertFiring(id);
      setFirings((prev) =>
        prev.map((f) => (f.id === id ? { ...f, acknowledged: true } : f)),
      );
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.loading")}
      </div>
    );
  }

  if (firings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2">
        <CheckCircle size={20} className="text-green-500" />
        <span className="text-xs text-muted-foreground">
          {t("homepage.allClear")}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle
        title={widget.title || t("homepage.widgetAlertFeedName")}
        icon={<Bell size={11} />}
      />
      <div className="flex-1 overflow-auto">
        {firings.map((f) => (
          <div
            key={f.id}
            className={`flex items-start gap-2 px-2 py-1.5 border-b border-border/30 ${f.acknowledged ? "opacity-50" : ""}`}
          >
            <SeverityIcon severity={f.severity} />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[10px] font-semibold text-foreground truncate">
                {f.ruleName ?? f.message}
              </span>
              <span className="text-[9px] text-muted-foreground truncate">
                {f.hostName} · {relativeTime(f.firedAt)}
              </span>
            </div>
            {!f.acknowledged && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleAck(f.id);
                }}
                className="p-0.5 text-muted-foreground hover:text-green-500 transition-colors shrink-0"
                title={t("homepage.acknowledgeAlert")}
              >
                <Check size={10} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

registerWidget<AlertFeedConfig>({
  id: "alert_feed",
  name: "Alert Feed",
  description: "Live feed of active alert firings",
  category: "monitoring",
  icon: <Bell size={14} />,
  defaultConfig: { maxItems: 10, showAcknowledged: false },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 8 },
  minSize: { w: GRID_SIZE * 4, h: GRID_SIZE * 3 },
  component: AlertFeedWidget,
});

export { AlertFeedWidget };
