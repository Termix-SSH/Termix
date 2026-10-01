import { createId } from "@/lib/create-id";
import type {
  LayoutNode,
  PaneNode,
  SplitDirection,
  SplitNode,
  SplitState,
} from "@/types/ui-types";

/**
 * The layout of one split tab: a tree where every leaf is a pane holding at
 * most one tab, and every inner node lays its children out in a row (side by
 * side) or a column (stacked). All functions here are pure and return a new
 * state, so the shell can keep the whole thing on the split tab itself.
 */

export const MAX_PANES = 8;
/** Smallest share of its parent a pane or group can be dragged down to. */
export const MIN_PANE_SIZE = 10;

export type {
  SplitDirection,
  PaneNode,
  SplitNode,
  LayoutNode,
  SplitState,
} from "@/types/ui-types";
export type PaneEdge = "left" | "right" | "top" | "bottom";
export type DropTarget = PaneEdge | "center";
export type NavDirection = "left" | "right" | "up" | "down";

export interface PaneRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function createPane(tabId: string | null = null): PaneNode {
  return { kind: "pane", id: createId(), tabId };
}

export function evenSizes(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count);
}

export function createSplitNode(
  direction: SplitDirection,
  children: LayoutNode[],
  sizes?: number[],
): SplitNode {
  return {
    kind: "split",
    id: createId(),
    direction,
    children,
    sizes:
      sizes && sizes.length === children.length
        ? scaleTo100(sizes)
        : evenSizes(children.length),
  };
}

export function createSplitState(
  root: LayoutNode,
  focusedPaneId?: string,
): SplitState {
  const panes = listPanes(root);
  const focused =
    panes.find((pane) => pane.id === focusedPaneId) ??
    panes.find((pane) => pane.tabId === null) ??
    panes[0];
  return { root, focusedPaneId: focused.id, zoomedPaneId: null };
}

export function listPanes(node: LayoutNode): PaneNode[] {
  if (node.kind === "pane") return [node];
  return node.children.flatMap(listPanes);
}

export function paneCount(state: SplitState): number {
  return listPanes(state.root).length;
}

export function findPane(
  state: SplitState,
  paneId: string,
): PaneNode | undefined {
  return listPanes(state.root).find((pane) => pane.id === paneId);
}

export function findPaneByTab(
  state: SplitState,
  tabId: string,
): PaneNode | undefined {
  return listPanes(state.root).find((pane) => pane.tabId === tabId);
}

export function emptyPanes(state: SplitState): PaneNode[] {
  return listPanes(state.root).filter((pane) => pane.tabId === null);
}

export function tabIdsInSplit(state: SplitState): string[] {
  return listPanes(state.root).flatMap((pane) =>
    pane.tabId ? [pane.tabId] : [],
  );
}

/**
 * The panes on screen: just the zoomed one, just the focused one when only
 * one fits (mobile), else all of them.
 */
export function shownPanes(state: SplitState, onePaneOnly = false): PaneNode[] {
  const panes = listPanes(state.root);
  const single =
    state.zoomedPaneId ?? (onePaneOnly ? state.focusedPaneId : null);
  const pane = single ? panes.find((p) => p.id === single) : undefined;
  return pane ? [pane] : panes;
}

export function canAddPane(state: SplitState): boolean {
  return paneCount(state) < MAX_PANES;
}

function edgeDirection(edge: PaneEdge): SplitDirection {
  return edge === "left" || edge === "right" ? "row" : "column";
}

function isLeadingEdge(edge: PaneEdge): boolean {
  return edge === "left" || edge === "top";
}

function scaleTo100(sizes: number[]): number[] {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!(total > 0)) return evenSizes(sizes.length);
  return sizes.map((size) => (size / total) * 100);
}

