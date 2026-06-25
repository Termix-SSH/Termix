import { useState } from "react";
import { Pencil, Trash2, GripVertical } from "lucide-react";
import type { CanvasWidget } from "@/types/homepage-types";
import { getWidgetType } from "./WidgetRegistry";

interface WidgetShellProps {
  widget: CanvasWidget;
  isLocked?: boolean;
  isReadOnly?: boolean;
  isDragging?: boolean;
  isResizing?: boolean;
  onStartDrag?: (e: React.MouseEvent, widget: CanvasWidget) => void;
  onStartResize?: (e: React.MouseEvent, widget: CanvasWidget) => void;
  onDelete?: (id: number) => void;
  onEdit?: (id: number) => void;
  onConfigUpdate?: (config: Record<string, unknown>) => void;
  children?: React.ReactNode;
}

export function WidgetShell({
  widget,
  isLocked,
  isReadOnly,
  isDragging,
  isResizing,
  onStartDrag,
  onStartResize,
  onDelete,
  onEdit,
  onConfigUpdate,
  children,
}: WidgetShellProps) {
  const [hovered, setHovered] = useState(false);
  const typeDef = getWidgetType(widget.typeId);
  const showControls =
    hovered && !isLocked && !isReadOnly && !isDragging && !isResizing;

  const WidgetComponent = typeDef?.component;

  return (
    <div
      data-widget={widget.id}
      className={`absolute overflow-hidden select-none transition-shadow duration-150 ${
        hovered && !isLocked && !isReadOnly
          ? "ring-1 ring-accent-brand/30 shadow-md"
          : "ring-1 ring-border/60"
      }`}
      style={{
        left: widget.x,
        top: widget.y,
        width: widget.w,
        height: widget.h,
        background: "var(--color-card)",
        opacity: isDragging ? 0.85 : 1,
        transform: isDragging ? "scale(1.02)" : undefined,
        boxShadow:
          isDragging || isResizing ? "0 8px 32px rgba(0,0,0,0.25)" : undefined,
        cursor:
          isLocked || isReadOnly ? "default" : isDragging ? "grabbing" : "grab",
      }}
      onWheel={(e) => {
        // Find the nearest scrollable ancestor within this widget
        let el = e.target as HTMLElement | null;
        while (el && el !== e.currentTarget) {
          const canScrollY = el.scrollHeight > el.clientHeight;
          const canScrollX = el.scrollWidth > el.clientWidth;
          if (canScrollY || canScrollX) {
            e.stopPropagation();
            break;
          }
          el = el.parentElement;
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={
        !isLocked && !isReadOnly ? (e) => onStartDrag?.(e, widget) : undefined
      }
    >
      {/* Widget content */}
      {children ??
        (WidgetComponent ? (
          <WidgetComponent
            widget={widget}
            config={widget.config as Record<string, unknown>}
            isReadOnly={isReadOnly}
            onConfigUpdate={onConfigUpdate}
          />
        ) : (
          <div className="flex items-center justify-center w-full h-full text-xs text-muted-foreground">
            Unknown widget
          </div>
        ))}

      {/* Hover controls */}
      {showControls && (
        <>
          {/* Top-right action bar */}
          <div
            className="absolute top-1 right-1 flex items-center gap-0.5 z-10"
            style={{ opacity: hovered ? 1 : 0, transition: "opacity 0.1s" }}
          >
            <div className="p-1 text-muted-foreground/40 cursor-grab">
              <GripVertical size={10} />
            </div>
            <button
              className="p-1 bg-background/90 hover:bg-background border border-border text-muted-foreground hover:text-foreground transition-colors"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onEdit?.(widget.id);
              }}
              title="Edit"
            >
              <Pencil size={10} />
            </button>
            <button
              className="p-1 bg-background/90 hover:bg-destructive border border-border text-muted-foreground hover:text-destructive-foreground transition-colors"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.(widget.id);
              }}
              title="Delete"
            >
              <Trash2 size={10} />
            </button>
          </div>

          {/* Resize handle — bottom right */}
          <div
            className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize z-10 flex items-end justify-end pb-0.5 pr-0.5"
            onMouseDown={(e) => {
              e.stopPropagation();
              onStartResize?.(e, widget);
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              className="text-muted-foreground/50"
            >
              <line
                x1="2"
                y1="10"
                x2="10"
                y2="2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <line
                x1="6"
                y1="10"
                x2="10"
                y2="6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
