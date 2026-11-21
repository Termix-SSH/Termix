import type { Tab } from "@/types/ui-types";

/**
 * Includes hidden tabs and split children; each plugin decides whether it is
 * idle. A tab drawn in a frame answers through a promise, so all are awaited.
 */
export async function reconnectDisconnectedTabs(tabs: readonly Tab[]) {
  const seen = new Set<NonNullable<Tab["terminalRef"]>["current"]>();
  const asks: Promise<unknown>[] = [];
  for (const tab of tabs) {
    const handle = tab.terminalRef?.current;
    if (!handle?.reconnectIfDisconnected || seen.has(handle)) continue;
    seen.add(handle);
    asks.push(Promise.resolve().then(() => handle.reconnectIfDisconnected?.()));
  }
  const results = await Promise.allSettled(asks);
  let reconnected = 0;
  let failed = 0;
  for (const result of results) {
    if (result.status === "rejected") failed++;
    else if (result.value) reconnected++;
  }
  return { reconnected, failed };
}
