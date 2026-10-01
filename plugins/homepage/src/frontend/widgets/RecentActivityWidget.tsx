import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { useTranslation, activityTarget } from "@termix/plugin-sdk/frontend";

import {
  WidgetTitle,
  getRecentActivity,
  runVisibleInterval,
  type RecentActivityItem,
} from "@termix/plugin-sdk/ui";
import { registerWidget } from "./WidgetRegistry";
import type {
  RecentActivityConfig,
  ActivityType,
  WidgetComponentProps,
} from "../types.js";
import { GRID_SIZE } from "../types.js";

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ActivityIcon({ type }: { type: string }) {
  const Icon = activityTarget(type)?.icon ?? Activity;
  return <Icon className="size-2.5 shrink-0 text-accent-brand" />;
}

function RecentActivityWidget({
  widget,
  config,
}: WidgetComponentProps<RecentActivityConfig>) {
  const { t } = useTranslation();
  const { maxItems, filterTypes, showTimestamp } = config;
  const [items, setItems] = useState<RecentActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const data = await getRecentActivity(maxItems * 3);
      const filtered =
        filterTypes.length > 0
          ? data.filter((i) => filterTypes.includes(i.type as ActivityType))
          : data;
      setItems(filtered.slice(0, maxItems));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    return runVisibleInterval(() => {
      void fetchData();
    }, 60_000);
  }, [maxItems, filterTypes.join(",")]);

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.noActivity")}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle
        title={widget.title || t("homepage.widgetRecentActivityName")}
        icon={<Activity size={11} />}
      />
      <div className="flex-1 overflow-auto">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 px-2 py-1.5 border-b border-border/30"
          >
            <ActivityIcon type={item.type} />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[10px] font-medium text-foreground truncate">
                {item.hostName}
              </span>
              <span className="text-[9px] text-muted-foreground capitalize">
                {item.type.replace("_", " ")}
              </span>
            </div>
            {showTimestamp && (
              <span className="text-[9px] text-muted-foreground shrink-0">
                {relativeTime(item.timestamp)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

registerWidget<RecentActivityConfig>({
  id: "recent_activity",
  name: "Recent Activity",
  description: "Shows recent terminal, Docker, file, and tunnel activity",
  category: "system",
  icon: <Activity size={14} />,
  defaultConfig: { maxItems: 10, filterTypes: [], showTimestamp: true },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 9 },
  minSize: { w: GRID_SIZE * 4, h: GRID_SIZE * 3 },
  component: RecentActivityWidget,
});

export { RecentActivityWidget };
