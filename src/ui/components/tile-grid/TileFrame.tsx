import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The look every tile shares with the dashboard: a small uppercase title row
 * over a body that scrolls when the tile has a fixed height. The grid draws
 * the lines between tiles. `bare` drops the title row.
 */
export function TileFrame({
  title,
  icon,
  actions,
  bare = false,
  onTitleClick,
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  bare?: boolean;
  onTitleClick?: () => void;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
        className,
      )}
    >
      {!bare && (title || icon || actions) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
          {icon && (
            <span className="flex shrink-0 text-muted-foreground [&_svg]:size-3">
              {icon}
            </span>
          )}
          {onTitleClick ? (
            <button
              type="button"
              onClick={onTitleClick}
              className="min-w-0 truncate text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              {title}
            </button>
          ) : (
            <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {title}
            </span>
          )}
          {actions && (
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {actions}
            </span>
          )}
        </div>
      )}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-auto thin-scrollbar",
          bodyClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}
