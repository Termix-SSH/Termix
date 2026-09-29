import type { LayoutNode, SplitState, Tab } from "@/types/ui-types";
import {
  assignTab,
  clearTab,
  createSplitState,
  findPaneByTab,
  focusPane,
  listPanes,
  mapTabIds,
  normalizeState,
  tabIdsInSplit,
} from "./split-tree";
import { fromLegacyConfig, type SplitPresetId } from "./split-presets";

/**
 * Split tabs as they live in the shell's tab list. A split tab owns its
 * layout tree; every tab shown in one of its panes carries parentSplitTabId
 * so the tab bar hides it. These keep the two in step.
 */

export const SPLIT_TAB_TYPE = "split-screen";

export type SplitTab = Tab & { split: SplitState };

export function isSplitTab(tab: Tab | undefined | null): tab is SplitTab {
  return !!tab && tab.type === SPLIT_TAB_TYPE && !!tab.split;
}

/** Tabs a pane may hold: anything but the dashboard and other splits. */
export function canJoinSplit(tab: Tab | undefined | null): boolean {
  return !!tab && tab.type !== "dashboard" && tab.type !== SPLIT_TAB_TYPE;
}

export function splitTabOf(tabs: Tab[], tabId: string): SplitTab | undefined {
  const tab = tabs.find((t) => t.id === tabId);
  const parentId = tab?.parentSplitTabId;
  const parent = parentId ? tabs.find((t) => t.id === parentId) : undefined;
  if (isSplitTab(parent) && findPaneByTab(parent.split, tabId)) return parent;
  return tabs.find(
    (t): t is SplitTab => isSplitTab(t) && !!findPaneByTab(t.split, tabId),
  );
}

/**
 * Makes parentSplitTabId match the trees. Pane tab ids that no longer exist
 * are emptied, and a tab claimed by two splits stays with the first.
 */
export function syncSplitChildren(tabs: Tab[]): Tab[] {
  const joinable = new Set(tabs.filter(canJoinSplit).map((tab) => tab.id));
  const owner = new Map<string, string>();
  let changed = false;

  const withSplits = tabs.map((tab) => {
    if (!isSplitTab(tab)) return tab;
    const split = normalizeState(
      tab.split,
      (id) => joinable.has(id) && !owner.has(id),
    );
    for (const id of tabIdsInSplit(split)) owner.set(id, tab.id);
    if (split === tab.split) return tab;
    changed = true;
    return { ...tab, split };
  });

  const next = withSplits.map((tab) => {
    const parent = owner.get(tab.id);
    if (parent) {
      if (tab.parentSplitTabId === parent) return tab;
      changed = true;
      return { ...tab, parentSplitTabId: parent };
    }
    if (tab.parentSplitTabId === undefined) return tab;
    changed = true;
    const { parentSplitTabId: _released, ...released } = tab;
    return released;
  });

  return changed ? next : tabs;
}

/** Empties the panes holding these tabs in every split but `exceptSplitId`. */
function releaseFromSplits(
  tabs: Tab[],
  tabIds: string[],
  exceptSplitId?: string,
): Tab[] {
  if (tabIds.length === 0) return tabs;
  return tabs.map((tab) => {
    if (!isSplitTab(tab) || tab.id === exceptSplitId) return tab;
    let split = tab.split;
    for (const id of tabIds) split = clearTab(split, id);
    return split === tab.split ? tab : { ...tab, split };
  });
}

/**
 * Applies `fn` to one split's state. Returning null closes the split and
 * sends its tabs back to the tab bar.
 */
export function updateSplit(
  tabs: Tab[],
  splitTabId: string,
  fn: (state: SplitState) => SplitState | null,
): Tab[] {
  const target = tabs.find((tab) => tab.id === splitTabId);
  if (!isSplitTab(target)) return tabs;
  const next = fn(target.split);
  if (next === target.split) return tabs;
  if (!next) return closeSplitTab(tabs, splitTabId);
  const claimed = tabIdsInSplit(next);
  const released = releaseFromSplits(tabs, claimed, splitTabId);
  return syncSplitChildren(
    released.map((tab) =>
      tab.id === splitTabId ? { ...tab, split: next } : tab,
    ),
  );
}

export function makeSplitTab(
  instanceId: string,
  label: string,
  split: SplitState,
  openedAt = Date.now(),
): SplitTab {
  return {
    id: `split-${instanceId}`,
    instanceId,
    type: SPLIT_TAB_TYPE,
    label,
    openedAt,
    split,
  };
}

/** Adds a split tab, taking its tabs out of any other split. */
export function addSplitTab(tabs: Tab[], splitTab: SplitTab): Tab[] {
  const released = releaseFromSplits(tabs, tabIdsInSplit(splitTab.split));
  return syncSplitChildren([...released, splitTab]);
}

/** Removes a split tab. Its tabs go back to the tab bar. */
export function closeSplitTab(tabs: Tab[], splitTabId: string): Tab[] {
  return syncSplitChildren(tabs.filter((tab) => tab.id !== splitTabId));
}

/**
 * Removes a closed tab. A pane that held it stays, empty and focused, so the
 * next thing the user opens can go straight into it.
 */
export function removeTab(tabs: Tab[], tabId: string): Tab[] {
  const without = tabs
    .filter((tab) => tab.id !== tabId)
    .map((tab) => {
      if (!isSplitTab(tab)) return tab;
      const pane = findPaneByTab(tab.split, tabId);
      if (!pane) return tab;
      return {
        ...tab,
        split: focusPane(clearTab(tab.split, tabId), pane.id),
      };
    });
  return syncSplitChildren(without);
}

