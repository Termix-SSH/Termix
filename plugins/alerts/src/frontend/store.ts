import { useSyncExternalStore } from "react";
import type { AlertItem } from "../types";

interface ServerSentEvent {
  event: string;
  data: string;
}

export function parseServerSentEvents(
  buffer: string,
  onEvent: (event: ServerSentEvent) => void,
): string {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length > 0) onEvent({ event, data: data.join("\n") });
  }
  return rest;
}

export interface AlertsStoreDeps {
  /** Opens the event stream; app.fetch carries core's auth. */
  connect: (init: RequestInit) => Promise<Response>;
  /** The unread count, for when the stream is down. */
  loadUnread: () => Promise<number>;
  retryMs?: number;
  pollMs?: number;
}

/**
 * The live side of the inbox: the unread count every badge shows, and every
 * new alert as it arrives, from one stream shared by the whole app.
 */
export function createAlertsStore(deps: AlertsStoreDeps) {
  const retryMs = deps.retryMs ?? 5_000;
  const pollMs = deps.pollMs ?? 60_000;
  let unread = 0;
  let version = 0;
  const seen = new Set<number>();
  const listeners = new Set<() => void>();
  const itemListeners = new Set<(item: AlertItem, isNew: boolean) => void>();
  let controller: AbortController | null = null;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const setUnread = (count: number) => {
    if (count === unread) return;
    unread = Math.max(0, count);
    emit();
  };

  const onItem = (item: AlertItem) => {
    const isNew = !seen.has(item.id);
    seen.add(item.id);
    version++;
    emit();
    for (const listener of itemListeners) listener(item, isNew);
  };

  const wait = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });

  async function run(signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const response = await deps.connect({
          headers: { Accept: "text/event-stream" },
          signal,
        });
        if (!response.ok || !response.body) throw new Error("stream failed");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer = parseServerSentEvents(
            buffer + decoder.decode(value, { stream: true }),
            (event) => {
              try {
                const data = JSON.parse(event.data);
                if (event.event === "unread") setUnread(Number(data.count));
                else if (event.event === "item") onItem(data as AlertItem);
              } catch {
                // A malformed event is skipped; the next one carries the count.
              }
            },
          );
        }
      } catch {
        // Falls through to a poll and a retry.
      }
      if (signal.aborted) return;
      try {
        setUnread(await deps.loadUnread());
      } catch {
        // Still offline.
      }
      await wait(retryMs, signal);
    }
  }

  return {
    start(): void {
      if (controller) return;
      controller = new AbortController();
      const { signal } = controller;
      void run(signal);
      // A proxy that buffers the stream would hold the count back forever.
      void (async () => {
        while (!signal.aborted) {
          await wait(pollMs, signal);
          if (signal.aborted) return;
          try {
            setUnread(await deps.loadUnread());
          } catch {
            // Offline; the stream loop retries.
          }
        }
      })();
    },

    stop(): void {
      controller?.abort();
      controller = null;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Every alert that arrives while the app is open, and whether it is new. */
    onItem(listener: (item: AlertItem, isNew: boolean) => void): () => void {
      itemListeners.add(listener);
      return () => {
        itemListeners.delete(listener);
      };
    },

    unread: () => unread,
    /** Bumps whenever an alert arrives, so open lists know to reload. */
    version: () => version,
    setUnread,
  };
}

export type AlertsStore = ReturnType<typeof createAlertsStore>;

export function useUnreadCount(store: AlertsStore): number {
  return useSyncExternalStore(store.subscribe, store.unread, store.unread);
}

export function useAlertsVersion(store: AlertsStore): number {
  return useSyncExternalStore(store.subscribe, store.version, store.version);
}
