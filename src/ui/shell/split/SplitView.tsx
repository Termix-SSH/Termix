import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  Columns2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Rows2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import { tabIcon } from "@/shell/tabUtils";
import type { LayoutNode, PaneNode, SplitNode, Tab } from "@/types/ui-types";
import type { SplitTab } from "./split-tabs";
import {
  listPanes,
  MAX_PANES,
  moveDivider,
  shownPanes,
  type PaneEdge,
} from "./split-tree";
import { beginSplitDrag, endSplitDrag, moveSplitDrag } from "./split-drag";

export interface SplitViewActions {
  focusPane: (paneId: string) => void;
  resize: (nodeId: string, sizes: number[]) => void;
  equalize: (nodeId: string) => void;
  splitPane: (
    paneId: string,
    edge: Extract<PaneEdge, "right" | "bottom">,
  ) => void;
  closePane: (paneId: string) => void;
  closeSession: (tabId: string) => void;
  moveToTab: (paneId: string) => void;
  showInPane: (paneId: string, tabId: string | null) => void;
  swapPanes: (firstId: string, secondId: string) => void;
  toggleZoom: (paneId: string) => void;
  /** A divider drag finished, so sessions can fit their new size. */
  resizeEnd: () => void;
}

interface PaneContext {
  splitTab: SplitTab;
  tabsById: Map<string, Tab>;
  /** Tabs outside any split, offered in each pane's switcher. */
  freeTabs: Tab[];
  paneIndexById: Map<string, number>;
  paneCount: number;
  isMobile: boolean;
  resizing: boolean;
  actions: SplitViewActions;
  onPaneContentRef: (paneId: string, el: HTMLDivElement | null) => void;
  renderEmptyPane: (paneId: string, paneIndex: number) => React.ReactNode;
  setResizing: (resizing: boolean) => void;
}

const DRAG_THRESHOLD = 5;

function tabLabel(tab: Tab): string {
  return tab.customLabel || tab.label;
}

