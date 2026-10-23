import type React from "react";
import { cn } from "@/lib/utils";
import {
  PANEL,
  gridSizeStyle,
  type GridSize,
  type PanelDensity,
  type PanelViewMode,
} from "@/components/panel-layout";

export interface DataColumn<T> {
  key: string;
  header: string;
  /** Any grid track: "1fr", "120px", "minmax(0,2fr)". */
  width: string;
  cell: (item: T) => React.ReactNode;
  /** Hidden when the table itself is narrower than md (48rem) / lg (64rem). */
  hideBelow?: "md" | "lg";
  align?: "start" | "end";
}

/** Tracks for the columns visible at each width, so hidden ones take no space. */
function listColumnTemplates<T>(columns: DataColumn<T>[]): {
  base: string;
  md: string;
  lg: string;
} {
  return {
    base:
      columns
        .filter((column) => column.hideBelow === undefined)
        .map((column) => column.width)
        .join(" ") || "none",
    md:
      columns
        .filter((column) => column.hideBelow !== "lg")
        .map((column) => column.width)
        .join(" ") || "none",
    lg: columns.map((column) => column.width).join(" ") || "none",
  };
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

const LIST_GRID_CLASS =
  "grid grid-cols-[var(--data-view-cols)] @min-[48rem]:grid-cols-[var(--data-view-cols-md)] @min-[64rem]:grid-cols-[var(--data-view-cols-lg)] gap-x-2 px-3";

function gridClass(columns: GridColumns): string {
  return cn(
    COLS[columns.base ?? 1],
    columns.md && MD_COLS[columns.md],
    columns.lg && LG_COLS[columns.lg],
    columns.xl && XL_COLS[columns.xl],
  );
}

function columnVisibility(hideBelow?: "md" | "lg"): string {
  if (hideBelow === "md") return "hidden @min-[48rem]:block";
  if (hideBelow === "lg") return "hidden @min-[64rem]:block";
  return "";
}

/** One collection as a card grid or a dense row table. */
export function DataView<T>({
  items,
  view,
  density,
  getKey,
  renderCard,
  columns,
  size,
  minCardWidth,
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
  /** Breakpoint columns, used when no size is given. */
  columns: GridColumns;
  /** Columns the user picked with ViewToggle. Wins over columns. */
  size?: GridSize;
  /** Narrowest card in auto mode, in px. */
  minCardWidth?: number;
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
      <div
        className={cn(
          "grid",
          PANEL.gap,
          !size && gridClass(columns),
          className,
        )}
        style={size ? gridSizeStyle(size, minCardWidth) : undefined}
      >
        {items.map((item) => (
          <div key={getKey(item)} className="flex flex-col *:flex-1">
            {renderCard(item)}
          </div>
        ))}
      </div>
    );
  }

  const templates = listColumnTemplates(listColumns);
  const rowHeight = density === "compact" ? "min-h-7" : "min-h-9";

  return (
    <div
      className={cn("@container border border-border bg-card", className)}
      style={
        {
          "--data-view-cols": templates.base,
          "--data-view-cols-md": templates.md,
          "--data-view-cols-lg": templates.lg,
        } as React.CSSProperties
      }
      role="table"
    >
      <div
        className={cn(
          LIST_GRID_CLASS,
          "sticky top-0 z-10 items-center border-b border-border bg-card text-[10px] font-semibold uppercase tracking-widest text-muted-foreground",
        )}
      >
        {listColumns.map((column) => (
          <span
            key={column.key}
            className={cn(
              "truncate py-2",
              column.align === "end" && "text-right",
              columnVisibility(column.hideBelow),
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
                LIST_GRID_CLASS,
                "items-center border-b border-border/50 text-xs transition-colors last:border-0",
                rowHeight,
                onRowClick && "cursor-pointer",
                active ? "bg-accent-brand/10" : "hover:bg-muted/40",
              )}
            >
              {listColumns.map((column) => (
                <div
                  key={column.key}
                  className={cn(
                    "min-w-0 truncate",
                    column.align === "end" && "text-right",
                    columnVisibility(column.hideBelow),
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
