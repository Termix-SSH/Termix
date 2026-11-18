/**
 * How many plugins are booting cold: their frame starts only to learn what
 * they register, since nothing was cached. The first-run screen reads this.
 */

export interface ColdBoot {
  total: number;
  done: number;
}

let snapshot: ColdBoot = { total: 0, done: 0 };
const listeners = new Set<() => void>();

function set(next: ColdBoot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Counts a cold boot until its promise settles either way. */
export function trackColdBoot(boot: Promise<unknown>): void {
  set({ ...snapshot, total: snapshot.total + 1 });
  const settle = () => set({ ...snapshot, done: snapshot.done + 1 });
  boot.then(settle, settle);
}

export function getColdBoot(): ColdBoot {
  return snapshot;
}

export function subscribeColdBoot(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam. */
export function resetColdBoot(): void {
  snapshot = { total: 0, done: 0 };
  listeners.clear();
}
