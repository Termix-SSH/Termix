/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Columns2, Maximize2, RotateCcw, Rows2, X } from "lucide-react";
import type { TabHandle } from "@termix-ssh/plugin-sdk/frontend";
import type { Host } from "@/types/ui-types";
import { createId } from "@/lib/create-id";
import { registerPaletteEntry } from "@/shell/palette-registry";
import type { TabShellCallbacks } from "@/shell/tab-registry";
import { runHostAction } from "@/sidebar/host-contributions";
import type { SplitViewActions } from "@/shell/split/SplitView";
import type { PickHostTarget } from "@/shell/split/EmptyPanePicker";
import {
  addSplitTab,
  canJoinSplit,
  closeSplitTab,
  isSplitTab,
  makeSplitTab,
  nextSplitNumber,
  placeTabInPane,
  splitTabOf,
  summarizeSplits,
  updateSplit,
  type SplitTab,
  type TabSplitAction,
} from "@/shell/split/split-tabs";
import {
  addPaneAtEdge,
  assignTab,
  canAddPane,
  createPane,
  createSplitNode,
  createSplitState,
  equalizeSplit,
  findPane,
  findPaneByTab,
  focusPane,
  listPanes,
  MAX_PANES,
  movePane,
  neighborPane,
  removePane,
  resizeSplit,
  shownPanes,
  splitPane,
  swapPanes,
  toggleZoom,
  type NavDirection,
  type PaneEdge,
  type PaneRect,
  type SplitState,
} from "@/shell/split/split-tree";
import {
  applyPreset,
  buildPreset,
  type SplitPresetId,
} from "@/shell/split/split-presets";
import {
  setSplitDropHandler,
  type SplitDragSource,
  type SplitDropHover,
} from "@/shell/split/split-drag";
import {
  publishSplitTargets,
  setSplitOpener,
  type SplitOpenTarget,
} from "@/shell/split/split-targets";
import { useTabTypes } from "@/shell/tab-registry";
import { useSplitLabel, type TabsState } from "./use-tabs";
import type { ShellSplit } from "./types";

export interface SplitActions {
  splitActive: (edge: "right" | "bottom") => void;
  navigate: (direction: NavDirection) => boolean;
  zoomFocused: () => boolean;
  closeFocusedPane: () => void;
}

