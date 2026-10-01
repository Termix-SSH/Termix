import {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
} from "react";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "motion/react";
import { Button } from "@/components/button";
import { Separator } from "@/components/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import {
  ChevronDown,
  ChevronUp,
  RefreshCw,
  X,
  Plus,
  Pencil,
  Columns2,
  Rows2,
  Ungroup,
  Maximize2,
  Minimize2,
  PanelRight,
} from "lucide-react";
import { tabIcon } from "@/shell/tabUtils";
import { isSessionTabType } from "@/shell/tab-registry";
import { isElectron } from "@/lib/electron";
import type { Tab, TabType } from "@/types/ui-types";
import { ActionSlot } from "@/shell/ActionSlot";
import {
  canJoinSplit,
  isSplitTab,
  type SplitSummary,
  type TabSplitAction,
} from "@/shell/split/split-tabs";
import { MAX_PANES } from "@/shell/split/split-tree";
import { SplitLayoutMenu } from "@/shell/split/SplitLayoutMenu";
import {
  beginSplitDrag,
  endSplitDrag,
  isSplitDragging,
  moveSplitDrag,
} from "@/shell/split/split-drag";

/** How far below the bar a dragged tab has to go before it drags into the view. */
const DRAG_OUT_DISTANCE = 16;

/**
 * Tabs holding a live connection that can be refreshed: the registered
 * session tabs.
 */
function isConnectionTab(type: TabType): boolean {
  return isSessionTabType(type);
}

