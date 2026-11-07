import { useCallback, useEffect, useRef } from "react";

const STATE_KEY = "termixTab";

/**
 * The tabs the user moved through, oldest first. Back and forward skip tabs
 * that were closed since.
 */
export class TabHistory {
  entries: string[] = [];
  index = -1;

  record(id: string): void {
    if (this.entries[this.index] === id) return;
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(id);
    this.index = this.entries.length - 1;
  }

  /** Moves toward `target` and returns the open tab it lands on, if any. */
  stepTo(target: number, isOpen: (id: string) => boolean): string | null {
    const step = target < this.index ? -1 : 1;
    let i = Math.max(0, Math.min(target, this.entries.length - 1));
    while (i >= 0 && i < this.entries.length) {
      const id = this.entries[i];
      if (id !== this.entries[this.index] && isOpen(id)) {
        this.index = i;
        return id;
      }
      i += step;
    }
    return null;
  }

  /** The most recent open tab other than `except`, for picking a tab after a close. */
  recent(except: string, isOpen: (id: string) => boolean): string | null {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const id = this.entries[i];
      if (id !== except && isOpen(id)) return id;
    }
    return null;
  }
}

function browserIndex(state: unknown): number | null {
  if (!state || typeof state !== "object") return null;
  const value = (state as Record<string, unknown>)[STATE_KEY];
  return typeof value === "number" ? value : null;
}

/**
 * Browser back and forward (and the mouse side buttons) move between the
 * tabs the user had open, like pages. Each tab switch adds a browser history
 * entry on the same URL.
 */
export function useTabHistory({
  activeTabId,
  isOpen,
  isTopLevel,
  setActiveTabId,
}: {
  activeTabId: string;
  isOpen: (id: string) => boolean;
  isTopLevel: (id: string) => boolean;
  setActiveTabId: (id: string) => void;
}) {
  const historyRef = useRef(new TabHistory());
  const steppingRef = useRef<string | null>(null);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const setActiveRef = useRef(setActiveTabId);
  setActiveRef.current = setActiveTabId;

  useEffect(() => {
    if (!isTopLevel(activeTabId)) return;
    const history = historyRef.current;
    if (steppingRef.current === activeTabId) {
      steppingRef.current = null;
      return;
    }
    steppingRef.current = null;
    if (history.entries[history.index] === activeTabId) return;
    const first = history.index < 0;
    history.record(activeTabId);
    const state = {
      ...(window.history.state ?? {}),
      [STATE_KEY]: history.index,
    };
    try {
      if (first) window.history.replaceState(state, "");
      else window.history.pushState(state, "");
    } catch {
      // Some embedded browsers refuse history writes; tabs still work.
    }
  }, [activeTabId, isTopLevel]);

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const history = historyRef.current;
      const target = browserIndex(event.state) ?? 0;
      if (target === history.index) return;
      const id = history.stepTo(target, isOpenRef.current);
      if (!id) return;
      steppingRef.current = id;
      setActiveRef.current(id);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const back = useCallback(() => window.history.back(), []);
  const forward = useCallback(() => window.history.forward(), []);
  const recent = useCallback(
    (except: string) => historyRef.current.recent(except, isOpenRef.current),
    [],
  );

  return { back, forward, recent };
}
