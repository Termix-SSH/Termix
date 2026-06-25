import { useEffect, useState } from "react";
import { Rss, ExternalLink } from "lucide-react";
import { registerWidget } from "./WidgetRegistry";
import { homepageApi } from "@/main-axios";
import type {
  RssFeedConfig,
  WidgetComponentProps,
} from "@/types/homepage-types";
import { GRID_SIZE } from "@/types/homepage-types";
import { WidgetTitle } from "./WidgetTitle";

interface RssItem {
  title: string;
  link: string;
  pubDate: string | null;
  description: string | null;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const diffMs = Date.now() - d.getTime();
    const diffH = Math.floor(diffMs / 3_600_000);
    if (diffH < 1) return "just now";
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function RssFeedWidget({
  widget,
  config,
  isReadOnly,
}: WidgetComponentProps<RssFeedConfig>) {
  const { feedUrl, maxItems, showDescription } = config;
  const [items, setItems] = useState<RssItem[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!feedUrl) return;
    let cancelled = false;
    const fetchFeed = async () => {
      try {
        setLoading(true);
        setError(false);
        const res = await homepageApi.get(
          `/rss?url=${encodeURIComponent(feedUrl)}&max=${maxItems ?? 10}`,
        );
        if (!cancelled) setItems(res.data);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchFeed();
    return () => {
      cancelled = true;
    };
  }, [feedUrl, maxItems]);

  if (!feedUrl) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2 text-muted-foreground/50">
        <Rss size={24} />
        <span className="text-xs">Configure a feed URL in widget settings</span>
      </div>
    );
  }

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground/50">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-full text-xs text-destructive/70 p-3 text-center">
        Could not load feed
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full overflow-hidden">
      <WidgetTitle
        title={widget.title || "RSS Feed"}
        icon={<Rss size={11} />}
      />

      {/* Items */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground/50">
            No items
          </div>
        ) : (
          items.map((item, i) => (
            <div key={i} className="border-b border-border/60 last:border-0">
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex flex-col px-3 py-2 gap-0.5 hover:bg-muted/40 transition-colors no-underline ${isReadOnly ? "pointer-events-none" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-medium text-foreground line-clamp-2 leading-snug flex-1">
                    {item.title}
                  </span>
                  <ExternalLink
                    size={9}
                    className="text-muted-foreground/40 shrink-0 mt-0.5"
                  />
                </div>
                {showDescription && item.description && (
                  <span className="text-[10px] text-muted-foreground/70 line-clamp-2">
                    {item.description.replace(/<[^>]+>/g, "")}
                  </span>
                )}
                {item.pubDate && (
                  <span className="text-[9px] text-muted-foreground/50">
                    {formatDate(item.pubDate)}
                  </span>
                )}
              </a>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

registerWidget<RssFeedConfig>({
  id: "rss_feed",
  name: "RSS Feed",
  description: "Display items from an RSS or Atom feed",
  category: "links",
  icon: <Rss size={14} />,
  defaultConfig: { feedUrl: "", maxItems: 10, showDescription: false },
  defaultSize: { w: GRID_SIZE * 10, h: GRID_SIZE * 10 },
  minSize: { w: GRID_SIZE * 2, h: GRID_SIZE * 2 },
  component: RssFeedWidget,
});

export { RssFeedWidget };
