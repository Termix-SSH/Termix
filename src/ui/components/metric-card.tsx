import type { ReactNode } from "react";
import { useInSeamlessTile } from "@/components/tile-grid/context";
import { cn } from "@/lib/utils";

/** Default cap (px) for a scrollable card body before it scrolls. */
const DEFAULT_SCROLL_MAX = 360;

/**
 * Card shell for Host Metrics tiles. In the masonry grid tiles are
 * content-sized (auto height), so the card grows to fit its content. Scrollable
 * cards (long lists/logs) cap their body at `scrollMax` px and scroll beyond,
 * which keeps the masonry tidy while short cards stay compact.
 */
export function MetricCard({
  title,
  icon,
  action,
  children,
  bodyClassName,
  scroll = false,
  scrollMax = DEFAULT_SCROLL_MAX,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  /** When true the body caps its height and scrolls instead of growing. */
  scroll?: boolean;
  /** Max body height in px for scrollable cards. */
  scrollMax?: number;
}) {
  // In an edge to edge tile grid the grid draws the lines, so the card takes
  // the dashboard tile look: no border or fill, the small title row.
  const tiled = useInSeamlessTile();
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden",
        !tiled && "border border-border bg-card",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 border-b border-border",
          tiled ? "px-3 py-1.5" : "px-4 py-2.5",
        )}
      >
        <span
          className={cn(
            "text-muted-foreground",
            tiled && "flex [&_svg]:size-3",
          )}
        >
          {icon}
        </span>
        <span
          className={cn(
            "flex-1 truncate font-semibold uppercase tracking-widest text-muted-foreground",
            tiled ? "text-[10px]" : "text-xs",
          )}
        >
          {title}
        </span>
        {action && <div className="ml-auto shrink-0">{action}</div>}
      </div>
      <div
        className={cn(
          "min-h-0 flex-1 px-3 py-3 md:px-4",
          scroll ? "overflow-y-auto thin-scrollbar" : "overflow-hidden",
          bodyClassName,
        )}
        style={scroll ? { maxHeight: scrollMax } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
