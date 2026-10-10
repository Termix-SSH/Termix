import type React from "react";
import { cn } from "@/lib/utils";
import {
  PANEL,
  type PanelDensity,
  type PanelViewMode,
} from "@/components/panel-layout";

export interface DataColumn<T> {
  key: string;
  header: string;
  /** Any grid track: "1fr", "120px", "minmax(0,2fr)". */
  width: string;
  cell: (item: T) => React.ReactNode;
  /** Dropped below md, for columns that are nice rather than necessary. */
  hideBelow?: "md" | "lg";
  align?: "start" | "end";
}

export interface GridColumns {
  base?: number;
  md?: number;
  lg?: number;
  xl?: number;
}

// Spelled out so Tailwind can see every class.
const COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};
const MD_COLS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};
const LG_COLS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};
const XL_COLS: Record<number, string> = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-2",
  3: "xl:grid-cols-3",
  4: "xl:grid-cols-4",
};

function gridClass(columns: GridColumns): string {
  return cn(
    COLS[columns.base ?? 1],
    columns.md && MD_COLS[columns.md],
    columns.lg && LG_COLS[columns.lg],
    columns.xl && XL_COLS[columns.xl],
  );
}

/** One collection as a card grid or a dense row table. */
export function DataView<T>({
  items,
  view,
  density,
  getKey,
  renderCard,
  columns,
  listColumns,
  onRowClick,
  isRowActive,
  empty,
  className,
}: {
  items: T[];
  view: PanelViewMode;
  density?: PanelDensity;
  getKey: (item: T) => string;
  renderCard: (item: T) => React.ReactNode;
  columns: GridColumns;
  listColumns: DataColumn<T>[];
  onRowClick?: (item: T) => void;
  isRowActive?: (item: T) => boolean;
  empty: React.ReactNode;
  className?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">{empty}</div>
    );
  }

  if (view === "grid") {
    return (
      <div className={cn("grid", PANEL.gap, gridClass(columns), className)}>
        {items.map((item) => (
          <div key={getKey(item)}>{renderCard(item)}</div>
        ))}
      </div>
    );
  }

  const template = listColumns.map((c) => c.width).join(" ");
  const rowHeight = density === "compact" ? "h-7" : "h-9";

  return (
    <div className={cn("border border-border bg-card", className)} role="table">
      <div
        className="sticky top-0 z-10 grid items-center border-b border-border bg-card px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
        style={{ gridTemplateColumns: template }}
      >
        {listColumns.map((column) => (
          <span
            key={column.key}
            className={cn(
              "truncate py-2",
              column.align === "end" && "text-right",
              column.hideBelow === "md" && "hidden md:block",
              column.hideBelow === "lg" && "hidden lg:block",
            )}
          >
            {column.header}
          </span>
        ))}
      </div>

      <div>
        {items.map((item) => {
          const active = isRowActive?.(item) ?? false;
          return (
            <div
              key={getKey(item)}
              onClick={onRowClick ? () => onRowClick(item) : undefined}
              className={cn(
                "grid items-center gap-x-2 border-b border-border/50 px-3 text-xs transition-colors last:border-0",
                rowHeight,
                onRowClick && "cursor-pointer",
                active ? "bg-accent-brand/10" : "hover:bg-muted/40",
              )}
              style={{ gridTemplateColumns: template }}
            >
              {listColumns.map((column) => (
                <div
                  key={column.key}
                  className={cn(
                    "min-w-0 truncate",
                    column.align === "end" && "text-right",
                    column.hideBelow === "md" && "hidden md:block",
                    column.hideBelow === "lg" && "hidden lg:block",
                  )}
                >
                  {column.cell(item)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