function mapPanes(
  node: LayoutNode,
  fn: (pane: PaneNode) => PaneNode,
): LayoutNode {
  if (node.kind === "pane") return fn(node);
  let changed = false;
  const children = node.children.map((child) => {
    const next = mapPanes(child, fn);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

function mapSplit(
  node: LayoutNode,
  splitId: string,
  fn: (split: SplitNode) => SplitNode,
): LayoutNode {
  if (node.kind === "pane") return node;
  if (node.id === splitId) return fn(node);
  let changed = false;
  const children = node.children.map((child) => {
    const next = mapSplit(child, splitId, fn);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

/**
 * Collapses groups with one child, inlines a child group running the same
 * way as its parent, and rescales sizes. Keeps the tree in the one shape the
 * rest of the code expects after any edit.
 */
export function normalizeNode(node: LayoutNode): LayoutNode {
  if (node.kind === "pane") return node;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  const baseSizes =
    node.sizes.length === node.children.length
      ? node.sizes
      : evenSizes(node.children.length);
  let changed = baseSizes !== node.sizes;
  node.children.forEach((raw, index) => {
    const child = normalizeNode(raw);
    if (child !== raw) changed = true;
    const size = baseSizes[index] ?? 0;
    if (child.kind === "split" && child.direction === node.direction) {
      changed = true;
      child.children.forEach((grandchild, i) => {
        children.push(grandchild);
        sizes.push((size * child.sizes[i]) / 100);
      });
    } else {
      children.push(child);
      sizes.push(size);
    }
  });
  if (children.length === 1) return children[0];
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!changed && Math.abs(total - 100) < 0.01) return node;
  return { ...node, children, sizes: scaleTo100(sizes) };
}

function insertBeside(
  node: LayoutNode,
  paneId: string,
  edge: PaneEdge,
  newPane: PaneNode,
): LayoutNode {
  const direction = edgeDirection(edge);
  if (node.kind === "pane") {
    if (node.id !== paneId) return node;
    return createSplitNode(
      direction,
      isLeadingEdge(edge) ? [newPane, node] : [node, newPane],
    );
  }
  const index = node.children.findIndex(
    (child) => child.kind === "pane" && child.id === paneId,
  );
  if (index !== -1 && node.direction === direction) {
    const children = [...node.children];
    const sizes = [...node.sizes];
    const half = sizes[index] / 2;
    const insertAt = isLeadingEdge(edge) ? index : index + 1;
    sizes[index] = half;
    children.splice(insertAt, 0, newPane);
    sizes.splice(insertAt, 0, half);
    return { ...node, children, sizes };
  }
  let changed = false;
  const children = node.children.map((child) => {
    const next = insertBeside(child, paneId, edge, newPane);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

/** Removes `tabId` from every pane except `keepPaneId`: a tab lives in one pane. */
function releaseTabElsewhere(
  node: LayoutNode,
  tabId: string,
  keepPaneId: string,
): LayoutNode {
  return mapPanes(node, (pane) =>
    pane.tabId === tabId && pane.id !== keepPaneId
      ? { ...pane, tabId: null }
      : pane,
  );
}

/**
 * Adds a pane next to `paneId`, holding `tabId` or empty. Null when the pane
 * does not exist or the split is full.
 */
export function splitPane(
  state: SplitState,
  paneId: string,
  edge: PaneEdge,
  tabId: string | null = null,
): { state: SplitState; paneId: string } | null {
  if (!findPane(state, paneId) || !canAddPane(state)) return null;
  const newPane = createPane(tabId);
  let root = insertBeside(state.root, paneId, edge, newPane);
  if (tabId) root = releaseTabElsewhere(root, tabId, newPane.id);
  return {
    state: {
      ...state,
      root: normalizeNode(root),
      focusedPaneId: newPane.id,
      zoomedPaneId: null,
    },
    paneId: newPane.id,
  };
}

/** Adds a pane along one outer edge of the whole split. */
export function addPaneAtEdge(
  state: SplitState,
  edge: PaneEdge,
  tabId: string | null = null,
): { state: SplitState; paneId: string } | null {
  if (!canAddPane(state)) return null;
  const direction = edgeDirection(edge);
  const newPane = createPane(tabId);
  const leading = isLeadingEdge(edge);
  let root: LayoutNode;
  if (state.root.kind === "split" && state.root.direction === direction) {
    const count = state.root.children.length;
    const share = 100 / (count + 1);
    const scaled = state.root.sizes.map((size) => (size * count) / (count + 1));
    root = {
      ...state.root,
      children: leading
        ? [newPane, ...state.root.children]
        : [...state.root.children, newPane],
      sizes: leading ? [share, ...scaled] : [...scaled, share],
    };
  } else {
    root = createSplitNode(
      direction,
      leading ? [newPane, state.root] : [state.root, newPane],
    );
  }
  if (tabId) root = releaseTabElsewhere(root, tabId, newPane.id);
  return {
    state: {
      ...state,
      root: normalizeNode(root),
      focusedPaneId: newPane.id,
      zoomedPaneId: null,
    },
    paneId: newPane.id,
  };
}

function withoutPane(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.kind === "pane") return node.id === paneId ? null : node;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  let changed = false;
  node.children.forEach((child, index) => {
    const next = withoutPane(child, paneId);
    if (next !== child) changed = true;
    if (next) {
      children.push(next);
      sizes.push(node.sizes[index]);
    }
  });
  if (!changed) return node;
  if (children.length === 0) return null;
  return { ...node, children, sizes };
}

/** Removes a pane. Null when it was the last one, so the split should close. */
export function removePane(
  state: SplitState,
  paneId: string,
): SplitState | null {
  const before = listPanes(state.root);
  const index = before.findIndex((pane) => pane.id === paneId);
  if (index === -1) return state;
  const raw = withoutPane(state.root, paneId);
  if (!raw) return null;
  const root = normalizeNode(raw);
  const after = listPanes(root);
  const focusedPaneId =
    state.focusedPaneId !== paneId &&
    after.some((pane) => pane.id === state.focusedPaneId)
      ? state.focusedPaneId
      : after[Math.max(0, index - 1)].id;
  return {
    root,
    focusedPaneId,
    zoomedPaneId: state.zoomedPaneId === paneId ? null : state.zoomedPaneId,
  };
}

/** Puts a tab in a pane (or empties it with null), moving it out of any other pane. */
export function assignTab(
  state: SplitState,
  paneId: string,
  tabId: string | null,
): SplitState {
  if (!findPane(state, paneId)) return state;
  const root = mapPanes(state.root, (pane) => {
    if (pane.id === paneId)
      return pane.tabId === tabId ? pane : { ...pane, tabId };
    if (tabId && pane.tabId === tabId) return { ...pane, tabId: null };
    return pane;
  });
  return root === state.root ? state : { ...state, root };
}

/** Empties whichever pane holds the tab, leaving the pane in place. */
export function clearTab(state: SplitState, tabId: string): SplitState {
  const root = mapPanes(state.root, (pane) =>
    pane.tabId === tabId ? { ...pane, tabId: null } : pane,
  );
  return root === state.root ? state : { ...state, root };
}

export function swapPanes(
  state: SplitState,
  firstId: string,
  secondId: string,
): SplitState {
  const first = findPane(state, firstId);
  const second = findPane(state, secondId);
  if (!first || !second || firstId === secondId) return state;
  const root = mapPanes(state.root, (pane) => {
    if (pane.id === firstId) return { ...pane, tabId: second.tabId };
    if (pane.id === secondId) return { ...pane, tabId: first.tabId };
    return pane;
  });
  return { ...state, root };
}

/**
 * Drops one pane onto another: the center swaps their contents, an edge
 * moves the dragged pane to that side of the target.
 */
export function movePane(
  state: SplitState,
  fromId: string,
  toId: string,
  target: DropTarget,
): SplitState {
  if (fromId === toId) return state;
  const from = findPane(state, fromId);
  if (!from || !findPane(state, toId)) return state;
  if (target === "center") {
    return { ...swapPanes(state, fromId, toId), focusedPaneId: toId };
  }
  const removed = removePane(state, fromId);
  if (!removed) return state;
  const moved = splitPane(removed, toId, target, from.tabId);
  return moved ? moved.state : state;
}

export function focusPane(state: SplitState, paneId: string): SplitState {
  if (state.focusedPaneId === paneId || !findPane(state, paneId)) return state;
  return {
    ...state,
    focusedPaneId: paneId,
    // Moving focus out of a zoomed pane would leave the user looking at a
    // pane they are not typing into.
    zoomedPaneId: state.zoomedPaneId ? paneId : state.zoomedPaneId,
  };
}

export function toggleZoom(state: SplitState, paneId: string): SplitState {
  if (!findPane(state, paneId)) return state;
  const zoomed = state.zoomedPaneId === paneId;
  return {
    ...state,
    focusedPaneId: paneId,
    zoomedPaneId: zoomed ? null : paneId,
  };
}

export function resizeSplit(
  state: SplitState,
  splitId: string,
  sizes: number[],
): SplitState {
  const root = mapSplit(state.root, splitId, (split) =>
    sizes.length === split.children.length
      ? { ...split, sizes: scaleTo100(sizes) }
      : split,
  );
  return root === state.root ? state : { ...state, root };
}

export function equalizeSplit(state: SplitState, splitId: string): SplitState {
  const root = mapSplit(state.root, splitId, (split) => ({
    ...split,
    sizes: evenSizes(split.children.length),
  }));
  return root === state.root ? state : { ...state, root };
}

/**
 * Moves the divider between children `index` and `index + 1` by `delta`
 * percent, keeping both above MIN_PANE_SIZE.
 */
export function moveDivider(
  sizes: number[],
  index: number,
  delta: number,
): number[] {
  const a = sizes[index];
  const b = sizes[index + 1];
  if (a === undefined || b === undefined) return sizes;
  const nextA = Math.max(
    MIN_PANE_SIZE,
    Math.min(a + b - MIN_PANE_SIZE, a + delta),
  );
  const next = [...sizes];
  next[index] = nextA;
  next[index + 1] = a + b - nextA;
  return next;
}

/**
 * Repairs a state read from storage or left over after tabs closed: drops
 * tab ids that no longer exist, keeps each tab in one pane, fixes focus.
 */
export function normalizeState(
  state: SplitState,
  isLiveTab: (tabId: string) => boolean = () => true,
): SplitState {
  const seen = new Set<string>();
  const root = normalizeNode(
    mapPanes(state.root, (pane) => {
      if (!pane.tabId) return pane;
      if (!isLiveTab(pane.tabId) || seen.has(pane.tabId)) {
        return { ...pane, tabId: null };
      }
      seen.add(pane.tabId);
      return pane;
    }),
  );
  const panes = listPanes(root);
  const focusedPaneId = panes.some((pane) => pane.id === state.focusedPaneId)
    ? state.focusedPaneId
    : panes[0].id;
  const zoomedPaneId = panes.some((pane) => pane.id === state.zoomedPaneId)
    ? (state.zoomedPaneId ?? null)
    : null;
  if (
    root === state.root &&
    focusedPaneId === state.focusedPaneId &&
    zoomedPaneId === (state.zoomedPaneId ?? null)
  ) {
    return state;
  }
  return { root, focusedPaneId, zoomedPaneId };
}

/** Rewrites every pane's tab id, e.g. live ids to saved instance ids and back. */
export function mapTabIds(
  node: LayoutNode,
  fn: (tabId: string) => string | null,
): LayoutNode {
  return mapPanes(node, (pane) =>
    pane.tabId ? { ...pane, tabId: fn(pane.tabId) } : pane,
  );
}

/**
 * The pane next to `paneId` in a direction, by on-screen position. Picks the
 * closest pane that overlaps along the other axis, then the one with the
 * most overlap, so it works for any tree shape.
 */
export function neighborPane(
  paneId: string,
  direction: NavDirection,
  rects: Record<string, PaneRect>,
): string | null {
  const from = rects[paneId];
  if (!from) return null;
  let best: { id: string; distance: number; overlap: number } | null = null;
  for (const [id, rect] of Object.entries(rects)) {
    if (id === paneId) continue;
    let distance: number;
    let overlap: number;
    if (direction === "left" || direction === "right") {
      distance =
        direction === "right" ? rect.left - from.right : from.left - rect.right;
      overlap =
        Math.min(rect.bottom, from.bottom) - Math.max(rect.top, from.top);
    } else {
      distance =
        direction === "down" ? rect.top - from.bottom : from.top - rect.bottom;
      overlap =
        Math.min(rect.right, from.right) - Math.max(rect.left, from.left);
    }
    // A pixel of slack for the dividers and sub-pixel layout.
    if (distance < -2 || overlap <= 0) continue;
    if (
      !best ||
      distance < best.distance - 1 ||
      (Math.abs(distance - best.distance) <= 1 && overlap > best.overlap)
    ) {
      best = { id, distance, overlap };
    }
  }
  return best?.id ?? null;
}