export function useSplit({
  tabsState,
  isMobile,
  paneEls,
  callbacks,
  resizeAllTerminals,
}: {
  tabsState: TabsState;
  isMobile: boolean;
  paneEls: Map<string, HTMLDivElement>;
  callbacks: TabShellCallbacks;
  resizeAllTerminals: () => number;
}) {
  const { t } = useTranslation();
  const splitLabel = useSplitLabel();
  const tabTypes = useTabTypes();
  const {
    tabs,
    setTabs,
    tabsReady,
    activeTabId,
    setActiveTabId,
    tabsRef,
    activeTabIdRef,
    targetPane,
  } = tabsState;

  /**
   * Edits a split with a change computed from the last committed state, for
   * edits that create panes and so have to know the new pane's id.
   */
  function commitSplit(
    splitTabId: string,
    fn: (state: SplitState) => SplitState | null,
  ): SplitState | null {
    const current = tabsRef.current.find((tab) => tab.id === splitTabId);
    if (!isSplitTab(current)) return null;
    const next = fn(current.split);
    setTabs((prev) =>
      updateSplit(prev, splitTabId, (state) =>
        state === current.split ? next : fn(state),
      ),
    );
    return next;
  }

  function editSplit(
    splitTabId: string,
    fn: (state: SplitState) => SplitState | null,
  ) {
    setTabs((prev) => updateSplit(prev, splitTabId, fn));
  }

  function warnSplitFull() {
    toast.error(t("splitScreen.maxPanes", { count: MAX_PANES }));
  }

  function openSplitTab(state: SplitState): SplitTab {
    const number = nextSplitNumber(tabsRef.current, splitLabel);
    const splitTab = makeSplitTab(createId(), splitLabel(number), state);
    setTabs((prev) => addSplitTab(prev, splitTab));
    setActiveTabId(splitTab.id);
    return splitTab;
  }

  /** A new split of `tabId` (or of an empty pane) with a fresh pane at `edge`. */
  function startSplit(tabId: string | null, edge: PaneEdge): SplitTab {
    const own = createPane(tabId);
    const fresh = createPane();
    const leading = edge === "left" || edge === "top";
    const root = createSplitNode(
      edge === "left" || edge === "right" ? "row" : "column",
      leading ? [fresh, own] : [own, fresh],
    );
    return openSplitTab(createSplitState(root, fresh.id));
  }

  function splitPaneOf(splitTabId: string, paneId: string, edge: PaneEdge) {
    commitSplit(splitTabId, (state) => {
      const result = splitPane(state, paneId, edge);
      if (!result) warnSplitFull();
      return result ? result.state : state;
    });
    setActiveTabId(splitTabId);
  }

  /**
   * Splits a tab: a split grows at its focused pane, a tab inside a split
   * grows at its own pane, anything else becomes a new split.
   */
  function splitTabAt(tabId: string, edge: PaneEdge) {
    const current = tabsRef.current;
    const tab = current.find((t) => t.id === tabId);
    if (!tab) return;
    if (isSplitTab(tab)) {
      splitPaneOf(tab.id, tab.split.focusedPaneId, edge);
      return;
    }
    const parent = splitTabOf(current, tabId);
    const pane = parent ? findPaneByTab(parent.split, tabId) : undefined;
    if (parent && pane) {
      splitPaneOf(parent.id, pane.id, edge);
      return;
    }
    startSplit(canJoinSplit(tab) ? tab.id : null, edge);
  }

  function applyLayoutPreset(presetId: SplitPresetId) {
    const active = tabsRef.current.find(
      (tab) => tab.id === activeTabIdRef.current,
    );
    if (isSplitTab(active)) {
      commitSplit(active.id, (state) => applyPreset(state, presetId));
      return;
    }
    const root = buildPreset(
      presetId,
      active && canJoinSplit(active) ? [active.id] : [],
    );
    openSplitTab(createSplitState(root));
  }

  /** Closes a split tab, sending its tabs back to the tab bar. */
  function unsplit(splitTabId: string) {
    const split = tabsRef.current.find((tab) => tab.id === splitTabId);
    if (!isSplitTab(split)) return;
    const focusedTabId =
      findPane(split.split, split.split.focusedPaneId)?.tabId ??
      listPanes(split.split.root).find((pane) => pane.tabId)?.tabId ??
      null;
    setTabs((prev) => closeSplitTab(prev, splitTabId));
    if (activeTabIdRef.current === splitTabId) {
      const fallback = tabsRef.current.filter(
        (tab) => tab.id !== splitTabId && !tab.parentSplitTabId,
      );
      setActiveTabId(
        focusedTabId ?? fallback[fallback.length - 1]?.id ?? "dashboard",
      );
    }
  }

  /** Removes a pane; its tab, if any, goes back to the tab bar. */
  function closePaneOf(splitTabId: string, paneId: string) {
    const split = tabsRef.current.find((tab) => tab.id === splitTabId);
    if (!isSplitTab(split)) return;
    if (listPanes(split.split.root).length <= 1) {
      unsplit(splitTabId);
      return;
    }
    editSplit(splitTabId, (state) => removePane(state, paneId));
  }

  tabsState.splitOpsRef.current = { unsplit, closePaneOf };

  function handleTabSplitAction(action: TabSplitAction) {
    switch (action.kind) {
      case "split":
        splitTabAt(action.tabId, action.edge);
        break;
      case "splitActive":
        splitTabAt(activeTabIdRef.current, action.edge);
        break;
      case "preset":
        applyLayoutPreset(action.presetId);
        break;
      case "unsplit":
        unsplit(action.splitTabId);
        break;
      case "addToPane":
        setTabs((prev) =>
          placeTabInPane(prev, action.splitTabId, action.paneId, action.tabId),
        );
        setActiveTabId(action.splitTabId);
        break;
      case "addPane":
        commitSplit(action.splitTabId, (state) => {
          const result = addPaneAtEdge(state, action.edge, action.tabId);
          if (!result) warnSplitFull();
          return result ? result.state : state;
        });
        setActiveTabId(action.splitTabId);
        break;
    }
  }

  /** "Open in split" from the host list: aim the next tab, then open it. */
  const splitOpenerRef = useRef<
    (target: SplitOpenTarget, open: () => void) => void
  >(() => {});
  splitOpenerRef.current = (target, open) => {
    if (target.kind === "pane") {
      targetPane(target.splitTabId, target.paneId);
    } else if (target.kind === "newPane") {
      const split = tabsRef.current.find((tab) => tab.id === target.splitTabId);
      if (!isSplitTab(split)) return;
      const result = addPaneAtEdge(split.split, "right");
      if (!result) {
        warnSplitFull();
        return;
      }
      editSplit(split.id, (state) =>
        state === split.split ? result.state : state,
      );
      setActiveTabId(split.id);
      targetPane(split.id, result.paneId, true);
    } else {
      const active = tabsRef.current.find(
        (tab) => tab.id === activeTabIdRef.current,
      );
      if (!active || !canJoinSplit(active)) return;
      const splitTab = startSplit(active.id, "right");
      targetPane(splitTab.id, splitTab.split.focusedPaneId, true);
    }
    open();
  };

  /** A tab or pane dropped on the main area. */
  const splitDropRef = useRef<
    (source: SplitDragSource, hover: SplitDropHover) => void
  >(() => {});
  splitDropRef.current = (source, hover) => {
    if (source.kind === "pane") {
      const toPaneId = hover.paneId;
      if (!toPaneId) return;
      editSplit(source.splitTabId, (state) =>
        movePane(state, source.paneId, toPaneId, hover.target),
      );
      return;
    }
    const active = tabsRef.current.find(
      (tab) => tab.id === activeTabIdRef.current,
    );
    if (hover.paneId === null) {
      if (hover.target === "center") return;
      const other =
        active && canJoinSplit(active) && active.id !== source.tabId
          ? active.id
          : null;
      const dragged = createPane(source.tabId);
      const rest = createPane(other);
      const leading = hover.target === "left" || hover.target === "top";
      const root = createSplitNode(
        hover.target === "left" || hover.target === "right" ? "row" : "column",
        leading ? [dragged, rest] : [rest, dragged],
      );
      openSplitTab(createSplitState(root, dragged.id));
      return;
    }
    if (!isSplitTab(active)) return;
    const paneId = hover.paneId;
    if (hover.target === "center") {
      setTabs((prev) => placeTabInPane(prev, active.id, paneId, source.tabId));
      return;
    }
    const edge = hover.target;
    commitSplit(active.id, (state) => {
      const result = splitPane(state, paneId, edge, source.tabId);
      if (!result) warnSplitFull();
      return result ? result.state : state;
    });
  };

  // Split actions for handlers registered once, e.g. the global hotkeys.
  const splitActionsRef = useRef<SplitActions | null>(null);
  splitActionsRef.current = {
    splitActive: (edge) => splitTabAt(activeTabIdRef.current, edge),
    navigate: (direction) => {
      const active = tabsRef.current.find(
        (tab) => tab.id === activeTabIdRef.current,
      );
      if (!isSplitTab(active)) return false;
      const view = document.querySelector(`[data-split-view="${active.id}"]`);
      if (!view) return false;
      const rects: Record<string, PaneRect> = {};
      view
        .querySelectorAll<HTMLElement>("[data-split-pane-id]")
        .forEach((el) => {
          const id = el.dataset.splitPaneId;
          if (id) rects[id] = el.getBoundingClientRect();
        });
      const next = neighborPane(active.split.focusedPaneId, direction, rects);
      if (next) editSplit(active.id, (state) => focusPane(state, next));
      return true;
    },
    zoomFocused: () => {
      const active = tabsRef.current.find(
        (tab) => tab.id === activeTabIdRef.current,
      );
      if (!isSplitTab(active) || listPanes(active.split.root).length < 2) {
        return false;
      }
      editSplit(active.id, (state) => toggleZoom(state, state.focusedPaneId));
      return true;
    },
    closeFocusedPane: () => {
      const active = tabsRef.current.find(
        (tab) => tab.id === activeTabIdRef.current,
      );
      if (isSplitTab(active)) {
        closePaneOf(active.id, active.split.focusedPaneId);
      }
    },
  };

  useEffect(() => {
    const disposeOpener = setSplitOpener((target, open) =>
      splitOpenerRef.current(target, open),
    );
    const disposeDrop = setSplitDropHandler((source, hover) =>
      splitDropRef.current(source, hover),
    );
    const activeIsSplit = () =>
      isSplitTab(
        tabsRef.current.find((tab) => tab.id === activeTabIdRef.current),
      );
    const entries = [
      registerPaletteEntry({
        id: "core.reconnectDisconnected",
        titleKey: "nav.reconnectDisconnectedTerminals",
        icon: RotateCcw,
        keywords: ["reconnect", "disconnected", "ssh", "all", "network"],
        scope: "global",
        run: () => tabsState.reconnectAllRef.current(),
      }),
      registerPaletteEntry({
        id: "core.split.right",
        titleKey: "splitScreen.splitRight",
        icon: Columns2,
        keywords: ["split", "pane"],
        scope: "global",
        run: () => splitActionsRef.current?.splitActive("right"),
      }),
      registerPaletteEntry({
        id: "core.split.down",
        titleKey: "splitScreen.splitDown",
        icon: Rows2,
        keywords: ["split", "pane"],
        scope: "global",
        run: () => splitActionsRef.current?.splitActive("bottom"),
      }),
      registerPaletteEntry({
        id: "core.split.zoom",
        titleKey: "splitScreen.zoom",
        icon: Maximize2,
        keywords: ["split", "pane"],
        scope: "global",
        when: activeIsSplit,
        run: () => void splitActionsRef.current?.zoomFocused(),
      }),
      registerPaletteEntry({
        id: "core.split.closePane",
        titleKey: "splitScreen.closePane",
        icon: X,
        keywords: ["split", "pane"],
        scope: "global",
        when: activeIsSplit,
        run: () => splitActionsRef.current?.closeFocusedPane(),
      }),
    ];
    return () => {
      disposeOpener();
      disposeDrop();
      for (const dispose of entries) dispose();
    };
  }, []);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeSplit = isSplitTab(activeTab) ? activeTab : null;
  // The pane each on-screen tab sits in, for the active split only.
  const paneIdByTabId = new Map<string, string>();
  if (activeSplit) {
    for (const pane of shownPanes(activeSplit.split, isMobile)) {
      if (pane.tabId) paneIdByTabId.set(pane.tabId, pane.id);
    }
  }
  // Changes when panes appear, move or change tab, but not on a divider drag,
  // which fits the terminals itself once it ends.
  const splitShapeKey = activeSplit
    ? `${activeSplit.id}|${activeSplit.split.zoomedPaneId ?? ""}|${[
        ...paneIdByTabId.entries(),
      ].join(",")}|${listPanes(activeSplit.split.root).length}`
    : "";

  // A tab inside a split is never shown on its own: activating one (tab jump,
  // the connections panel, an existing session) shows its split instead,
  // focused on its pane. Also falls back when the active tab is gone.
  useLayoutEffect(() => {
    if (!activeTab) {
      if (!tabsReady) return;
      const topLevel = tabs.filter((tab) => !tab.parentSplitTabId);
      setActiveTabId(topLevel[topLevel.length - 1]?.id ?? "dashboard");
      return;
    }
    if (!activeTab.parentSplitTabId) return;
    const parent = splitTabOf(tabs, activeTab.id);
    if (!parent) return;
    const childId = activeTab.id;
    setTabs((prev) =>
      updateSplit(prev, parent.id, (state) => {
        const pane = findPaneByTab(state, childId);
        return pane ? focusPane(state, pane.id) : state;
      }),
    );
    setActiveTabId(parent.id);
  }, [activeTab, tabs, tabsReady]);

  // Moving focus to a pane moves keyboard focus into its session, unless the
  // user is in a menu or already typing in that pane.
  const focusedPaneId = activeSplit?.split.focusedPaneId ?? null;
  const focusedPaneTabId = focusedPaneId
    ? (findPane(activeSplit!.split, focusedPaneId)?.tabId ?? null)
    : null;
  useEffect(() => {
    if (!focusedPaneId || !focusedPaneTabId) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const focused = document.activeElement as HTMLElement | null;
      const paneEl = paneEls.get(focusedPaneId);
      if (focused && paneEl?.contains(focused)) return;
      if (
        focused?.closest?.(
          '[data-split-pane-header], [role="menu"], [role="dialog"]',
        )
      ) {
        return;
      }
      const tab = tabsRef.current.find((t) => t.id === focusedPaneTabId);
      const handle = tab?.terminalRef?.current as TabHandle | null | undefined;
      if (handle?.focus) {
        handle.focus();
        return;
      }
      // A session opened into the pane a moment ago may not have mounted yet.
      if (attempts++ < 10) timer = setTimeout(attempt, 100);
    };
    const frame = requestAnimationFrame(attempt);
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, [focusedPaneId, focusedPaneTabId]);

  useEffect(() => {
    publishSplitTargets({
      splits: summarizeSplits(tabs, MAX_PANES),
      canStartSplit: canJoinSplit(activeTab) && !activeTab?.parentSplitTabId,
    });
  }, [tabs, activeTab]);

  function splitViewActions(splitTabId: string): SplitViewActions {
    return {
      focusPane: (paneId) =>
        editSplit(splitTabId, (state) => focusPane(state, paneId)),
      resize: (nodeId, sizes) =>
        editSplit(splitTabId, (state) => resizeSplit(state, nodeId, sizes)),
      equalize: (nodeId) =>
        editSplit(splitTabId, (state) => equalizeSplit(state, nodeId)),
      splitPane: (paneId, edge) => splitPaneOf(splitTabId, paneId, edge),
      closePane: (paneId) => closePaneOf(splitTabId, paneId),
      closeSession: (tabId) => tabsState.closeTab(tabId),
      moveToTab: (paneId) => closePaneOf(splitTabId, paneId),
      showInPane: (paneId, tabId) => {
        if (tabId) {
          setTabs((prev) => placeTabInPane(prev, splitTabId, paneId, tabId));
        } else {
          editSplit(splitTabId, (state) => assignTab(state, paneId, null));
        }
      },
      swapPanes: (firstId, secondId) =>
        editSplit(splitTabId, (state) => swapPanes(state, firstId, secondId)),
      toggleZoom: (paneId) =>
        editSplit(splitTabId, (state) => toggleZoom(state, paneId)),
      resizeEnd: () => resizeAllTerminals(),
    };
  }

  // Picking a host for a pane always starts a new session, so it never pulls
  // a session out of the tab bar or another split.
  const pickerShell: TabShellCallbacks = {
    ...callbacks,
    openTab: (host, type, options) =>
      callbacks.openTab(host, type, { ...options, forceNewTab: true }),
  };

  const split: ShellSplit = {
    active: activeSplit,
    paneIdByTabId,
    focusedPaneId,
    summaries: summarizeSplits(tabs, MAX_PANES),
    activeFull: activeSplit ? !canAddPane(activeSplit.split) : false,
    handleAction: handleTabSplitAction,
    viewActions: splitViewActions,
    emptyPane: {
      freeTabs: tabs.filter(
        (tab) => !tab.parentSplitTabId && canJoinSplit(tab),
      ),
      newTabOptions: tabTypes
        .filter((def) => def.multiInstance)
        .map((def) => ({
          type: def.id,
          label: def.titleKey ? t(def.titleKey) : def.id,
          icon: def.icon,
        })),
      pickTab: (splitTabId, paneId, tabId) =>
        setTabs((prev) => placeTabInPane(prev, splitTabId, paneId, tabId)),
      pickHost: (splitTabId, paneId, host: Host, pick: PickHostTarget) => {
        targetPane(splitTabId, paneId);
        if ("item" in pick) {
          const item = pick.action
            .items?.(host)
            .find((candidate) => candidate.id === pick.item.id);
          item?.run(host, pickerShell);
        } else {
          runHostAction(pick.action, host, pickerShell);
        }
      },
      openType: (splitTabId, paneId, type) => {
        targetPane(splitTabId, paneId);
        tabsState.openMultiInstanceTab(type);
      },
      closePane: closePaneOf,
    },
  };

  return {
    split,
    splitShapeKey,
    splitActionsRef,
  };
}