/** Puts a tab in a pane of a split and focuses that pane. */
export function placeTabInPane(
  tabs: Tab[],
  splitTabId: string,
  paneId: string,
  tabId: string,
): Tab[] {
  if (!canJoinSplit(tabs.find((tab) => tab.id === tabId))) return tabs;
  return updateSplit(tabs, splitTabId, (state) =>
    focusPane(assignTab(state, paneId, tabId), paneId),
  );
}

/** What the tab bar asks the shell to do with splits. */
export type TabSplitAction =
  | { kind: "split"; tabId: string; edge: "right" | "bottom" }
  | { kind: "addToPane"; tabId: string; splitTabId: string; paneId: string }
  | {
      kind: "addPane";
      tabId: string;
      splitTabId: string;
      edge: "right" | "bottom";
    }
  | { kind: "unsplit"; splitTabId: string }
  | { kind: "splitActive"; edge: "right" | "bottom" }
  | { kind: "preset"; presetId: SplitPresetId };

/** The lowest N not already used by a "Split N" style label. */
export function nextSplitNumber(
  tabs: Tab[],
  labelFor: (n: number) => string,
): number {
  const used = new Set(
    tabs.filter((tab) => tab.type === SPLIT_TAB_TYPE).map((tab) => tab.label),
  );
  let n = 1;
  while (used.has(labelFor(n))) n += 1;
  return n;
}

export interface SplitPaneSummary {
  id: string;
  /** 1-based, in reading order. */
  index: number;
  tabId: string | null;
  /** The tab's label, or null for an empty pane. */
  label: string | null;
}

export interface SplitSummary {
  id: string;
  label: string;
  panes: SplitPaneSummary[];
  full: boolean;
}

export function summarizeSplits(tabs: Tab[], maxPanes: number): SplitSummary[] {
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  return tabs.filter(isSplitTab).map((tab) => {
    const panes = listPanes(tab.split.root);
    return {
      id: tab.id,
      label: tab.label,
      panes: panes.map((pane, i) => {
        const inPane = pane.tabId ? byId.get(pane.tabId) : undefined;
        return {
          id: pane.id,
          index: i + 1,
          tabId: pane.tabId,
          label: inPane ? inPane.customLabel || inPane.label : null,
        };
      }),
      full: panes.length >= maxPanes,
    };
  });
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/** Saved in localStorage; pane tab ids are tab instanceIds, which survive a reload. */
export type PersistedSplitTab = {
  version: 2;
  instanceId: string;
  label: string;
  root: LayoutNode;
  focusedPaneId: string;
};

/** The shape saved before the layout tree. */
type LegacyPersistedSplitTab = {
  instanceId: string;
  label: string;
  mode: string;
  paneInstanceIds: (string | null)[];
  rowSizes?: number[];
  rowColSizes?: number[][];
};

export function serializeSplitTabs(tabs: Tab[]): PersistedSplitTab[] {
  const instanceIdById = new Map(tabs.map((tab) => [tab.id, tab.instanceId]));
  return tabs.filter(isSplitTab).map((tab) => ({
    version: 2,
    instanceId: tab.instanceId,
    label: tab.label,
    root: mapTabIds(tab.split.root, (id) => instanceIdById.get(id) ?? null),
    focusedPaneId: tab.split.focusedPaneId,
  }));
}

function isLayoutNode(value: unknown): value is LayoutNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<LayoutNode>;
  if (node.kind === "pane") return typeof node.id === "string";
  if (node.kind === "split") {
    return (
      typeof node.id === "string" &&
      (node.direction === "row" || node.direction === "column") &&
      Array.isArray(node.children) &&
      node.children.length > 0 &&
      Array.isArray(node.sizes) &&
      node.children.every(isLayoutNode)
    );
  }
  return false;
}

/**
 * Rebuilds a saved split's tree with live tab ids. `resolve` maps whatever
 * the save used (instanceIds, workspace slotIds) to a live tab id. Null when
 * the entry is unreadable or none of its tabs came back.
 */
export function restoreSplitState(
  entry: unknown,
  resolve: (savedId: string) => string | null,
): SplitState | null {
  if (!entry || typeof entry !== "object") return null;
  const saved = entry as Partial<PersistedSplitTab> &
    Partial<LegacyPersistedSplitTab>;
  let root: LayoutNode | null = null;
  let focusedPaneId: string | undefined;
  if (isLayoutNode(saved.root)) {
    root = mapTabIds(saved.root, resolve);
    focusedPaneId = saved.focusedPaneId;
  } else if (
    typeof saved.mode === "string" &&
    Array.isArray(saved.paneInstanceIds)
  ) {
    root = fromLegacyConfig(
      saved.mode,
      saved.paneInstanceIds.map((id) => (id ? resolve(id) : null)),
      saved.rowSizes,
      saved.rowColSizes,
    );
  }
  if (!root) return null;
  const state = normalizeState(createSplitState(root, focusedPaneId));
  return tabIdsInSplit(state).length > 0 ? state : null;
}

export function restoreSplitTabs(
  persisted: unknown[],
  tabs: Tab[],
  openedAt = Date.now(),
): Tab[] {
  const tabIdByInstanceId = new Map(
    tabs.map((tab) => [tab.instanceId, tab.id]),
  );
  let next = tabs;
  for (const entry of persisted) {
    const saved = entry as { instanceId?: unknown; label?: unknown };
    if (typeof saved?.instanceId !== "string") continue;
    const instanceId = saved.instanceId;
    if (next.some((tab) => tab.instanceId === instanceId)) continue;
    const split = restoreSplitState(
      entry,
      (id) => tabIdByInstanceId.get(id) ?? null,
    );
    if (!split) continue;
    const label = typeof saved.label === "string" ? saved.label : "";
    next = addSplitTab(next, makeSplitTab(instanceId, label, split, openedAt));
  }
  return next;
}
