import { useCallback, useRef } from "react";
import { GRID_SIZE } from "@/types/homepage-types";
import type { CanvasWidget, ResizeState } from "@/types/homepage-types";
import { snapToGrid } from "./snapToGrid";
import { getWidgetType } from "../widgets/WidgetRegistry";

interface UseBoxResizeOptions {
  widgets: CanvasWidget[];
  getZoom: () => number;
  onWidgetResize: (id: number, w: number, h: number) => void;
  onResizeStart: (id: number) => void;
  onResizeEnd: () => void;
}

export function useBoxResize({
  widgets,
  getZoom,
  onWidgetResize,
  onResizeStart,
  onResizeEnd,
}: UseBoxResizeOptions) {
  const resizeRef = useRef<ResizeState | null>(null);

  const startResize = useCallback(
    (e: React.MouseEvent, widget: CanvasWidget) => {
      e.stopPropagation();
      e.preventDefault();
      resizeRef.current = {
        widgetId: widget.id,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startW: widget.w,
        startH: widget.h,
      };
      onResizeStart(widget.id);

      const handleMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const zoom = getZoom();
        const dx = (ev.clientX - resizeRef.current.startMouseX) / zoom;
        const dy = (ev.clientY - resizeRef.current.startMouseY) / zoom;
        const newW = Math.max(
          GRID_SIZE * 2,
          snapToGrid(resizeRef.current.startW + dx),
        );
        const newH = Math.max(
          GRID_SIZE * 2,
          snapToGrid(resizeRef.current.startH + dy),
        );

        const moving = widgets.find(
          (w) => w.id === resizeRef.current!.widgetId,
        );
        if (!moving) return;

        const typeDef = getWidgetType(moving.typeId);
        const minW = typeDef?.minSize.w ?? GRID_SIZE * 4;
        const minH = typeDef?.minSize.h ?? GRID_SIZE * 4;
        const clampedW = Math.max(minW, newW);
        const clampedH = Math.max(minH, newH);

        if (clampedW !== moving.w || clampedH !== moving.h) {
          onWidgetResize(moving.id, clampedW, clampedH);
        }
      };

      const handleUp = () => {
        resizeRef.current = null;
        onResizeEnd();
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.addEventListener("mouseup", handleUp);
    },
    [widgets, getZoom, onWidgetResize, onResizeStart, onResizeEnd],
  );

  return { startResize };
}
