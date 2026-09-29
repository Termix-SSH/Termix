import { useSyncExternalStore } from "react";
import type { DropTarget } from "./split-tree";

/**
 * Dragging a tab or a pane onto the main area to split it. The tab bar and
 * pane headers start a drag, the drop overlay over the main area answers
 * where the pointer is, and the shell's handler acts on the drop.
 */

export type SplitDragSource =
  | { kind: "tab"; tabId: string; label: string }
  | { kind: "pane"; splitTabId: string; paneId: string; label: string };

export interface SplitDropHover {
  /** The pane under the pointer, or null over a view that is not split. */
  paneId: string | null;
  target: DropTarget;
  rect: { left: number; top: number; width: number; height: number };
}

export interface SplitDragState {
  source: SplitDragSource;
  x: number;
  y: number;
  hover: SplitDropHover | null;
}

type HitTest = (
  x: number,
  y: number,
  source: SplitDragSource,
) => SplitDropHover | null;
type DropHandler = (source: SplitDragSource, hover: SplitDropHover) => void;

let state: SplitDragState | null = null;
let hitTest: HitTest | null = null;
let dropHandler: DropHandler | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function beginSplitDrag(source: SplitDragSource, x: number, y: number) {
  state = { source, x, y, hover: hitTest?.(x, y, source) ?? null };
  emit();
}

export function moveSplitDrag(x: number, y: number) {
  if (!state) return;
  state = { ...state, x, y, hover: hitTest?.(x, y, state.source) ?? null };
  emit();
}

/** Ends the drag, dropping it where it is when `commit` is true. */
export function endSplitDrag(commit: boolean) {
  const ended = state;
  if (!ended) return;
  state = null;
  emit();
  if (commit && ended.hover) dropHandler?.(ended.source, ended.hover);
}

export function isSplitDragging(): boolean {
  return state !== null;
}

export function setSplitDropHitTest(next: HitTest): () => void {
  hitTest = next;
  return () => {
    if (hitTest === next) hitTest = null;
  };
}

export function setSplitDropHandler(next: DropHandler): () => void {
  dropHandler = next;
  return () => {
    if (dropHandler === next) dropHandler = null;
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSplitDrag(): SplitDragState | null {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
}

/** Share of a pane's width or height, from each edge, that splits on drop. */
const EDGE_SHARE = 0.25;

/** Which zone of a rect a point falls in: an edge band, else the center. */
export function dropTargetAt(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
): DropTarget {
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const distances: [DropTarget, number][] = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ];
  const [edge, distance] = distances.reduce((best, entry) =>
    entry[1] < best[1] ? entry : best,
  );
  return distance < EDGE_SHARE ? edge : "center";
}

/** The part of a rect a drop target covers, for drawing the highlight. */
export function dropTargetRect(
  rect: { left: number; top: number; width: number; height: number },
  target: DropTarget,
): SplitDropHover["rect"] {
  const { left, top, width, height } = rect;
  switch (target) {
    case "left":
      return { left, top, width: width / 2, height };
    case "right":
      return { left: left + width / 2, top, width: width / 2, height };
    case "top":
      return { left, top, width, height: height / 2 };
    case "bottom":
      return { left, top: top + height / 2, width, height: height / 2 };
    default:
      return { left, top, width, height };
  }
}
