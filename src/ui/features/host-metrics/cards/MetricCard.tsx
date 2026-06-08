import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Card shell for Host Metrics tiles. Fills the grid tile (header + flexible
 * body), matching the dashboard card aesthetic (bordered, square corners,
 * uppercase tracking-widest header).
 */
export function MetricCard({
  title,
  icon,
  action,
  children,
  bodyClassName,
  scroll = false,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  /** When true the body scrolls instead of growing the tile. */
  scroll?: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border border-border bg-card">
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
      >
        {children}
      </div>
    </div>
  );
}
