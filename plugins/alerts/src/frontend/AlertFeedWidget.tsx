import { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Check,
  CheckCircle,
  Info,
} from "lucide-react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Input } from "@termix/plugin-sdk/ui";
import type { AlertItem } from "../types";
import type { AlertsApi } from "./api";
import { timeAgo } from "./format";
import { useAlertsVersion, type AlertsStore } from "./store";

export interface AlertFeedConfig {
  maxItems: number;
  showRead: boolean;
  /** 2.8 name for showRead, still found in saved homepages. */
  showAcknowledged?: boolean;
}

export const DEFAULT_ALERT_FEED_CONFIG: AlertFeedConfig = {
  maxItems: 10,
  showRead: false,
};

function SeverityIcon({ severity }: { severity: AlertItem["severity"] }) {
  if (severity === "critical")
    return <AlertCircle size={11} className="shrink-0 text-red-500" />;
  if (severity === "warning")
    return <AlertTriangle size={11} className="shrink-0 text-amber-500" />;
  if (severity === "success")
    return <CheckCircle size={11} className="shrink-0 text-green-500" />;
  return <Info size={11} className="shrink-0 text-blue-400" />;
}

export function showsRead(config: Partial<AlertFeedConfig>): boolean {
  return config.showRead ?? config.showAcknowledged ?? false;
}

export function createAlertFeedWidget(api: AlertsApi, store: AlertsStore) {
  function AlertFeedWidget({
    widget,
    config,
  }: {
    widget: { title?: string | null };
    config: AlertFeedConfig;
  }) {
    const { t, language } = useTranslation();
    const version = useAlertsVersion(store);
    const maxItems = Math.max(1, config.maxItems || 10);
    const showRead = showsRead(config);
    const [items, setItems] = useState<AlertItem[] | null>(null);

    useEffect(() => {
      let cancelled = false;
      api
        .items({ unread: showRead ? undefined : true, limit: maxItems })
        .then((result) => {
          if (!cancelled) setItems(result.items.slice(0, maxItems));
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        });
      return () => {
        cancelled = true;
      };
    }, [maxItems, showRead, version]);

    const markRead = async (id: number) => {
      try {
        await api.setRead([id]);
        setItems((prev) =>
          (prev ?? []).flatMap((item) =>
            item.id !== id
              ? [item]
              : showRead
                ? [{ ...item, readAt: new Date().toISOString() }]
                : [],
          ),
        );
      } catch {
        // the next reload shows the real state
      }
    };

    if (items === null) {
      return (
        <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
          {t("widget.loading")}
        </div>
      );
    }

    return (
      <div className="flex flex-col w-full h-full overflow-hidden">
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/50 text-[11px] font-semibold text-muted-foreground">
          <Bell size={11} />
          <span className="truncate">{widget.title || t("widget.name")}</span>
        </div>
        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            <CheckCircle size={20} className="text-green-500" />
            <span className="text-xs text-muted-foreground">
              {t("widget.allClear")}
            </span>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            {items.map((item) => (
              <div
                key={item.id}
                className={`flex items-start gap-2 px-2 py-1.5 border-b border-border/30 ${item.readAt ? "opacity-50" : ""}`}
              >
                <SeverityIcon severity={item.severity} />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-[10px] font-semibold text-foreground truncate">
                    {item.title}
                  </span>
                  <span className="text-[9px] text-muted-foreground truncate">
                    {timeAgo(item.createdAt, language)}
                  </span>
                </div>
                {!item.readAt && (
                  <button
                    type="button"
                    title={t("inbox.markRead")}
                    onClick={() => void markRead(item.id)}
                    className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <Check size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  return AlertFeedWidget;
}

export function AlertFeedEditForm({
  config,
  onChange,
}: {
  config: AlertFeedConfig;
  onChange: (config: AlertFeedConfig) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          {t("widget.maxItems")}
        </label>
        <Input
          type="number"
          min={1}
          max={50}
          value={config.maxItems}
          onChange={(e) =>
            onChange({
              ...config,
              maxItems: Math.min(50, Math.max(1, Number(e.target.value))),
            })
          }
          className="h-8 text-xs"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={showsRead(config)}
          onChange={(e) =>
            onChange({
              ...config,
              showRead: e.target.checked,
              showAcknowledged: undefined,
            })
          }
          className="accent-accent-brand"
        />
        {t("widget.showRead")}
      </label>
    </div>
  );
}

/** The widget's name in the homepage add menu, in this plugin's locale. */
export function AlertFeedLabel({ part }: { part: "name" | "description" }) {
  const { t } = useTranslation();
  return <>{t(part === "name" ? "widget.name" : "widget.description")}</>;
}
