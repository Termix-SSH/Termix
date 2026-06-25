import { useEffect, useState } from "react";
import { Container } from "lucide-react";
import { useTranslation } from "react-i18next";
import { registerWidget } from "./WidgetRegistry";
import type {
  DockerActivityConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { getRecentActivity } from "@/api/dashboard-api";
import type { RecentActivityItem } from "@/api/dashboard-api";
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

function DockerActivityWidget({
  widget,
  config,
}: WidgetComponentProps<DockerActivityConfig>) {
  const { t } = useTranslation();
  const { maxItems, showHostName } = config;
  const [items, setItems] = useState<RecentActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const data = await getRecentActivity(maxItems * 5);
      setItems(data.filter((i) => i.type === "docker").slice(0, maxItems));
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
  }, [maxItems]);

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.loading")}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
        {t("homepage.noDockerActivity")}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle
        title={widget.title || t("homepage.widgetDockerActivityName")}
        icon={<Container size={11} />}
      />
      <div className="flex-1 overflow-auto">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 px-2 py-1.5 border-b border-border/30"
          >
            <Container size={10} className="shrink-0 text-muted-foreground" />
            <div className="flex flex-col min-w-0 flex-1">
              {showHostName && (
                <span className="text-[10px] font-medium text-foreground truncate">
                  {item.hostName}
                </span>
              )}
              <span className="text-[9px] text-muted-foreground">
                {relativeTime(item.timestamp)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

registerWidget<DockerActivityConfig>({
  id: "docker_activity",
  name: "Docker Activity",
  description: "Recent Docker connection activity across your hosts",
  category: "system",
  icon: <Container size={14} />,
  defaultConfig: { maxItems: 10, showHostName: true },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 8 },
  minSize: { w: GRID_SIZE * 4, h: GRID_SIZE * 4 },
  component: DockerActivityWidget,
});

export { DockerActivityWidget };
