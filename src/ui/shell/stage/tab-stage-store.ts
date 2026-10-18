import type { Tab } from "@/types/ui-types";

/**
 * Where tab content lives in the DOM.
 *
 * Every tab gets one stable node, created once and kept while the tab lives.
 * React portals the tab into that node and never changes the portal target,
 * since changing it remounts the tab (and drops a live terminal). The node is
 * moved with plain DOM between the stage's normal view and pane elements, or
 * left detached while no stage is mounted, e.g. while a layout is swapped.
 */
export interface TabStageStore {
  getNode: (tabId: string, ownBackground: boolean) => HTMLDivElement;
  /** Tab ids in the order their portals render: append only, never reordered. */
  portalOrder: (tabs: Tab[]) => Tab[];
  paneEls: Map<string, HTMLDivElement>;
  setPaneEl: (paneId: string, el: HTMLDivElement | null) => void;
  normalView: () => HTMLDivElement | null;
  setNormalView: (el: HTMLDivElement | null) => void;
  /** Moves every node where it belongs and sets its visibility. */
  place: (
    tabs: Tab[],
    activeTabId: string,
    paneIdByTabId: Map<string, string>,
    ownBackground: (tab: Tab) => boolean,
  ) => void;
  subscribe: (listener: () => void) => () => void;
  version: () => number;
}

export function createTabStageStore(): TabStageStore {
  const nodes = new Map<string, HTMLDivElement>();
  const paneEls = new Map<string, HTMLDivElement>();
  const listeners = new Set<() => void>();
  let normalView: HTMLDivElement | null = null;
  let version = 0;
  let order: string[] = [];
  // Tab id the enter animation has already played for, so a re-render while
  // the tab stays active (there can be several right after a switch) doesn't
  // replay it, only a genuine switch to a different tab should.
  let lastAnimatedTabId: string | null = null;

  const bump = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  function getNode(tabId: string, ownBackground: boolean) {
    let el = nodes.get(tabId);
    if (!el) {
      el = document.createElement("div");
      el.style.position = "absolute";
      el.style.inset = "0";
      el.style.overflow = "hidden";
      if (!ownBackground) el.classList.add("bg-background");
      nodes.set(tabId, el);
    }
    return el;
  }

  // Portal render order for tab content, kept independent of the tab bar's
  // visual order. Reordering tabs in the bar reorders `tabs`, and mapping
  // that array directly to portals reshuffles the Suspense-wrapped portal
  // children's sibling order in the fiber tree, React then runs its
  // Offscreen disconnect/reconnect pass on the ones that moved, which tears
  // down and rebuilds every passive effect underneath (including
  // react-xtermjs's terminal-creation effect), dropping the live terminal
  // and its WebSocket. Portal position doesn't need to track tab order at
  // all, so we only ever append new ids and drop closed ones here.
  function portalOrder(tabs: Tab[]) {
    const liveIds = new Set(tabs.map((t) => t.id));
    order = order.filter((id) => liveIds.has(id));
    const known = new Set(order);
    for (const tab of tabs) {
      if (!known.has(tab.id)) order.push(tab.id);
    }
    return order
      .map((id) => tabs.find((t) => t.id === id))
      .filter((t): t is Tab => t !== undefined);
  }

  function setPaneEl(paneId: string, el: HTMLDivElement | null) {
    if (el) {
      if (paneEls.get(paneId) === el) return;
      paneEls.set(paneId, el);
    } else {
      if (!paneEls.has(paneId)) return;
      paneEls.delete(paneId);
    }
    bump();
  }

  function setNormalView(el: HTMLDivElement | null) {
    if (normalView === el) return;
    normalView = el;
    bump();
  }

  function place(
    tabs: Tab[],
    activeTabId: string,
    paneIdByTabId: Map<string, string>,
    ownBackground: (tab: Tab) => boolean,
  ) {
    const tabIds = new Set(tabs.map((t) => t.id));

    // Remove nodes for closed tabs
    for (const [id, node] of nodes) {
      if (!tabIds.has(id)) {
        node.remove();
        nodes.delete(id);
      }
    }

    for (const tab of tabs) {
      const isTerminal = ownBackground(tab);
      const node = getNode(tab.id, isTerminal);
      const paneId = paneIdByTabId.get(tab.id);
      const paneEl = paneId ? paneEls.get(paneId) : undefined;
      const inPane = !!paneId;
      const activeInline = !inPane && tab.id === activeTabId;

      if (inPane && paneEl) {
        if (node.parentElement !== paneEl) paneEl.appendChild(node);
        node.style.visibility = "visible";
        node.style.pointerEvents = "auto";
        node.style.display = "";
        node.style.zIndex = "";
        node.style.contentVisibility = "";
        continue;
      }
      // With no stage mounted the node stays where it is, still rendered.
      if (normalView && node.parentElement !== normalView) {
        normalView.appendChild(node);
      }
      if (isTerminal) {
        node.style.display = "";
        node.style.visibility = activeInline ? "visible" : "hidden";
        node.style.pointerEvents = activeInline ? "auto" : "none";
        node.style.zIndex = activeInline ? "1" : "0";
        // xterm renders to a <canvas>; visibility:hidden alone can still let
        // a stale composited frame flash through for a tick when switching
        // to/from a non-terminal tab. content-visibility:hidden fully skips
        // painting the subtree while keeping its layout box intact, so
        // fitAddon.fit() still sees correct dimensions once it's shown again.
        node.style.contentVisibility = activeInline ? "" : "hidden";
      } else {
        // Plays a quick opacity fade-in on the tab that just became active.
        // Only play it on an actual switch into this tab -- gating on the
        // class alone replayed the animation on every unrelated re-render
        // that happened while the tab was still active (any render after
        // animationend had stripped the class), which looked like the
        // panel kept growing for up to a second after switching.
        if (activeInline && lastAnimatedTabId !== tab.id) {
          lastAnimatedTabId = tab.id;
          node.classList.remove("motion-workspace-enter");
          // Force a reflow so re-adding the class restarts the animation
          // instead of no-oping because it was already removed this tick.
          void node.offsetWidth;
          node.classList.add("motion-workspace-enter");
          node.addEventListener(
            "animationend",
            () => node.classList.remove("motion-workspace-enter"),
            { once: true },
          );
        } else if (!activeInline) {
          node.classList.remove("motion-workspace-enter");
          if (lastAnimatedTabId === tab.id) lastAnimatedTabId = null;
        }
        node.style.visibility = "";
        node.style.pointerEvents = "";
        node.style.zIndex = activeInline ? "2" : "";
        node.style.display = activeInline ? "" : "none";
      }
    }
  }

  return {
    getNode,
    portalOrder,
    paneEls,
    setPaneEl,
    normalView: () => normalView,
    setNormalView,
    place,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => version,
  };
}
