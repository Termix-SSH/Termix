import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";

export interface ResizableColumnSpec {
  /** Stable key, also used for persistence. */
  key: string;
  /** i18n key for the column's label (used by the show/hide menu). */
  labelKey: string;
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
}

interface UseResizableColumnsOptions {
  /** localStorage key; widths are remembered per pane. */
  storageKey: string;
  /**
   * Fixed-width columns, in visual order, that follow a leading flexible
   * column (the file name). The flexible column absorbs whatever is left.
   */
  columns: ResizableColumnSpec[];
}

const DEFAULT_MIN = 48;
const DEFAULT_MAX = 600;

function readStoredWidths(
  storageKey: string,
  columns: ResizableColumnSpec[],
): Record<string, number> {
  const widths: Record<string, number> = {};
  for (const column of columns) widths[column.key] = column.defaultWidth;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return widths;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const column of columns) {
      const value = parsed?.[column.key];
      if (typeof value === "number" && Number.isFinite(value)) {
        widths[column.key] = clamp(value, column);
      }
    }
  } catch {
    // storage unavailable or corrupt: fall back to defaults
  }
  return widths;
}

function readHiddenKeys(
  storageKey: string,
  columns: ResizableColumnSpec[],
): Set<string> {
  try {
    const raw = localStorage.getItem(`${storageKey}:hidden`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const known = new Set(columns.map((c) => c.key));
    return new Set(
      parsed.filter((k): k is string => typeof k === "string" && known.has(k)),
    );
  } catch {
    return new Set();
  }
}

function clamp(value: number, column: ResizableColumnSpec): number {
  const min = column.minWidth ?? DEFAULT_MIN;
  const max = column.maxWidth ?? DEFAULT_MAX;
  return Math.round(Math.min(max, Math.max(min, value)));
}

/**
 * Column widths for a list view whose first column is flexible and whose
 * remaining columns are fixed and user-resizable by dragging the boundary at
 * the left edge of each header cell. Double-clicking a handle resets that
 * column to its default. Widths persist in localStorage.
 */
export function useResizableColumns({
  storageKey,
  columns,
}: UseResizableColumnsOptions) {
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    readStoredWidths(storageKey, columns),
  );
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() =>
    readHiddenKeys(storageKey, columns),
  );
  const [resizingKey, setResizingKey] = useState<string | null>(null);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  // Re-read if the pane is re-keyed (e.g. a different storage key).
  useEffect(() => {
    setWidths(readStoredWidths(storageKey, columns));
    setHiddenKeys(readHiddenKeys(storageKey, columns));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const isVisible = useCallback(
    (key: string) => !hiddenKeys.has(key),
    [hiddenKeys],
  );

  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenKeys.has(c.key)),
    [columns, hiddenKeys],
  );

  const toggleColumn = useCallback(
    (key: string) => {
      setHiddenKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        try {
          localStorage.setItem(
            `${storageKey}:hidden`,
            JSON.stringify(Array.from(next)),
          );
        } catch {
          // storage unavailable
        }
        return next;
      });
    },
    [storageKey],
  );

  const persist = useCallback(
    (next: Record<string, number>) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // storage unavailable
      }
    },
    [storageKey],
  );

  const gridTemplateColumns = useMemo(
    () =>
      [
        "minmax(0, 1fr)",
        ...visibleColumns.map((c) => `${widths[c.key]}px`),
      ].join(" "),
    [visibleColumns, widths],
  );

  const startResize = useCallback(
    (key: string, event: React.MouseEvent) => {
      const column = columns.find((c) => c.key === key);
      if (!column) return;
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = widthsRef.current[key];
      setResizingKey(key);

      const onMove = (e: MouseEvent) => {
        // The handle sits on the column's left edge, so dragging right
        // narrows the column and dragging left widens it.
        const next = clamp(startWidth - (e.clientX - startX), column);
        if (next !== widthsRef.current[key]) {
          setWidths((prev) => ({ ...prev, [key]: next }));
        }
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setResizingKey(null);
        persist(widthsRef.current);

        // The browser dispatches a click to the common ancestor of the
        // mousedown/mouseup targets, which here is the sortable header cell.
        // Swallow that one click so finishing a drag never toggles the sort.
        const swallow = (e: MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();
        };
        document.addEventListener("click", swallow, { capture: true });
        setTimeout(
          () =>
            document.removeEventListener("click", swallow, { capture: true }),
          0,
        );
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [columns, persist],
  );

  const resetColumn = useCallback(
    (key: string) => {
      const column = columns.find((c) => c.key === key);
      if (!column) return;
      setWidths((prev) => {
        const next = { ...prev, [key]: column.defaultWidth };
        persist(next);
        return next;
      });
    },
    [columns, persist],
  );

  const getHandleProps = useCallback(
    (key: string) => ({
      onMouseDown: (event: React.MouseEvent) => startResize(key, event),
      onDoubleClick: (event: React.MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        resetColumn(key);
      },
      onClick: (event: React.MouseEvent) => event.stopPropagation(),
      "data-resizing": resizingKey === key ? "true" : undefined,
    }),
    [startResize, resetColumn, resizingKey],
  );

  return {
    widths,
    gridTemplateColumns,
    getHandleProps,
    resizingKey,
    columns,
    visibleColumns,
    isVisible,
    toggleColumn,
  };
}

export type ResizableColumns = ReturnType<typeof useResizableColumns>;
