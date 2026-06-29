import { useCallback, useRef } from "react";
import { MIN_ZOOM, MAX_ZOOM } from "@/types/homepage-types";
import { zoomAroundPoint } from "./canvasGeometry";

interface UseCanvasInputOptions {
  isDraggingWidget: boolean;
  isResizing: boolean;
  isContextMenuVisible: boolean;
  onPanChange: (pan: { x: number; y: number }) => void;
  onZoomChange: (zoom: number, pan: { x: number; y: number }) => void;
  getPan: () => { x: number; y: number };
  getZoom: () => number;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function useCanvasInput({
  isDraggingWidget,
  isResizing,
  isContextMenuVisible,
  onPanChange,
  onZoomChange,
  getPan,
  getZoom,
  containerRef,
}: UseCanvasInputOptions) {
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only pan on the background (not on widgets), left button
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("[data-widget]")) return;
      if (isDraggingWidget || isResizing || isContextMenuVisible) return;

      isPanningRef.current = true;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    },
    [isDraggingWidget, isResizing, isContextMenuVisible],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanningRef.current) return;
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      const pan = getPan();
      onPanChange({ x: pan.x + dx, y: pan.y + dy });
    },
    [getPan, onPanChange],
  );

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const zoom = getZoom();
      const pan = getPan();

      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Multiplicative zoom so each step is proportional regardless of current zoom level.
      // Normalize deltaY to avoid trackpad sending huge values.
      const rawDelta = Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 100);
      const factor = 1 - rawDelta * 0.001;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
      if (newZoom === zoom) return;

      const newPan = zoomAroundPoint(mouseX, mouseY, pan, zoom, newZoom);
      onZoomChange(newZoom, newPan);
    },
    [getZoom, getPan, containerRef, onZoomChange],
  );

  return { handleMouseDown, handleMouseMove, handleMouseUp, handleWheel };
}
