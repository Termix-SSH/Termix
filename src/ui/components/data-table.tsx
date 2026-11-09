import type React from "react";
import { cn } from "@/lib/utils";

/**
 * A plain table in the tile look: sticky header on the page background, a
 * line under each row, no outer box. For wide data with real columns; use
 * DataView when the same list also has a card view.
 */
export function DataTable({
  className,
  containerClassName,
  children,
  ...props
}: React.ComponentProps<"table"> & {
  /** Classes for the scroll box around the table, like "flex-1". */
  containerClassName?: string;
}) {
  return (
    <div
      className={cn(
        "min-h-0 min-w-0 overflow-auto thin-scrollbar",
        containerClassName,
      )}
    >
      <table
        className={cn(
          "w-full border-collapse text-xs [&_td]:px-2 [&_td]:py-1.5 [&_th]:px-2 [&_th]:py-2 [&_th]:text-left [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-widest [&_th]:text-muted-foreground [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-background [&_thead_tr]:border-b [&_tr]:border-b [&_tr]:border-border",
          className,
        )}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

/** A body row that highlights on hover, and when active. */
export function DataTableRow({
  active = false,
  className,
  onClick,
  ...props
}: React.ComponentProps<"tr"> & { active?: boolean }) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "transition-colors",
        onClick && "cursor-pointer",
        active ? "bg-accent-brand/10" : "hover:bg-muted/40",
        className,
      )}
      {...props}
    />
  );
}
