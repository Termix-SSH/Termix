import { useCallback, useRef } from "react";
import type { CanvasWidget, DragState } from "@/types/homepage-types";
import { snapToGrid } from "./snapToGrid";

interface UseBoxDragOptions {
  widgets: CanvasWidget[];
  zoom: number;
  getZoom: () => number;
  onWidgetMove: (id: number, x: number, y: number) => void;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
}

export function useBoxDrag({
  widgets,
  getZoom,
  onWidgetMove,
  onDragStart,
  onDragEnd,
}: UseBoxDragOptions) {
  const dragRef = useRef<DragState | null>(null);

  const startDrag = useCallback(
    (e: React.MouseEvent, widget: CanvasWidget) => {
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = {
        widgetId: widget.id,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startWidgetX: widget.x,
        startWidgetY: widget.y,
      };
      onDragStart(widget.id);

      const handleMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const zoom = getZoom();
        const dx = (ev.clientX - dragRef.current.startMouseX) / zoom;
        const dy = (ev.clientY - dragRef.current.startMouseY) / zoom;
        const newX = snapToGrid(dragRef.current.startWidgetX + dx);
        const newY = snapToGrid(dragRef.current.startWidgetY + dy);

        const moving = widgets.find((w) => w.id === dragRef.current!.widgetId);
        if (!moving) return;

        if (newX !== moving.x || newY !== moving.y) {
          onWidgetMove(moving.id, newX, newY);
        }
      };

      const handleUp = () => {
        dragRef.current = null;
        onDragEnd();
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [widgets, getZoom, onWidgetMove, onDragStart, onDragEnd],
  );

  return { startDrag };
}
