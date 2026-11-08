import type { ComponentType, ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Select2 } from "@/components/select2";

export interface SideNavEntry {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** A count or short badge after the label. */
  badge?: ReactNode;
  /** Opens it in a normal tab instead, for split view. */
  onPopOut?: () => void;
  popOutLabel?: string;
  /** Draws a line above this entry. */
  divider?: boolean;
}

/**
 * The left list of sections a page switches between, like the host page and
 * the Operations tab. On a phone it turns into a select over the content.
 */
export function SideNav({
  entries,
  active,
  onSelect,
  footer,
  label,
  className,
}: {
  entries: SideNavEntry[];
  /** Names the list for screen readers and the phone select. */
  label?: string;
  active: string;
  onSelect: (id: string) => void;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <>
      <nav
        aria-label={label}
        className={cn(
          "hidden w-44 shrink-0 flex-col gap-0.5 overflow-auto border-r border-border p-2 thin-scrollbar md:flex",
          className,
        )}
      >
        {entries.map((entry) => (
          <div key={entry.id} className="contents">
            {entry.divider && (
              <div
                role="separator"
                className="-mx-2 my-1.5 shrink-0 border-t border-border"
              />
            )}
            <SideNavItem
              entry={entry}
              active={entry.id === active}
              onClick={() => onSelect(entry.id)}
            />
          </div>
        ))}
        {footer && <div className="mt-auto pt-2">{footer}</div>}
      </nav>
      <div className="shrink-0 border-b border-border p-2 md:hidden">
        <Select2
          value={active}
          aria-label={label}
          onChange={(event) => onSelect(event.target.value)}
          className="h-8 w-full px-2.5 text-xs"
        >
          {entries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </Select2>
      </div>
    </>
  );
}

export function SideNavItem({
  entry,
  active,
  onClick,
}: {
  entry: SideNavEntry;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = entry.icon;
  return (
    <div
      className={cn(
        "group flex items-center",
        active
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-xs"
      >
        {Icon && <Icon className="size-3.5 shrink-0" />}
        <span className="truncate">{entry.label}</span>
        {entry.badge !== undefined && entry.badge !== null && (
          <span className="ml-auto shrink-0 px-1 text-[10px] tabular-nums">
            {entry.badge}
          </span>
        )}
      </button>
      {entry.onPopOut && (
        <button
          type="button"
          title={entry.popOutLabel}
          aria-label={entry.popOutLabel}
          onClick={entry.onPopOut}
          className={cn(
            "mr-1 shrink-0 p-1 text-muted-foreground hover:text-foreground",
            !active && "opacity-0 focus:opacity-100 group-hover:opacity-100",
          )}
        >
          <ExternalLink className="size-3" />
        </button>
      )}
    </div>
  );
}
