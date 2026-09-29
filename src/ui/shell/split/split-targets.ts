import { useSyncExternalStore } from "react";
import type { SplitSummary } from "./split-tabs";

/**
 * Lets menus outside the shell (the host list) offer "Open in split" without
 * threading split state through every sidebar component. The shell publishes
 * its splits here and registers how to aim the next opened tab at a pane.
 */

export type SplitOpenTarget =
  | { kind: "pane"; splitTabId: string; paneId: string }
  | { kind: "newPane"; splitTabId: string }
  /** A new split holding the active tab and the opened one. */
  | { kind: "newSplit" };

export interface SplitTargetsSnapshot {
  splits: SplitSummary[];
  /** The active tab can start a new split. */
  canStartSplit: boolean;
}

type Opener = (target: SplitOpenTarget, open: () => void) => void;

const EMPTY: SplitTargetsSnapshot = { splits: [], canStartSplit: false };
let snapshot: SplitTargetsSnapshot = EMPTY;
let snapshotKey = "";
let opener: Opener | null = null;
const listeners = new Set<() => void>();

export function publishSplitTargets(next: SplitTargetsSnapshot) {
  const key = JSON.stringify(next);
  if (key === snapshotKey) return;
  snapshotKey = key;
  snapshot = next;
  for (const listener of listeners) listener();
}

export function setSplitOpener(next: Opener): () => void {
  opener = next;
  return () => {
    if (opener === next) {
      opener = null;
      publishSplitTargets(EMPTY);
    }
  };
}

/** Runs `open` so whatever tab it opens lands in `target`. */
export function openInSplit(target: SplitOpenTarget, open: () => void) {
  if (opener) opener(target, open);
  else open();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSplitTargets(): SplitTargetsSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
}
