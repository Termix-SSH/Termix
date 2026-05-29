import React, { useState, useRef, useEffect, memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { splitDragState, notifyDragEnd } from "@/lib/splitDragging";
import { tabIcon } from "@/shell/tabUtils";
import type { Tab, SplitMode } from "@/types/ui-types";

// ─── useSplitSizes ────────────────────────────────────────────────────────────

type RowColSizes = number[][];

function defaultSizes(mode: SplitMode): {
  rowSizes: number[];
  rowColSizes: RowColSizes;
} {
  switch (mode) {
    case "2-way":
      return { rowSizes: [100], rowColSizes: [[50, 50]] };
    case "3-way":
      return { rowSizes: [50, 50], rowColSizes: [[50, 50], [100]] };
    case "3-way-horizontal":
      return { rowSizes: [50, 50], rowColSizes: [[50, 50], [100]] };
    case "4-way":
      return {
        rowSizes: [50, 50],
        rowColSizes: [
          [50, 50],
          [50, 50],
        ],
      };
    case "5-way":
      return {
        rowSizes: [50, 50],
        rowColSizes: [
          [33.3, 33.3, 33.4],
          [33.3, 66.7],
        ],
      };
    case "6-way":
      return {
        rowSizes: [50, 50],
        rowColSizes: [
          [33.3, 33.3, 33.4],
          [33.3, 33.3, 33.4],
        ],
      };
    default:
      return { rowSizes: [100], rowColSizes: [[100]] };
  }
}

function useSplitSizes(splitMode: SplitMode) {
  const init = defaultSizes(splitMode);
  const [rowSizes, setRowSizes] = useState(init.rowSizes);
  const [rowColSizes, setRowColSizes] = useState<RowColSizes>(init.rowColSizes);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const d = defaultSizes(splitMode);
    setRowSizes(d.rowSizes);
    setRowColSizes(d.rowColSizes);
  }, [splitMode]);

  function reset() {
    const d = defaultSizes(splitMode);
    setRowSizes(d.rowSizes);
    setRowColSizes(d.rowColSizes);
  }

  function startDrag() {
    splitDragState.active = true;
    setIsDragging(true);
  }
  function endDrag() {
    splitDragState.active = false;
    setIsDragging(false);
    notifyDragEnd();
  }

  function onRowDivider(e: React.MouseEvent, rowIdx: number) {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    startDrag();
    const totalH = container.getBoundingClientRect().height;
    const startY = e.clientY;
    const a = rowSizes[rowIdx],
      b = rowSizes[rowIdx + 1];
    function onMove(ev: MouseEvent) {
      const na = Math.max(
        10,
        Math.min(a + b - 10, a + ((ev.clientY - startY) / totalH) * 100),
      );
      setRowSizes((prev) => {
        const n = [...prev];
        n[rowIdx] = na;
        n[rowIdx + 1] = a + b - na;
        return n;
      });
    }
    function onUp() {
      endDrag();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function onRowDividerTouch(e: React.TouchEvent, rowIdx: number) {
    const container = containerRef.current;
    if (!container) return;
    startDrag();
    const totalH = container.getBoundingClientRect().height;
    const startY = e.touches[0].clientY;
    const a = rowSizes[rowIdx],
      b = rowSizes[rowIdx + 1];
    function onMove(ev: TouchEvent) {
      const na = Math.max(
        10,
        Math.min(
          a + b - 10,
          a + ((ev.touches[0].clientY - startY) / totalH) * 100,
        ),
      );
      setRowSizes((prev) => {
        const n = [...prev];
        n[rowIdx] = na;
        n[rowIdx + 1] = a + b - na;
        return n;
      });
    }
    function onUp() {
      endDrag();
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    }
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
  }

  function onColDivider(e: React.MouseEvent, rowIdx: number, colIdx: number) {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    startDrag();
    const totalW = container.getBoundingClientRect().width;
    const startX = e.clientX;
    const cols = rowColSizes[rowIdx];
    const a = cols[colIdx],
      b = cols[colIdx + 1];
    function onMove(ev: MouseEvent) {
      const na = Math.max(
        10,
        Math.min(a + b - 10, a + ((ev.clientX - startX) / totalW) * 100),
      );
      setRowColSizes((prev) => {
        const next = prev.map((r) => [...r]);
        next[rowIdx][colIdx] = na;
        next[rowIdx][colIdx + 1] = a + b - na;
        return next;
      });
    }
    function onUp() {
      endDrag();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function onColDividerTouch(
    e: React.TouchEvent,
    rowIdx: number,
    colIdx: number,
  ) {
    const container = containerRef.current;
    if (!container) return;
    startDrag();
    const totalW = container.getBoundingClientRect().width;
    const startX = e.touches[0].clientX;
    const cols = rowColSizes[rowIdx];
    const a = cols[colIdx],
      b = cols[colIdx + 1];
    function onMove(ev: TouchEvent) {
      const na = Math.max(
        10,
        Math.min(
          a + b - 10,
          a + ((ev.touches[0].clientX - startX) / totalW) * 100,
        ),
      );
      setRowColSizes((prev) => {
        const next = prev.map((r) => [...r]);
        next[rowIdx][colIdx] = na;
        next[rowIdx][colIdx + 1] = a + b - na;
        return next;
      });
    }
    function onUp() {
      endDrag();
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    }
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
  }

  return {
    rowSizes,
    rowColSizes,
    isDragging,
    containerRef,
    reset,
    onRowDivider,
    onRowDividerTouch,
    onColDivider,
    onColDividerTouch,
  };
}

// ─── Dividers ─────────────────────────────────────────────────────────────────

function ColDivider({
  onMouseDown,
  onTouchStart,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
}) {
  return (
    <div className="relative w-0 shrink-0 z-10">
      <div
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        className="absolute inset-y-0 -left-2 -right-2 cursor-col-resize flex items-center justify-center group"
      >
        <div className="w-px h-full bg-border group-hover:bg-accent-brand/60 transition-colors pointer-events-none" />
      </div>
    </div>
  );
}

function RowDivider({
  onMouseDown,
  onTouchStart,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
}) {
  return (
    <div className="relative h-0 w-full shrink-0 z-10">
      <div
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        className="absolute inset-x-0 -top-2 -bottom-2 cursor-row-resize flex flex-col items-center justify-center group"
      >
        <div className="h-px w-full bg-border group-hover:bg-accent-brand/60 transition-colors pointer-events-none" />
      </div>
    </div>
  );
}

// ─── Pane ─────────────────────────────────────────────────────────────────────

function PaneHeader({
  tab,
  paneIndex,
  isFocused,
}: {
  tab: Tab | null;
  paneIndex: number;
  isFocused: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 h-7 shrink-0 border-b text-xs font-medium select-none transition-colors ${
        isFocused
          ? "bg-accent-brand/10 border-accent-brand/40 text-accent-brand"
          : "bg-sidebar border-border text-muted-foreground"
      }`}
    >
      {isFocused && (
        <span className="w-1 h-3.5 rounded-full bg-accent-brand shrink-0" />
      )}
      {tab ? (
        <>
          <span className={isFocused ? "text-accent-brand" : "opacity-60"}>
            {tabIcon(tab.type)}
          </span>
          <span
            className={`truncate ${isFocused ? "text-accent-brand font-semibold" : "text-foreground"}`}
          >
            {tab.type === "dashboard" ? "Dashboard" : tab.label}
          </span>
        </>
      ) : (
        <span className="opacity-40">
          {t("splitScreen.paneEmpty", { index: paneIndex + 1 })}
        </span>
      )}
    </div>
  );
}

function EmptyPane() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center w-full h-full gap-2 text-muted-foreground/30 bg-background">
      <div className="grid grid-cols-2 gap-1">
        <div className="size-5 border-2 border-current rounded-sm" />
        <div className="size-5 border-2 border-current rounded-sm" />
        <div className="size-5 border-2 border-current rounded-sm" />
        <div className="size-5 border-2 border-current rounded-sm" />
      </div>
      <span className="text-xs">{t("splitScreen.noTabAssigned")}</span>
    </div>
  );
}

const Pane = memo(function Pane({
  tab,
  paneIndex,
  isDragging,
  isFocused,
  onPaneContentRef,
  onPaneClick,
  onAssignPane,
}: {
  tab: Tab | null;
  paneIndex: number;
  isDragging: boolean;
  isFocused: boolean;
  onPaneContentRef?: (paneIndex: number, el: HTMLDivElement | null) => void;
  onPaneClick?: (paneIndex: number) => void;
  onAssignPane?: (paneIndex: number, tabId: string) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  const contentRef = useCallback(
    (el: HTMLDivElement | null) => {
      onPaneContentRef?.(paneIndex, el);
    },
    [paneIndex, onPaneContentRef],
  );

  return (
    <div
      className={`relative flex flex-col w-full h-full min-w-0 min-h-0 overflow-hidden transition-colors ${
        isFocused ? "ring-1 ring-inset ring-accent-brand/30" : ""
      } ${isDragOver ? "ring-2 ring-inset ring-accent-brand" : ""}`}
      onClick={() => onPaneClick?.(paneIndex)}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const tabId = e.dataTransfer.getData("text/plain");
        if (tabId) onAssignPane?.(paneIndex, tabId);
      }}
    >
      <PaneHeader tab={tab} paneIndex={paneIndex} isFocused={isFocused} />
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {tab ? (
          <div ref={contentRef} className="absolute inset-0" />
        ) : (
          <EmptyPane />
        )}
        {isDragOver && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-accent-brand/10 border-2 border-dashed border-accent-brand pointer-events-none">
            <span className="text-xs font-medium text-accent-brand">
              Drop to assign
            </span>
          </div>
        )}
      </div>
      {isDragging && (
        <div className="absolute inset-0 z-10" style={{ cursor: "inherit" }} />
      )}
    </div>
  );
});

// ─── Row (top-level so React never sees a new component type) ─────────────────

const Row = memo(function Row({
  rowIdx,
  paneIndices,
  rowHeight,
  colWidths,
  paneTabIds,
  tabs,
  isDragging,
  focusedPaneIndex,
  onColDivider,
  onColDividerTouch,
  onPaneContentRef,
  onPaneClick,
  onAssignPane,
}: {
  rowIdx: number;
  paneIndices: number[];
  rowHeight: number;
  colWidths: number[];
  paneTabIds: (string | null)[];
  tabs: Tab[];
  isDragging: boolean;
  focusedPaneIndex: number | null;
  onColDivider: (e: React.MouseEvent, rowIdx: number, colIdx: number) => void;
  onColDividerTouch: (
    e: React.TouchEvent,
    rowIdx: number,
    colIdx: number,
  ) => void;
  onPaneContentRef?: (paneIndex: number, el: HTMLDivElement | null) => void;
  onPaneClick?: (paneIndex: number) => void;
  onAssignPane?: (paneIndex: number, tabId: string) => void;
}) {
  const widths = colWidths ?? [];
  return (
    <div className="flex min-h-0 w-full" style={{ height: `${rowHeight}%` }}>
      {paneIndices.map((pIdx, ci) => {
        const tabId = paneTabIds[pIdx];
        const tab =
          tabId != null ? (tabs.find((t) => t.id === tabId) ?? null) : null;
        return (
          <React.Fragment key={pIdx}>
            <div
              className="min-w-0 min-h-0 overflow-hidden"
              style={{ width: `${widths[ci] ?? 100 / paneIndices.length}%` }}
            >
              <Pane
                tab={tab}
                paneIndex={pIdx}
                isDragging={isDragging}
                isFocused={focusedPaneIndex === pIdx}
                onPaneContentRef={onPaneContentRef}
                onPaneClick={onPaneClick}
                onAssignPane={onAssignPane}
              />
            </div>
            {ci < paneIndices.length - 1 && (
              <ColDivider
                onMouseDown={(e) => onColDivider(e, rowIdx, ci)}
                onTouchStart={(e) => onColDividerTouch(e, rowIdx, ci)}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
});

// ─── SplitView ────────────────────────────────────────────────────────────────

export const SplitView = memo(function SplitView({
  tabs,
  paneTabIds,
  splitMode,
  focusedPaneIndex,
  onTerminalResize,
  onPaneContentRef,
  onPaneClick,
  onAssignPane,
}: {
  tabs: Tab[];
  paneTabIds: (string | null)[];
  splitMode: SplitMode;
  focusedPaneIndex?: number | null;
  onTerminalResize?: () => void;
  onPaneContentRef?: (paneIndex: number, el: HTMLDivElement | null) => void;
  onPaneClick?: (paneIndex: number) => void;
  onAssignPane?: (paneIndex: number, tabId: string) => void;
}) {
  const {
    rowSizes,
    rowColSizes,
    isDragging,
    containerRef,
    reset,
    onRowDivider,
    onRowDividerTouch,
    onColDivider,
    onColDividerTouch,
  } = useSplitSizes(splitMode);

  useEffect(() => {
    if (!isDragging) {
      const id = requestAnimationFrame(() => onTerminalResize?.());
      return () => cancelAnimationFrame(id);
    }
  }, [isDragging, onTerminalResize]);

  // Inline pane lookup for the non-Row layouts (3-way, 3-way-horizontal)
  function tab(idx: number): Tab | null {
    const tabId = paneTabIds[idx];
    return tabId != null ? (tabs.find((t) => t.id === tabId) ?? null) : null;
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col w-full h-full min-h-0 overflow-hidden relative"
    >
      <button
        onClick={reset}
        className="absolute top-1 right-1 z-20 text-xs text-muted-foreground hover:text-foreground bg-background/80 border border-border px-1.5 py-0.5 leading-tight"
        title="Reset to equal split"
      >
        Reset
      </button>

      {splitMode === "2-way" && (
        <Row
          rowIdx={0}
          paneIndices={[0, 1]}
          rowHeight={rowSizes[0]}
          colWidths={rowColSizes[0] ?? []}
          paneTabIds={paneTabIds}
          tabs={tabs}
          isDragging={isDragging}
          focusedPaneIndex={focusedPaneIndex ?? null}
          onColDivider={onColDivider}
          onColDividerTouch={onColDividerTouch}
          onPaneContentRef={onPaneContentRef}
          onPaneClick={onPaneClick}
          onAssignPane={onAssignPane}
        />
      )}

      {splitMode === "3-way" && (
        <div className="flex w-full h-full min-h-0">
          <div
            className="min-w-0 min-h-0 overflow-hidden"
            style={{ width: `${rowColSizes[0][0]}%` }}
          >
            <Pane
              tab={tab(0)}
              paneIndex={0}
              isDragging={isDragging}
              isFocused={focusedPaneIndex === 0}
              onPaneContentRef={onPaneContentRef}
              onPaneClick={onPaneClick}
              onAssignPane={onAssignPane}
            />
          </div>
          <ColDivider
            onMouseDown={(e) => onColDivider(e, 0, 0)}
            onTouchStart={(e) => onColDividerTouch(e, 0, 0)}
          />
          <div className="flex flex-col flex-1 min-h-0">
            <div
              className="min-h-0 overflow-hidden"
              style={{ height: `${rowSizes[0]}%` }}
            >
              <Pane
                tab={tab(1)}
                paneIndex={1}
                isDragging={isDragging}
                isFocused={focusedPaneIndex === 1}
                onPaneContentRef={onPaneContentRef}
                onPaneClick={onPaneClick}
                onAssignPane={onAssignPane}
              />
            </div>
            <RowDivider
              onMouseDown={(e) => onRowDivider(e, 0)}
              onTouchStart={(e) => onRowDividerTouch(e, 0)}
            />
            <div
              className="min-h-0 overflow-hidden"
              style={{ height: `${rowSizes[1]}%` }}
            >
              <Pane
                tab={tab(2)}
                paneIndex={2}
                isDragging={isDragging}
                isFocused={focusedPaneIndex === 2}
                onPaneContentRef={onPaneContentRef}
                onPaneClick={onPaneClick}
                onAssignPane={onAssignPane}
              />
            </div>
          </div>
        </div>
      )}

      {splitMode === "3-way-horizontal" && (
        <div className="flex flex-col w-full h-full min-h-0">
          <div
            className="flex min-h-0 overflow-hidden"
            style={{ height: `${rowSizes[0]}%` }}
          >
            <div
              className="min-w-0 min-h-0 overflow-hidden"
              style={{ width: `${rowColSizes[0][0]}%` }}
            >
              <Pane
                tab={tab(0)}
                paneIndex={0}
                isDragging={isDragging}
                isFocused={focusedPaneIndex === 0}
                onPaneContentRef={onPaneContentRef}
                onPaneClick={onPaneClick}
                onAssignPane={onAssignPane}
              />
            </div>
            <ColDivider
              onMouseDown={(e) => onColDivider(e, 0, 0)}
              onTouchStart={(e) => onColDividerTouch(e, 0, 0)}
            />
            <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
              <Pane
                tab={tab(1)}
                paneIndex={1}
                isDragging={isDragging}
                isFocused={focusedPaneIndex === 1}
                onPaneContentRef={onPaneContentRef}
                onPaneClick={onPaneClick}
                onAssignPane={onAssignPane}
              />
            </div>
          </div>
          <RowDivider
            onMouseDown={(e) => onRowDivider(e, 0)}
            onTouchStart={(e) => onRowDividerTouch(e, 0)}
          />
          <div className="flex-1 min-h-0 overflow-hidden">
            <Pane
              tab={tab(2)}
              paneIndex={2}
              isDragging={isDragging}
              isFocused={focusedPaneIndex === 2}
              onPaneContentRef={onPaneContentRef}
              onPaneClick={onPaneClick}
              onAssignPane={onAssignPane}
            />
          </div>
        </div>
      )}

      {splitMode === "4-way" && (
        <div className="flex flex-col w-full h-full min-h-0">
          <Row
            rowIdx={0}
            paneIndices={[0, 1]}
            rowHeight={rowSizes[0]}
            colWidths={rowColSizes[0] ?? []}
            paneTabIds={paneTabIds}
            tabs={tabs}
            isDragging={isDragging}
            focusedPaneIndex={focusedPaneIndex ?? null}
            onColDivider={onColDivider}
            onColDividerTouch={onColDividerTouch}
            onPaneContentRef={onPaneContentRef}
            onPaneClick={onPaneClick}
            onAssignPane={onAssignPane}
          />
          <RowDivider
            onMouseDown={(e) => onRowDivider(e, 0)}
            onTouchStart={(e) => onRowDividerTouch(e, 0)}
          />
          <Row
            rowIdx={1}
            paneIndices={[2, 3]}
            rowHeight={rowSizes[1]}
            colWidths={rowColSizes[1] ?? []}
            paneTabIds={paneTabIds}
            tabs={tabs}
            isDragging={isDragging}
            focusedPaneIndex={focusedPaneIndex ?? null}
            onColDivider={onColDivider}
            onColDividerTouch={onColDividerTouch}
            onPaneContentRef={onPaneContentRef}
            onPaneClick={onPaneClick}
            onAssignPane={onAssignPane}
          />
        </div>
      )}

      {splitMode === "5-way" && (
        <div className="flex flex-col w-full h-full min-h-0">
          <Row
            rowIdx={0}
            paneIndices={[0, 1, 2]}
            rowHeight={rowSizes[0]}
            colWidths={rowColSizes[0] ?? []}
            paneTabIds={paneTabIds}
            tabs={tabs}
            isDragging={isDragging}
            focusedPaneIndex={focusedPaneIndex ?? null}
            onColDivider={onColDivider}
            onColDividerTouch={onColDividerTouch}
            onPaneContentRef={onPaneContentRef}
            onPaneClick={onPaneClick}
            onAssignPane={onAssignPane}
          />
          <RowDivider
            onMouseDown={(e) => onRowDivider(e, 0)}
            onTouchStart={(e) => onRowDividerTouch(e, 0)}
          />
          <Row
            rowIdx={1}
            paneIndices={[3, 4]}
            rowHeight={rowSizes[1]}
            colWidths={rowColSizes[1] ?? []}
            paneTabIds={paneTabIds}
            tabs={tabs}
            isDragging={isDragging}
            focusedPaneIndex={focusedPaneIndex ?? null}
            onColDivider={onColDivider}
            onColDividerTouch={onColDividerTouch}
            onPaneContentRef={onPaneContentRef}
            onPaneClick={onPaneClick}
            onAssignPane={onAssignPane}
          />
        </div>
      )}

      {splitMode === "6-way" && (
        <div className="flex flex-col w-full h-full min-h-0">
          <Row
            rowIdx={0}
            paneIndices={[0, 1, 2]}
            rowHeight={rowSizes[0]}
            colWidths={rowColSizes[0] ?? []}
            paneTabIds={paneTabIds}
            tabs={tabs}
            isDragging={isDragging}
            focusedPaneIndex={focusedPaneIndex ?? null}
            onColDivider={onColDivider}
            onColDividerTouch={onColDividerTouch}
            onPaneContentRef={onPaneContentRef}
            onPaneClick={onPaneClick}
            onAssignPane={onAssignPane}
          />
          <RowDivider
            onMouseDown={(e) => onRowDivider(e, 0)}
            onTouchStart={(e) => onRowDividerTouch(e, 0)}
          />
          <Row
            rowIdx={1}
            paneIndices={[3, 4, 5]}
            rowHeight={rowSizes[1]}
            colWidths={rowColSizes[1] ?? []}
            paneTabIds={paneTabIds}
            tabs={tabs}
            isDragging={isDragging}
            focusedPaneIndex={focusedPaneIndex ?? null}
            onColDivider={onColDivider}
            onColDividerTouch={onColDividerTouch}
            onPaneContentRef={onPaneContentRef}
            onPaneClick={onPaneClick}
            onAssignPane={onAssignPane}
          />
        </div>
      )}
    </div>
  );
});
