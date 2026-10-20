/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditingWidth } from "@/components/surface/surface-scope";
import { remScale } from "@/lib/rem";
import { rightDockableIds } from "@/sidebar/rail-items";
import type { ShellRegions } from "./types";

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;

function clampWidth(width: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
}

/** A drag on a dock edge, one width update per frame. `sign` is -1 for the right dock. */
function startDockDrag(
  e: React.MouseEvent,
  startW: number,
  sign: 1 | -1,
  setWidth: (width: number) => void,
  setDragging: (dragging: boolean) => void,
) {
  e.preventDefault();
  setDragging(true);
  const startX = e.clientX;
  // Widths are kept in Normal-size pixels, so a drag is scaled back.
  const scale = remScale();
  let frame = 0;
  let clientX = startX;
  function onMove(ev: MouseEvent) {
    clientX = ev.clientX;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      setWidth(clampWidth(startW + (sign * (clientX - startX)) / scale));
    });
  }
  function onUp() {
    cancelAnimationFrame(frame);
    setWidth(clampWidth(startW + (sign * (clientX - startX)) / scale));
    setDragging(false);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

/** The left sidebar and the right dock: what they show, open state and size. */
/** A dock's width after Reset width, in Normal-size pixels. */
export const DOCK_DEFAULT_WIDTH = 291;

export function useRegions(isMobile: boolean): ShellRegions {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [railView, setRailView] = useState<string>("hosts");
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("termix_sidebarWidth");
    return saved ? parseInt(saved, 10) : 291;
  });
  const [sidebarDragging, setSidebarDragging] = useState(false);
  // How far each panel wants the sidebar widened: what the panel says itself,
  // and what its open inline views say.
  const [panelEditing, setPanelEditing] = useState<
    Record<string, EditingWidth>
  >({});
  const [scopeEditing, setScopeEditing] = useState<
    Record<string, EditingWidth>
  >({});
  const editingSetters = useRef(
    new Map<string, (editing: EditingWidth) => void>(),
  );
  const panelEditingSetter = useCallback((view: string) => {
    const key = `panel:${view}`;
    if (!editingSetters.current.has(key))
      editingSetters.current.set(key, (editing) =>
        setPanelEditing((prev) =>
          prev[view] === editing ? prev : { ...prev, [view]: editing },
        ),
      );
    return editingSetters.current.get(key)!;
  }, []);
  const scopeEditingSetter = useCallback((view: string) => {
    const key = `scope:${view}`;
    if (!editingSetters.current.has(key))
      editingSetters.current.set(key, (editing) =>
        setScopeEditing((prev) =>
          prev[view] === editing ? prev : { ...prev, [view]: editing },
        ),
      );
    return editingSetters.current.get(key)!;
  }, []);

  // Right dock: a second panel column so reference panels like history can
  // stay visible while the left sidebar is used for something else.
  const [rightRailView, setRightRailView] = useState<string | null>(() => {
    const saved = localStorage.getItem("termix_rightRailView");
    return saved && rightDockableIds().includes(saved) ? saved : null;
  });
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("termix_rightSidebarWidth");
    return saved ? parseInt(saved, 10) : 291;
  });
  const [rightSidebarDragging, setRightSidebarDragging] = useState(false);
  // Remembers the last panel shown in the dock so the tab bar toggle can bring
  // it back instead of always falling back to the same default.
  const lastRightRailViewRef = useRef<string | null>(
    localStorage.getItem("termix_lastRightRailView"),
  );

  useEffect(() => {
    localStorage.setItem("termix_sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem("termix_rightSidebarWidth", String(rightSidebarWidth));
  }, [rightSidebarWidth]);

  useEffect(() => {
    if (rightRailView) {
      localStorage.setItem("termix_rightRailView", rightRailView);
      lastRightRailViewRef.current = rightRailView;
      localStorage.setItem("termix_lastRightRailView", rightRailView);
    } else {
      localStorage.removeItem("termix_rightRailView");
    }
  }, [rightRailView]);

  const sidebarOpenBeforeMobile = useRef(sidebarOpen);
  useEffect(() => {
    if (isMobile) {
      sidebarOpenBeforeMobile.current = sidebarOpen;
      setSidebarOpen(false);
    } else {
      setSidebarOpen(sidebarOpenBeforeMobile.current);
    }
  }, [isMobile]);

  // The panel shown before the current one, for Ctrl+Shift+E.
  const previousRailViewRef = useRef<string | null>(null);
  const currentRailViewRef = useRef(railView);
  useEffect(() => {
    if (currentRailViewRef.current !== railView) {
      previousRailViewRef.current = currentRailViewRef.current;
      currentRailViewRef.current = railView;
    }
  }, [railView]);

  // Moving a panel to the right dock rather than copying it: two live copies of
  // the same panel would fight over the shared editing state.
  function openInRightDock(view: string) {
    setRightRailView(view);
    if (railView === view) setSidebarOpen(false);
  }

  // Tab bar toggle: reopens whatever was last in the dock, so it behaves like a
  // show/hide rather than losing the user's choice each time.
  function toggleRightDock() {
    if (rightRailView) {
      lastRightRailViewRef.current = rightRailView;
      setRightRailView(null);
      return;
    }
    const fallback = lastRightRailViewRef.current ?? rightDockableIds()[0];
    if (fallback) setRightRailView(fallback);
  }

  function railClick(view: string) {
    if (railView === view && sidebarOpen) {
      setSidebarOpen(false);
    } else {
      // A panel lives in one dock at a time, so the left dock reclaims it.
      if (rightRailView === view) setRightRailView(null);
      setRailView(view);
      setSidebarOpen(true);
    }
  }

  const startLeftResize = useCallback(
    (e: React.MouseEvent) =>
      startDockDrag(e, sidebarWidth, 1, setSidebarWidth, setSidebarDragging),
    [sidebarWidth],
  );
  // Same drag, mirrored: the right dock grows as the pointer moves left.
  const startRightResize = useCallback(
    (e: React.MouseEvent) =>
      startDockDrag(
        e,
        rightSidebarWidth,
        -1,
        setRightSidebarWidth,
        setRightSidebarDragging,
      ),
    [rightSidebarWidth],
  );

  const leftEditing: EditingWidth = (() => {
    const values = [panelEditing[railView], scopeEditing[railView]];
    if (values.includes("wide")) return "wide";
    return values.some(Boolean);
  })();

  return {
    left: {
      view: railView,
      open: sidebarOpen,
      width: sidebarWidth,
      dragging: sidebarDragging,
      editing: leftEditing,
      setView: setRailView,
      setOpen: setSidebarOpen,
      setWidth: setSidebarWidth,
      startResize: startLeftResize,
      resetWidth: () => setSidebarWidth(DOCK_DEFAULT_WIDTH),
    },
    right: {
      view: rightRailView,
      open: rightRailView !== null,
      width: rightSidebarWidth,
      dragging: rightSidebarDragging,
      setView: setRightRailView,
      setWidth: setRightSidebarWidth,
      startResize: startRightResize,
      resetWidth: () => setRightSidebarWidth(DOCK_DEFAULT_WIDTH),
    },
    railClick,
    openInRightDock,
    toggleRightDock,
    previousView: () => previousRailViewRef.current,
    panelEditingSetter,
    scopeEditingSetter,
  };
}
