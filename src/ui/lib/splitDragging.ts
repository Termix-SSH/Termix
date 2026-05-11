// Module-level flag: true while a split pane divider is being dragged.
// TerminalTab reads this to suppress fit() calls during drag.
export const splitDragState = { active: false };

// Callbacks registered by terminal instances to trigger a fit after drag ends.
const fitCallbacks = new Set<() => void>();

export function registerFitCallback(fn: () => void) {
  fitCallbacks.add(fn);
  return () => fitCallbacks.delete(fn);
}

export function notifyDragEnd() {
  for (const fn of fitCallbacks) fn();
}