function PaneHeader({
  pane,
  tab,
  focused,
  ctx,
}: {
  pane: PaneNode;
  tab: Tab | null;
  focused: boolean;
  ctx: PaneContext;
}) {
  const { t } = useTranslation();
  const { actions, splitTab, paneIndexById, tabsById } = ctx;
  const index = paneIndexById.get(pane.id) ?? 0;
  const panes = listPanes(splitTab.split.root);
  const otherPanes = panes.filter((other) => other.id !== pane.id);
  const full = panes.length >= MAX_PANES;
  const zoomed = splitTab.split.zoomedPaneId === pane.id;
  const fullTitle = full
    ? t("splitScreen.maxPanes", { count: MAX_PANES })
    : undefined;
  const drag = useRef<{ x: number; y: number; started: boolean } | null>(null);

  const label = tab ? tabLabel(tab) : t("splitScreen.emptyTitle");

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || ctx.isMobile || !tab) return;
    // The header's menus render in portals, and React still bubbles their
    // events up to here. Only presses on the header itself start a drag.
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target)) return;
    if (target.closest("button")) return;
    drag.current = { x: event.clientX, y: event.clientY, started: false };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || !tab) return;
    // Released outside the header before it became a drag.
    if (!state.started && event.buttons === 0) {
      drag.current = null;
      return;
    }
    if (!state.started) {
      const moved = Math.hypot(
        event.clientX - state.x,
        event.clientY - state.y,
      );
      if (moved < DRAG_THRESHOLD) return;
      state.started = true;
      // Captured only once it is really a drag, so a plain click stays a click.
      event.currentTarget.setPointerCapture(event.pointerId);
      beginSplitDrag(
        {
          kind: "pane",
          splitTabId: splitTab.id,
          paneId: pane.id,
          label: tabLabel(tab),
        },
        event.clientX,
        event.clientY,
      );
      return;
    }
    moveSplitDrag(event.clientX, event.clientY);
  }

  function finishDrag(commit: boolean) {
    const started = drag.current?.started;
    drag.current = null;
    if (started) endSplitDrag(commit);
  }

  const buttonClass =
    "flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

  return (
    <div
      data-split-pane-header
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => finishDrag(true)}
      onPointerCancel={() => finishDrag(false)}
      onLostPointerCapture={() => finishDrag(false)}
      className={`flex h-7 shrink-0 items-center gap-1 border-b pl-1 pr-0.5 text-xs select-none ${
        focused
          ? "border-accent-brand/40 bg-accent-brand/10"
          : "border-border bg-sidebar"
      } ${tab && !ctx.isMobile ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <span
        className={`flex h-4 min-w-4 shrink-0 items-center justify-center px-1 font-mono text-[10px] ${
          focused
            ? "bg-accent-brand text-background"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {index}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`flex min-w-0 items-center gap-1.5 px-1 py-0.5 hover:bg-muted ${
              focused ? "text-accent-brand" : "text-foreground"
            }`}
            title={t("splitScreen.showHere")}
          >
            {tab && (
              <span className={focused ? "" : "text-muted-foreground"}>
                {tabIcon(tab.type)}
              </span>
            )}
            <span
              className={`truncate ${tab ? "font-medium" : "text-muted-foreground"}`}
            >
              {label}
            </span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("splitScreen.showHere")}
          </DropdownMenuLabel>
          {ctx.freeTabs.length === 0 && (
            <DropdownMenuItem disabled>
              {t("splitScreen.noOpenTabs")}
            </DropdownMenuItem>
          )}
          {ctx.freeTabs.map((free) => (
            <DropdownMenuItem
              key={free.id}
              onSelect={() => actions.showInPane(pane.id, free.id)}
            >
              {tabIcon(free.type)}
              <span className="truncate">{tabLabel(free)}</span>
            </DropdownMenuItem>
          ))}
          {tab && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => actions.showInPane(pane.id, null)}
              >
                {t("splitScreen.clearPane")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex shrink-0 items-center">
        {!ctx.isMobile && (
          <>
            <button
              type="button"
              className={buttonClass}
              disabled={full}
              title={fullTitle ?? t("splitScreen.splitRight")}
              aria-label={t("splitScreen.splitRight")}
              onClick={() => actions.splitPane(pane.id, "right")}
            >
              <Columns2 className="size-3.5" />
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={full}
              title={fullTitle ?? t("splitScreen.splitDown")}
              aria-label={t("splitScreen.splitDown")}
              onClick={() => actions.splitPane(pane.id, "bottom")}
            >
              <Rows2 className="size-3.5" />
            </button>
            {panes.length > 1 && (
              <button
                type="button"
                className={`${buttonClass} ${zoomed ? "text-accent-brand" : ""}`}
                title={zoomed ? t("splitScreen.unzoom") : t("splitScreen.zoom")}
                aria-label={
                  zoomed ? t("splitScreen.unzoom") : t("splitScreen.zoom")
                }
                aria-pressed={zoomed}
                onClick={() => actions.toggleZoom(pane.id)}
              >
                {zoomed ? (
                  <Minimize2 className="size-3.5" />
                ) : (
                  <Maximize2 className="size-3.5" />
                )}
              </button>
            )}
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={buttonClass}
              title={t("splitScreen.paneActions")}
              aria-label={t("splitScreen.paneActions")}
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {tab && (
              <>
                <DropdownMenuItem onSelect={() => actions.moveToTab(pane.id)}>
                  {t("splitScreen.moveToTab")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.closeSession(tab.id)}>
                  {t("splitScreen.closeSession")}
                </DropdownMenuItem>
              </>
            )}
            {otherPanes.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  {t("splitScreen.swapWith")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  {otherPanes.map((other) => {
                    const otherTab = other.tabId
                      ? tabsById.get(other.tabId)
                      : undefined;
                    const otherIndex = paneIndexById.get(other.id) ?? 0;
                    return (
                      <DropdownMenuItem
                        key={other.id}
                        onSelect={() => actions.swapPanes(pane.id, other.id)}
                      >
                        <span className="truncate">
                          {otherTab
                            ? t("splitScreen.paneItem", {
                                index: otherIndex,
                                label: tabLabel(otherTab),
                              })
                            : t("splitScreen.paneEmptyItem", {
                                index: otherIndex,
                              })}
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {(tab || otherPanes.length > 0) && <DropdownMenuSeparator />}
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => actions.closePane(pane.id)}
            >
              {t("splitScreen.closePane")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

const PaneView = memo(function PaneView({
  pane,
  ctx,
}: {
  pane: PaneNode;
  ctx: PaneContext;
}) {
  const tab = pane.tabId ? (ctx.tabsById.get(pane.tabId) ?? null) : null;
  const focused = ctx.splitTab.split.focusedPaneId === pane.id;
  const { onPaneContentRef, actions } = ctx;
  const paneId = pane.id;
  const contentRef = useCallback(
    (el: HTMLDivElement | null) => onPaneContentRef(paneId, el),
    [paneId, onPaneContentRef],
  );
  const paneRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef(actions.focusPane);
  focusRef.current = actions.focusPane;

  // Native listeners, not React props: a tab's content is a portal that the
  // shell moves in here by hand, so React sends its events elsewhere.
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const focus = () => focusRef.current(paneId);
    el.addEventListener("pointerdown", focus, true);
    el.addEventListener("focusin", focus);
    return () => {
      el.removeEventListener("pointerdown", focus, true);
      el.removeEventListener("focusin", focus);
    };
  }, [paneId]);

  return (
    <div
      ref={paneRef}
      data-split-pane-id={pane.id}
      className="relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
    >
      <PaneHeader pane={pane} tab={tab} focused={focused} ctx={ctx} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {tab ? (
          <div ref={contentRef} className="absolute inset-0" />
        ) : (
          ctx.renderEmptyPane(pane.id, ctx.paneIndexById.get(pane.id) ?? 0)
        )}
        {ctx.resizing && <div className="absolute inset-0 z-10" />}
      </div>
      {/* Drawn over the content, which would otherwise cover an inset ring. */}
      {focused && ctx.paneCount > 1 && (
        <div className="pointer-events-none absolute inset-0 z-30 border border-accent-brand/70" />
      )}
    </div>
  );
});

function Divider({
  node,
  index,
  ctx,
}: {
  node: SplitNode;
  index: number;
  ctx: PaneContext;
}) {
  const { t } = useTranslation();
  const row = node.direction === "row";
  const drag = useRef<{
    start: number;
    total: number;
    sizes: number[];
  } | null>(null);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const parent = event.currentTarget.parentElement?.parentElement;
    if (!parent) return;
    event.preventDefault();
    const rect = parent.getBoundingClientRect();
    drag.current = {
      start: row ? event.clientX : event.clientY,
      total: row ? rect.width : rect.height,
      sizes: node.sizes,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    ctx.setResizing(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.total <= 0) return;
    const position = row ? event.clientX : event.clientY;
    const delta = ((position - state.start) / state.total) * 100;
    ctx.actions.resize(node.id, moveDivider(state.sizes, index, delta));
  }

  function finish() {
    if (!drag.current) return;
    drag.current = null;
    ctx.setResizing(false);
    ctx.actions.resizeEnd();
  }

  return (
    <div
      className={`relative z-20 shrink-0 bg-border ${row ? "w-px" : "h-px"}`}
    >
      <div
        role="separator"
        aria-orientation={row ? "vertical" : "horizontal"}
        title={t("splitScreen.dividerHint")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onDoubleClick={() => {
          ctx.actions.equalize(node.id);
          ctx.actions.resizeEnd();
        }}
        className={`group absolute flex touch-none items-center justify-center ${
          row
            ? "inset-y-0 -left-1.5 -right-1.5 cursor-col-resize"
            : "inset-x-0 -top-1.5 -bottom-1.5 cursor-row-resize"
        }`}
      >
        <div
          className={`pointer-events-none bg-transparent transition-colors group-hover:bg-accent-brand/60 ${
            row ? "h-full w-0.5" : "h-0.5 w-full"
          }`}
        />
      </div>
    </div>
  );
}

function NodeView({ node, ctx }: { node: LayoutNode; ctx: PaneContext }) {
  if (node.kind === "pane") return <PaneView pane={node} ctx={ctx} />;
  const row = node.direction === "row";
  return (
    <div
      className={`flex size-full min-h-0 min-w-0 ${row ? "flex-row" : "flex-col"}`}
    >
      {node.children.map((child, index) => (
        <React.Fragment key={child.id}>
          <div
            className="relative min-h-0 min-w-0 overflow-hidden"
            style={{ flex: `${node.sizes[index]} 1 0px` }}
          >
            <NodeView node={child} ctx={ctx} />
          </div>
          {index < node.children.length - 1 && (
            <Divider node={node} index={index} ctx={ctx} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function MobilePaneStrip({ ctx }: { ctx: PaneContext }) {
  const { t } = useTranslation();
  const panes = listPanes(ctx.splitTab.split.root);
  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-sidebar">
      {panes.map((pane) => {
        const tab = pane.tabId ? ctx.tabsById.get(pane.tabId) : undefined;
        const active = ctx.splitTab.split.focusedPaneId === pane.id;
        const index = ctx.paneIndexById.get(pane.id) ?? 0;
        return (
          <button
            key={pane.id}
            type="button"
            onClick={() => ctx.actions.focusPane(pane.id)}
            className={`flex min-w-0 max-w-40 shrink-0 items-center gap-1.5 border-r border-border px-3 text-xs ${
              active
                ? "bg-accent-brand/10 text-accent-brand"
                : "text-muted-foreground"
            }`}
          >
            <span className="font-mono text-[10px]">{index}</span>
            <span className="truncate">
              {tab ? tabLabel(tab) : t("splitScreen.emptyTitle")}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A split tab's panes. Each pane with a tab renders an empty host element;
 * the shell moves the tab's own DOM node into it, so switching panes never
 * remounts a session.
 */
export function SplitView({
  splitTab,
  tabs,
  isMobile,
  actions,
  onPaneContentRef,
  renderEmptyPane,
}: {
  splitTab: SplitTab;
  tabs: Tab[];
  isMobile: boolean;
  actions: SplitViewActions;
  onPaneContentRef: (paneId: string, el: HTMLDivElement | null) => void;
  renderEmptyPane: (paneId: string, paneIndex: number) => React.ReactNode;
}) {
  const [resizing, setResizing] = useState(false);
  const focusRef = useRef(actions.focusPane);
  focusRef.current = actions.focusPane;

  // A click into an iframe (a web page tab) sends no pointer event to this
  // document, only a blur on the window. The focused iframe says which pane.
  useEffect(() => {
    const onBlur = () =>
      setTimeout(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLIFrameElement)) return;
        const pane = active.closest<HTMLElement>("[data-split-pane-id]");
        const paneId = pane?.dataset.splitPaneId;
        if (paneId) focusRef.current(paneId);
      }, 0);
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);
  const panes = listPanes(splitTab.split.root);
  const paneIndexById = new Map(panes.map((pane, i) => [pane.id, i + 1]));
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  const freeTabs = tabs.filter(
    (tab) =>
      !tab.parentSplitTabId &&
      tab.type !== "dashboard" &&
      tab.type !== splitTab.type,
  );
  const ctx: PaneContext = {
    splitTab,
    tabsById,
    freeTabs,
    paneIndexById,
    paneCount: panes.length,
    isMobile,
    resizing,
    actions,
    onPaneContentRef,
    renderEmptyPane,
    setResizing,
  };

  const shown = shownPanes(splitTab.split, isMobile);
  const single = shown.length === 1 && panes.length > 1 ? shown[0] : null;

  return (
    <div
      className={`flex size-full min-h-0 flex-col overflow-hidden ${resizing ? "select-none" : ""}`}
      data-split-view={splitTab.id}
    >
      {isMobile && panes.length > 1 && <MobilePaneStrip ctx={ctx} />}
      <div className="relative min-h-0 flex-1">
        {single ? (
          <PaneView key={single.id} pane={single} ctx={ctx} />
        ) : (
          <NodeView node={splitTab.split.root} ctx={ctx} />
        )}
      </div>
    </div>
  );
}
