import { useCallback, useRef, useState } from "react";
import type React from "react";

interface UsePaneWidthOptions {
  /** localStorage key the width is remembered under. */
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  /**
   * Upper bound as a fraction of the containing row's width (measured at
   * drag start from `containerRef`), so a pane can never swallow the layout.
   */
  maxFraction?: number;
  containerRef?: React.RefObject<HTMLElement | null>;
}

function readStoredWidth(
  storageKey: string,
  defaultWidth: number,
  minWidth: number,
): number {
  try {
    const saved = Number(localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved >= minWidth ? saved : defaultWidth;
  } catch {
    return defaultWidth;
  }
}

/**
 * A persisted, drag-resizable pane width. `startResize` goes on the
 * mousedown of a vertical drag handle sitting on the pane's right edge;
 * `resetWidth` (e.g. on double-click) restores the default.
 */
export function usePaneWidth({
  storageKey,
  defaultWidth,
  minWidth,
  maxFraction = 0.65,
  containerRef,
}: UsePaneWidthOptions) {
  const [width, setWidth] = useState<number>(() =>
    readStoredWidth(storageKey, defaultWidth, minWidth),
  );
  const [isResizing, setIsResizing] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  const persist = useCallback(
    (value: number) => {
      try {
        localStorage.setItem(storageKey, String(value));
      } catch {
        // storage unavailable
      }
    },
    [storageKey],
  );

  const startResize = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = widthRef.current;
      const rowWidth =
        containerRef?.current?.getBoundingClientRect().width ?? 0;
      const maxWidth = Math.max(
        minWidth,
        rowWidth ? rowWidth * maxFraction : Number.POSITIVE_INFINITY,
      );
      let latest = startWidth;
      setIsResizing(true);

      const onMove = (e: MouseEvent) => {
        latest = Math.round(
          Math.min(
            maxWidth,
            Math.max(minWidth, startWidth + (e.clientX - startX)),
          ),
        );
        if (latest !== widthRef.current) setWidth(latest);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setIsResizing(false);
        persist(latest);
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [containerRef, maxFraction, minWidth, persist],
  );

  const resetWidth = useCallback(() => {
    setWidth(defaultWidth);
    persist(defaultWidth);
  }, [defaultWidth, persist]);

  return { width, isResizing, startResize, resetWidth };
}