export function TabBar({
  tabs,
  activeTabId,
  splits,
  activeSplitFull,
  onSetActiveTab,
  onCloseTab,
  onRefreshTab,
  onReconnectDisconnected,
  onReorderTabs,
  onSplitAction,
  onRenameTab,
  isAppFullscreen,
  onToggleAppFullscreen,
  rightDockOpen,
  onToggleRightDock,
  showTabNumbers,
}: {
  tabs: Tab[];
  activeTabId: string;
  /** Every split tab and its panes, for the "Add to split" entries. */
  splits: SplitSummary[];
  /** The active tab is a split with no room for another pane. */
  activeSplitFull: boolean;
  onSetActiveTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onRefreshTab: (id: string) => void;
  onReconnectDisconnected?: () => void;
  onReorderTabs: (tabs: Tab[]) => void;
  onSplitAction: (action: TabSplitAction) => void;
  onRenameTab?: (tabId: string, newLabel: string) => void;
  isAppFullscreen: boolean;
  onToggleAppFullscreen: () => void;
  rightDockOpen?: boolean;
  onToggleRightDock?: () => void;
  showTabNumbers?: boolean;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(true);
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [draggingOut, setDraggingOut] = useState(false);
  const [contextTabId, setContextTabId] = useState<string | null>(null);
  const [contextPos, setContextPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragData = useRef<{
    id: string;
    index: number;
    startX: number;
    startY: number;
    offsetX: number;
    width: number;
    barTop: number;
    barHeight: number;
    x: number;
    y: number;
  } | null>(null);
  const dragTargetRef = useRef<number | null>(null);
  const didDrag = useRef(false);
  // Hand-rolled instead of a Framer layoutId: a shared layoutId matched
  // multiple tabs sharing the same indicator element across re-renders, and
  // reordering tabs (which doesn't change which tab is active) could make it
  // measure the wrong tab's rect or animate a spurious slide. Measuring the
  // active tab's own DOM node directly is always correct.
  const [indicatorRect, setIndicatorRect] = useState<{
    left: number;
    width: number;
  } | null>(null);
  const skipIndicatorAnimRef = useRef(false);

  const activeIsSplit = isSplitTab(tabs.find((tab) => tab.id === activeTabId));

  const measureIndicator = useCallback(() => {
    const el = activeTabId ? tabEls.current.get(activeTabId) : null;
    if (!el) {
      setIndicatorRect(null);
      return;
    }
    setIndicatorRect({ left: el.offsetLeft, width: el.offsetWidth });
  }, [activeTabId]);

  // useLayoutEffect so the indicator is measured for the new tab order before
  // paint -- with useEffect there was a frame right after a drag-drop reorder
  // where the indicator (which stays hidden during the drag) reappeared at
  // its pre-reorder position before this caught up, flashing at the old spot.
  useLayoutEffect(() => {
    measureIndicator();
  }, [measureIndicator, tabs, dragTargetIndex]);

  useEffect(() => {
    const el = tabBarRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureIndicator);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureIndicator]);

  useEffect(() => {
    if (!skipIndicatorAnimRef.current) return;
    const id = requestAnimationFrame(() => {
      skipIndicatorAnimRef.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [indicatorRect]);

  useEffect(() => {
    const el = tabBarRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    if (!dragTabId) return;

    function onPointerMove(e: PointerEvent) {
      if (!dragData.current || !tabBarRef.current) return;
      const d = dragData.current;
      if (Math.abs(e.clientX - d.startX) > 5) didDrag.current = true;

      const barRect = tabBarRef.current.getBoundingClientRect();

      // Dragged down out of the bar: the tab heads for the view to be split.
      const dragged = tabs.find((t) => t.id === d.id);
      if (
        canJoinSplit(dragged) &&
        e.clientY > barRect.bottom + DRAG_OUT_DISTANCE
      ) {
        didDrag.current = true;
        if (isSplitDragging()) moveSplitDrag(e.clientX, e.clientY);
        else
          beginSplitDrag(
            {
              kind: "tab",
              tabId: d.id,
              label: dragged!.customLabel || dragged!.label,
            },
            e.clientX,
            e.clientY,
          );
        setDraggingOut(true);
        dragTargetRef.current = d.index;
        setDragTargetIndex(d.index);
        return;
      }
      if (isSplitDragging()) {
        endSplitDrag(false);
        setDraggingOut(false);
      }

      const x = Math.max(
        barRect.left + 2,
        Math.min(barRect.right - d.width - 6, e.clientX - d.offsetX),
      );
      const y = d.barTop;
      setDragPos({ x, y });

      const centerX = e.clientX - d.offsetX + d.width / 2;
      let newTarget = d.index;
      tabEls.current.forEach((el, id) => {
        if (id === d.id) return;
        const rect = el.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        const idx = tabs.findIndex((t) => t.id === id);
        if (idx < d.index && centerX < mid)
          newTarget = Math.min(newTarget, idx);
        if (idx > d.index && centerX > mid)
          newTarget = Math.max(newTarget, idx);
      });

      if (tabs[0].type === "dashboard") newTarget = Math.max(1, newTarget);
      dragTargetRef.current = newTarget;
      setDragTargetIndex(newTarget);
    }

    function endDrag(commit: boolean) {
      if (!dragData.current) return;
      const { id, index } = dragData.current;
      const to = dragTargetRef.current ?? index;
      const droppedOut = isSplitDragging();
      if (droppedOut) endSplitDrag(commit);
      setDraggingOut(false);
      if (commit && !droppedOut && to !== index) {
        const next = [...tabs];
        if (next[0].id !== id) next.splice(to, 0, next.splice(index, 1)[0]);
        skipIndicatorAnimRef.current = true;
        onReorderTabs(next);
      }
      dragData.current = null;
      dragTargetRef.current = null;
      setDragTabId(null);
      setDragTargetIndex(null);
      setDragPos(null);
      setTimeout(() => {
        didDrag.current = false;
      }, 0);
    }

    function onPointerUp() {
      endDrag(true);
    }

    // The browser can abort a pointer gesture without ever firing pointerup
    // (OS/browser cancels it, focus leaves the window, capture is lost some
    // other way). Without this, dragTabId stays stuck non-null forever and
    // every tab keeps rendering with a stale translateX from the aborted
    // drag, which can visually butt two tabs together with no seam between
    // them until something else forces a re-render.
    function onPointerCancel() {
      endDrag(false);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("lostpointercapture", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("lostpointercapture", onPointerCancel);
    };
  }, [dragTabId, tabs, onReorderTabs]);

  useEffect(() => {
    if (!contextTabId) return;
    function onDown(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest("[data-context-menu]")) {
        setContextTabId(null);
        setContextPos(null);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [contextTabId]);

  useEffect(() => {
    if (renamingTabId) {
      setTimeout(() => renameInputRef.current?.focus(), 0);
    }
  }, [renamingTabId]);

  function commitRename() {
    if (!renamingTabId) return;
    const trimmed = renameValue.trim();
    if (trimmed) onRenameTab?.(renamingTabId, trimmed);
    setRenamingTabId(null);
  }

  const dragIdx = tabs.findIndex((t) => t.id === dragTabId);
  const target = dragTargetIndex ?? dragIdx;

  return (
    <div className="flex flex-col shrink-0 min-w-0">
      <div
        className={`flex items-end bg-sidebar min-w-0 transition-[height,border-color] duration-200 ${open ? "h-12.5 border-b border-border" : "h-0 overflow-hidden"}`}
      >
        <div
          ref={tabBarRef}
          className="relative flex h-full flex-1 min-w-0 overflow-x-auto scrollbar-none pl-px"
        >
          {indicatorRect && !dragTabId && (
            <span
              data-tab-indicator={activeTabId}
              className="pointer-events-none absolute bottom-0 h-0.5 bg-accent-brand z-10"
              style={{
                left: indicatorRect.left,
                width: indicatorRect.width,
                transition:
                  reduceMotion || skipIndicatorAnimRef.current
                    ? "none"
                    : "left 200ms ease, width 200ms ease",
              }}
            />
          )}
          {tabs.map((tab, index) => {
            const active = tab.id === activeTabId;
            const isDragging = dragTabId === tab.id;
            let translateX = 0;
            if (
              dragTabId &&
              !isDragging &&
              dragIdx !== -1 &&
              target !== null &&
              target !== dragIdx
            ) {
              const draggedWidth =
                tabEls.current.get(dragTabId)?.offsetWidth ?? 0;
              if (dragIdx < target && index > dragIdx && index <= target)
                translateX = -draggedWidth;
              else if (dragIdx > target && index < dragIdx && index >= target)
                translateX = draggedWidth;
            }

            return (
              <div
                key={tab.id}
                ref={(el) => {
                  if (el) tabEls.current.set(tab.id, el);
                  else tabEls.current.delete(tab.id);
                }}
                onClick={() =>
                  !dragTabId && !didDrag.current && onSetActiveTab(tab.id)
                }
                onMouseDown={(e) => {
                  if (e.button === 1 && tab.type !== "dashboard") {
                    e.preventDefault();
                    onCloseTab(tab.id);
                  }
                }}
                onContextMenu={(e) => {
                  if (tab.type === "dashboard") return;
                  e.preventDefault();
                  setContextTabId(tab.id);
                  setContextPos({ x: e.clientX, y: e.clientY });
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0 || tab.type === "dashboard") return;
                  e.preventDefault();
                  const el = tabEls.current.get(tab.id);
                  if (!el || !tabBarRef.current) return;
                  const rect = el.getBoundingClientRect();
                  const barRect = tabBarRef.current.getBoundingClientRect();
                  dragData.current = {
                    id: tab.id,
                    index,
                    startX: e.clientX,
                    startY: e.clientY,
                    offsetX: e.clientX - rect.left,
                    width: rect.width,
                    barTop: barRect.top,
                    barHeight: barRect.height,
                    x: rect.left,
                    y: barRect.top,
                  };
                  setDragTabId(tab.id);
                  setDragTargetIndex(index);
                  setDragPos({ x: rect.left, y: barRect.top });
                  (e.currentTarget as HTMLElement).setPointerCapture(
                    e.pointerId,
                  );
                }}
                style={{
                  // Only set a transform while a drag is actually shifting
                  // tabs around. Leaving a permanent translateX(0) on every
                  // tab gives each one its own transform node, which opts it
                  // out of the pixel snapping a plain box gets when painted.
                  // The 1px seam then lands on a fractional device pixel at
                  // non-100% zoom and anti-aliases down to nothing, so two
                  // tabs look merged into one.
                  transform:
                    dragTabId && !isDragging
                      ? `translateX(${translateX}px)`
                      : undefined,
                  transition:
                    dragTabId && !isDragging ? "transform 200ms ease" : "none",
                  opacity: isDragging ? 0 : 1,
                  cursor:
                    tab.type === "dashboard"
                      ? "pointer"
                      : isDragging
                        ? "grabbing"
                        : "grab",
                  userSelect: "none",
                }}
                className={`group/tab relative flex items-center gap-2 shrink-0 transition-colors border-r border-border text-sm
                ${index === 0 && tab.type !== "dashboard" ? "border-l border-border" : ""}
                ${
                  tab.type === "dashboard"
                    ? `px-2.5 md:px-3.5 ${active ? "bg-surface text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-surface"}`
                    : `px-2.5 md:px-4 font-medium ${active ? "bg-surface text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-surface"}`
                }`}
              >
                {showTabNumbers && tab.type !== "dashboard" && (
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                    {tabs.slice(0, index).filter((t) => t.type !== "dashboard")
                      .length + 1}
                  </span>
                )}
                {tabIcon(tab.type)}
                {tab.type !== "dashboard" && renamingTabId === tab.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      else if (e.key === "Escape") setRenamingTabId(null);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-transparent border-b border-accent-brand outline-none text-sm w-28 min-w-0"
                    style={{ fontWeight: "inherit" }}
                  />
                ) : (
                  tab.type !== "dashboard" && tab.label
                )}
                {tab.type !== "dashboard" && renamingTabId !== tab.id && (
                  <div
                    className={`flex items-center gap-0.5 ml-1 ${active ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100"}`}
                  >
                    {isConnectionTab(tab.type) && (
                      <button
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRefreshTab(tab.id);
                        }}
                        title={t("nav.refreshTab")}
                        className="flex items-center justify-center size-5 md:size-4 rounded-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
                      >
                        <RefreshCw className="size-3" />
                      </button>
                    )}
                    {/* Plugins add small buttons here, invoked with the tab's surface handle. */}
                    <ActionSlot
                      slotId="tab.inline"
                      when={{ tab, handle: tab.terminalRef?.current }}
                      context={() => [tab.terminalRef?.current, tab]}
                      renderItem={(contribution, invoke) => (
                        <button
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            invoke();
                          }}
                          title={t(contribution.titleKey)}
                          className="flex items-center justify-center size-5 md:size-4 rounded-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
                        >
                          {contribution.icon && (
                            <contribution.icon className="size-3" />
                          )}
                        </button>
                      )}
                    />
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseTab(tab.id);
                      }}
                      className="flex items-center justify-center size-5 md:size-4 rounded-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {dragTabId &&
            dragPos &&
            !draggingOut &&
            (() => {
              const tab = tabs.find((t) => t.id === dragTabId)!;
              const active = tab.id === activeTabId;
              const dragTabWidth = tabEls.current.get(dragTabId)?.offsetWidth;
              const dragTabHeight = tabEls.current.get(dragTabId)?.offsetHeight;
              return (
                <div
                  style={{
                    position: "fixed",
                    left: dragPos.x,
                    top: dragPos.y,
                    width:
                      dragTabWidth !== undefined ? dragTabWidth + 2 : undefined,
                    height:
                      dragTabHeight !== undefined
                        ? dragTabHeight + 1
                        : undefined,
                    pointerEvents: "none",
                    zIndex: 9999,
                    opacity: 0.85,
                  }}
                  className={`flex items-center gap-2 shrink-0 border-x border-b border-border text-sm shadow-lg
                ${
                  tab.type === "dashboard"
                    ? `px-3.5 ${active ? "border-b-2 border-b-accent-brand bg-surface text-foreground" : "bg-sidebar text-muted-foreground"}`
                    : `px-4 font-medium ${active ? "border-b-2 border-b-accent-brand bg-surface text-foreground" : "bg-sidebar text-muted-foreground"}`
                }`}
                >
                  {tabIcon(tab.type)}
                  {tab.type !== "dashboard" && tab.label}
                </div>
              );
            })()}
        </div>

        <div
          className={`flex items-center h-full shrink-0 ${open ? "" : "invisible"}`}
        >
          <Separator orientation="vertical" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-full w-12.5 border-y-0 border-r-0 border-border rounded-none text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={1}
              className="w-56 border-t-0 [clip-path:inset(0px_-4px_-4px_-4px)] p-0"
            >
              {tabs.map((tab, index) => (
                <div
                  key={tab.id}
                  onClick={() => onSetActiveTab(tab.id)}
                  className={`flex items-center justify-between px-2 py-2 text-xs cursor-default hover:bg-accent hover:text-accent-foreground ${tab.id === activeTabId ? "text-foreground" : "text-muted-foreground"}`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {showTabNumbers && tab.type !== "dashboard" && (
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                        {tabs
                          .slice(0, index)
                          .filter((t) => t.type !== "dashboard").length + 1}
                      </span>
                    )}
                    {tabIcon(tab.type)}
                    <span className="truncate">
                      {tab.type === "dashboard"
                        ? t("nav.dashboard")
                        : tab.label}
                    </span>
                  </div>
                  {tab.type !== "dashboard" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseTab(tab.id);
                      }}
                      className="shrink-0 ml-2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Separator orientation="vertical" />
          <SplitLayoutMenu
            activeIsSplit={activeIsSplit}
            canAddPane={!activeSplitFull}
            onSplit={(edge) => onSplitAction({ kind: "splitActive", edge })}
            onPreset={(presetId) => onSplitAction({ kind: "preset", presetId })}
          />
          {onToggleRightDock && (
            <>
              <Separator orientation="vertical" />
              <Button
                variant="ghost"
                size="icon"
                className={`h-full w-12.5 rounded-none border-y-0 border-border ${rightDockOpen ? "text-accent-brand bg-accent-brand/10" : "text-muted-foreground hover:text-foreground"}`}
                title={t("nav.toggleRightDock")}
                aria-label={t("nav.toggleRightDock")}
                aria-pressed={!!rightDockOpen}
                onClick={onToggleRightDock}
              >
                <PanelRight className="size-4" />
              </Button>
            </>
          )}
          {!isElectron() && (
            <>
              <Separator orientation="vertical" />
              <Button
                variant="ghost"
                size="icon"
                className="h-full w-12.5 rounded-none border-y-0 border-border text-muted-foreground hover:text-foreground"
                title={
                  isAppFullscreen
                    ? t("nav.exitFullscreen")
                    : t("nav.enterFullscreen")
                }
                aria-label={
                  isAppFullscreen
                    ? t("nav.exitFullscreen")
                    : t("nav.enterFullscreen")
                }
                onClick={onToggleAppFullscreen}
              >
                {isAppFullscreen ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
              </Button>
            </>
          )}
          <Separator orientation="vertical" />
          <Button
            variant="ghost"
            size="icon"
            className="h-full w-12.5 rounded-none border-y-0 border-border text-muted-foreground hover:text-foreground"
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronUp
              className={`size-4 transition-transform ${open ? "" : "rotate-180"}`}
            />
          </Button>
        </div>
      </div>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="flex  items-center justify-center w-full h-6 bg-sidebar border-b border-border text-muted-foreground hover:text-accent-brand hover:bg-accent-brand/5 transition-colors shrink-0"
        >
          <ChevronDown className="size-3.5" />
        </button>
      )}

      {/* Right-click context menu */}
      {contextTabId &&
        contextPos &&
        (() => {
          const ctxTab = tabs.find((t) => t.id === contextTabId);
          if (!ctxTab) return null;
          const joinable = canJoinSplit(ctxTab);
          const itemClass =
            "flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none";
          const runSplit = (action: TabSplitAction) => {
            onSplitAction(action);
            setContextTabId(null);
          };
          const menuTop = Math.min(contextPos.y, window.innerHeight - 160);
          const menuLeft = Math.min(contextPos.x, window.innerWidth - 240);
          return (
            <div
              data-context-menu
              style={{
                position: "fixed",
                left: Math.max(4, menuLeft),
                top: Math.max(4, menuTop),
                maxHeight: window.innerHeight - Math.max(4, menuTop) - 8,
                zIndex: 10000,
              }}
              className="bg-popover border border-border shadow-lg py-1 min-w-[200px] max-w-[260px] overflow-y-auto"
            >
              <div className="px-2 py-1 text-xs font-semibold text-muted-foreground truncate max-w-[200px]">
                {ctxTab.label}
              </div>
              <div className="h-px bg-border my-1" />
              {isConnectionTab(ctxTab.type) && (
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    onRefreshTab(contextTabId);
                    setContextTabId(null);
                  }}
                >
                  <RefreshCw className="size-3" />
                  {t("nav.refreshTab")}
                </button>
              )}
              {onReconnectDisconnected && (
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    onReconnectDisconnected();
                    setContextTabId(null);
                  }}
                >
                  <RefreshCw className="size-3" />
                  {t("nav.reconnectDisconnectedTerminals")}
                </button>
              )}
              {/* Plugins add entries here, invoked with the tab's surface handle. */}
              <ActionSlot
                slotId="tab.menu"
                when={{ tab: ctxTab, handle: ctxTab.terminalRef?.current }}
                context={() => [ctxTab.terminalRef?.current, ctxTab]}
                renderItem={(contribution, invoke) => (
                  <button
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground"
                    onClick={() => {
                      invoke();
                      setContextTabId(null);
                    }}
                  >
                    {contribution.icon && (
                      <contribution.icon className="size-3" />
                    )}
                    {t(contribution.titleKey)}
                  </button>
                )}
              />
              <button
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  setRenameValue(ctxTab.label);
                  setRenamingTabId(contextTabId);
                  setContextTabId(null);
                  setContextPos(null);
                }}
              >
                <Pencil className="size-3" />
                {t("nav.renameTab")}
              </button>
              {isSplitTab(ctxTab) && (
                <>
                  <div className="h-px bg-border my-1" />
                  <button
                    className={itemClass}
                    onClick={() =>
                      runSplit({ kind: "unsplit", splitTabId: ctxTab.id })
                    }
                  >
                    <Ungroup className="size-3" />
                    {t("splitScreen.unsplit")}
                  </button>
                </>
              )}
              {joinable && (
                <>
                  <div className="h-px bg-border my-1" />
                  <button
                    className={itemClass}
                    onClick={() =>
                      runSplit({
                        kind: "split",
                        tabId: ctxTab.id,
                        edge: "right",
                      })
                    }
                  >
                    <Columns2 className="size-3" />
                    {t("splitScreen.splitRight")}
                  </button>
                  <button
                    className={itemClass}
                    onClick={() =>
                      runSplit({
                        kind: "split",
                        tabId: ctxTab.id,
                        edge: "bottom",
                      })
                    }
                  >
                    <Rows2 className="size-3" />
                    {t("splitScreen.splitDown")}
                  </button>
                  {splits.map((split) => (
                    <div key={split.id} className="flex flex-col">
                      <div className="h-px bg-border my-1" />
                      <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
                        {t("splitScreen.addToSplit", { split: split.label })}
                      </div>
                      {split.panes.map((pane) => (
                        <button
                          key={pane.id}
                          className={`${itemClass} pl-5`}
                          onClick={() =>
                            runSplit({
                              kind: "addToPane",
                              tabId: ctxTab.id,
                              splitTabId: split.id,
                              paneId: pane.id,
                            })
                          }
                        >
                          <span
                            className={`truncate ${pane.label ? "" : "text-muted-foreground"}`}
                          >
                            {pane.label
                              ? t("splitScreen.paneItem", {
                                  index: pane.index,
                                  label: pane.label,
                                })
                              : t("splitScreen.paneEmptyItem", {
                                  index: pane.index,
                                })}
                          </span>
                        </button>
                      ))}
                      {(["right", "bottom"] as const).map((edge) => (
                        <button
                          key={edge}
                          className={`${itemClass} pl-5`}
                          disabled={split.full}
                          title={
                            split.full
                              ? t("splitScreen.maxPanes", { count: MAX_PANES })
                              : undefined
                          }
                          onClick={() =>
                            runSplit({
                              kind: "addPane",
                              tabId: ctxTab.id,
                              splitTabId: split.id,
                              edge,
                            })
                          }
                        >
                          <Plus className="size-3" />
                          {edge === "right"
                            ? t("splitScreen.newPaneRight")
                            : t("splitScreen.newPaneBelow")}
                        </button>
                      ))}
                    </div>
                  ))}
                </>
              )}
              <div className="h-px bg-border my-1" />
              <button
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground text-destructive"
                onClick={() => {
                  onCloseTab(contextTabId);
                  setContextTabId(null);
                }}
              >
                <X className="size-3" />
                {t("nav.close")}
              </button>
            </div>
          );
        })()}
    </div>
  );
}
