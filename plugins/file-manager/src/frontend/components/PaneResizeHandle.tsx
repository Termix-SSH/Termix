import type React from "react";
import { cn } from "@/lib/utils.ts";

interface PaneResizeHandleProps {
  label: string;
  onMouseDown: (event: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  active?: boolean;
}

/**
 * Vertical drag handle placed between two panes in a `gap-3` flex row. It
 * overlaps the gap (negative margins) so the panes' spacing is unchanged, and
 * shows a hairline on hover / while dragging. Double-click resets the width.
 */
export function PaneResizeHandle({
  label,
  onMouseDown,
  onDoubleClick,
  active = false,
}: PaneResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      data-pane-resize-handle
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className="hidden md:block -mx-3 w-3 shrink-0 cursor-col-resize group relative z-10"
    >
      <div
        className={cn(
          "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors",
          active
            ? "bg-accent-brand"
            : "bg-transparent group-hover:bg-accent-brand/60",
        )}
      />
    </div>
  );
}
