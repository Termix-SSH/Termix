import type { ReactNode } from "react";
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
  return (
    <div className="flex min-h-0 flex-col overflow-hidden border border-border bg-card">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="text-muted-foreground">{icon}</span>
        <span className="flex-1 truncate text-xs font-semibold uppercase tracking-widest text-muted-foreground">
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
