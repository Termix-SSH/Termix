import type { TermixApp } from "@termix/plugin-sdk/frontend";

export const FLUSH_INTERVAL_MS = 5 * 60 * 1000;

type Counts = Record<string, number>;

/** Open tabs per type. Slot ids change on every read, so only types count. */
export function countTabTypes(layout: unknown): Counts {
  const tabs = (layout as { tabs?: unknown } | null)?.tabs;
  const counts: Counts = {};
  if (!Array.isArray(tabs)) return counts;
  for (const tab of tabs) {
    const type = (tab as { type?: unknown })?.type;
    if (typeof type === "string" && type)
      counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

/** Tabs opened between two snapshots, keyed as tab.<type>. */
export function openedSince(before: Counts, after: Counts): Counts {
  const opened: Counts = {};
  for (const [type, count] of Object.entries(after)) {
    const added = count - (before[type] ?? 0);
    if (added > 0) opened[`tab.${type}`] = added;
  }
  return opened;
}

/**
 * Counts which kinds of tabs the user opens and sends the totals to the
 * plugin's backend every few minutes. Does nothing unless the backend says
 * this user is counted.
 */
export function startTabTracker(
  app: TermixApp,
  flushMs: number = FLUSH_INTERVAL_MS,
): () => void {
  let track = false;
  let ready = false;
  let previous: Counts = {};
  let pending: Counts = {};

  const snapshot = () => countTabTypes(app.tabs.getLayout());

  const refreshConfig = async () => {
    try {
      const { data } = await app.api.get<{ track?: boolean }>("/usage/config");
      track = data?.track === true;
    } catch {
      track = false;
    }
    if (!track) pending = {};
  };

  const flush = (keepalive = false) => {
    if (!track || Object.keys(pending).length === 0) return;
    const features = pending;
    pending = {};
    void app
      .fetch("/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features }),
        keepalive,
      })
      .catch(() => undefined);
  };

  const disposers: Array<() => void> = [];

  disposers.push(
    app.tabs.onReady(() => {
      // Tabs restored after login were opened in an earlier session.
      previous = snapshot();
      ready = true;
    }),
  );

  disposers.push(
    app.tabs.onChange(() => {
      const current = snapshot();
      if (ready && track) {
        for (const [name, count] of Object.entries(
          openedSince(previous, current),
        )) {
          pending[name] = (pending[name] ?? 0) + count;
        }
      }
      previous = current;
    }),
  );

  disposers.push(app.onSettingsChanged(() => void refreshConfig()));

  const timer = setInterval(() => flush(), flushMs);
  disposers.push(() => clearInterval(timer));

  const onPageHide = () => flush(true);
  window.addEventListener("pagehide", onPageHide);
  disposers.push(() => window.removeEventListener("pagehide", onPageHide));

  void refreshConfig();

  return () => {
    flush(true);
    for (const dispose of disposers) dispose();
  };
}
