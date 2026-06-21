import { useRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  LayoutPanelLeft,
  Plus,
  Minus,
  Pencil,
} from "lucide-react";
import { tabIcon } from "@/shell/tabUtils";
import type { Tab, TabType, SplitMode } from "@/types/ui-types";
import { SPLIT_MODES, PANE_COUNTS } from "@/lib/theme";

const CONNECTION_TAB_TYPES: TabType[] = ["terminal", "rdp", "vnc", "telnet"];

export function TabBar({
  tabs,
  activeTabId,
  splitMode,
  paneTabIds,
  focusedPaneIndex,
  onSetActiveTab,
  onCloseTab,
  onRefreshTab,
  onReorderTabs,
  onSplitTab,
  onAddToSplit,
  onRemoveFromSplit,
  onRenameTab,
}: {
  tabs: Tab[];
  activeTabId: string;
  splitMode: SplitMode;
  paneTabIds: (string | null)[];
  focusedPaneIndex: number | null;
  onSetActiveTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onRefreshTab: (id: string) => void;
  onReorderTabs: (tabs: Tab[]) => void;
  onSplitTab: (tabId: string, mode: SplitMode) => void;
  onAddToSplit: (tabId: string) => void;
  onRemoveFromSplit: (tabId: string) => void;
  onRenameTab?: (tabId: string, newLabel: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
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

  const isSplit = splitMode !== "none";
  const paneCount = PANE_COUNTS[splitMode];

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

    function onPointerUp() {
      if (!dragData.current) return;
      const { id, index } = dragData.current;
      const to = dragTargetRef.current ?? index;
      if (to !== index) {
        const next = [...tabs];
        if (next[0].id !== id) next.splice(to, 0, next.splice(index, 1)[0]);
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

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
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
        className={`flex items-end bg-sidebar min-w-0 transition-all duration-200 ${open ? "h-12.5 border-b border-border" : "h-0 overflow-hidden"}`}
      >
        <div
          ref={tabBarRef}
          className="flex h-full flex-1 min-w-0 overflow-x-auto scrollbar-none pl-px"
        >
          {tabs.map((tab, index) => {
            const active = tab.id === activeTabId;
            const isDragging = dragTabId === tab.id;
            const paneIdx = paneTabIds.indexOf(tab.id);
            const isInPane = paneIdx !== -1;
            const isFocusedPane = isInPane && paneIdx === focusedPaneIndex;
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

            const showFocusIndicator = isFocusedPane && isSplit;
            const showInPaneIndicator = isInPane && isSplit && !isFocusedPane;

            return (
              <div
                key={tab.id}
                ref={(el) => {
                  if (el) tabEls.current.set(tab.id, el);
                  else tabEls.current.delete(tab.id);
                }}
                draggable={isSplit && tab.type !== "dashboard"}
                onDragStart={(e) => {
                  if (!isSplit || tab.type === "dashboard") return;
                  e.dataTransfer.setData("text/plain", tab.id);
                  e.dataTransfer.effectAllowed = "move";
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
                  transform: isDragging
                    ? "none"
                    : `translateX(${translateX}px)`,
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
                    ? `px-2.5 md:px-3.5 ${active ? "border-b-2 border-b-accent-brand bg-surface text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-surface"}`
                    : `px-2.5 md:px-4 font-medium ${active ? "border-b-2 border-b-accent-brand bg-surface text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-surface"}`
                }`}
              >
                {/* Focused-pane indicator: brand accent bottom border overlay */}
                {showFocusIndicator && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-brand/70 z-10" />
                )}
                {/* In-pane (not focused) indicator: subtle dot */}
                {showInPaneIndicator && (
                  <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 size-1 rounded-full bg-muted-foreground/40 z-10" />
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
                    {CONNECTION_TAB_TYPES.includes(tab.type) && (
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
            (() => {
              const tab = tabs.find((t) => t.id === dragTabId)!;
              const active = tab.id === activeTabId;
              return (
                <div
                  style={{
                    position: "fixed",
                    left: dragPos.x,
                    top: dragPos.y,
                    width: tabEls.current.get(dragTabId)?.offsetWidth,
                    height: tabEls.current.get(dragTabId)?.offsetHeight,
                    pointerEvents: "none",
                    zIndex: 9999,
                    opacity: 0.85,
                  }}
                  className={`flex items-center gap-2 shrink-0 border border-border text-sm shadow-lg
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
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  onClick={() => onSetActiveTab(tab.id)}
                  className={`flex items-center justify-between px-2 py-2 text-xs cursor-default hover:bg-accent hover:text-accent-foreground ${tab.id === activeTabId ? "text-foreground" : "text-muted-foreground"}`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
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
          const isInPane = paneTabIds.indexOf(contextTabId) !== -1;
          const hasEmptySlot =
            isSplit && paneTabIds.slice(0, paneCount).some((p) => p === null);
          return (
            <div
              data-context-menu
              style={{
                position: "fixed",
                left: contextPos.x,
                top: contextPos.y,
                zIndex: 10000,
              }}
              className="bg-popover border border-border shadow-lg py-1 min-w-[180px]"
            >
              <div className="px-2 py-1 text-xs font-semibold text-muted-foreground truncate max-w-[200px]">
                {ctxTab.label}
              </div>
              <div className="h-px bg-border my-1" />
              {CONNECTION_TAB_TYPES.includes(ctxTab.type) && (
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
              <div className="h-px bg-border my-1" />
              {/* Split submenu */}
              <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("terminal.split.splitTab")}
              </div>
              {SPLIT_MODES.filter((m) => m.id !== "none").map((mode) => (
                <button
                  key={mode.id}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    onSplitTab(contextTabId, mode.id);
                    setContextTabId(null);
                  }}
                >
                  <LayoutPanelLeft className="size-3 text-muted-foreground" />
                  {mode.label}
                </button>
              ))}
              {isSplit && (
                <>
                  <div className="h-px bg-border my-1" />
                  {isInPane ? (
                    <button
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground text-muted-foreground"
                      onClick={() => {
                        onRemoveFromSplit(contextTabId);
                        setContextTabId(null);
                      }}
                    >
                      <Minus className="size-3" />
                      {t("terminal.split.removeFromSplit")}
                    </button>
                  ) : hasEmptySlot ? (
                    <button
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-accent hover:text-accent-foreground"
                      onClick={() => {
                        onAddToSplit(contextTabId);
                        setContextTabId(null);
                      }}
                    >
                      <Plus className="size-3" />
                      {t("terminal.split.addToSplit")}
                    </button>
                  ) : null}
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
                {t("nav.closeTab")}
              </button>
            </div>
          );
        })()}
    </div>
  );
}
