import type { Tab } from "@/types/ui-types";

/** Includes hidden tabs and split children; each plugin decides whether it is idle. */
export function reconnectDisconnectedTabs(tabs: readonly Tab[]) {
  const seen = new Set<NonNullable<Tab["terminalRef"]>["current"]>();
  let reconnected = 0;
  let failed = 0;
  for (const tab of tabs) {
    const handle = tab.terminalRef?.current;
    if (!handle?.reconnectIfDisconnected || seen.has(handle)) continue;
    seen.add(handle);
    try {
      if (handle.reconnectIfDisconnected()) reconnected++;
    } catch {
      failed++;
    }
  }
  return { reconnected, failed };
}
