import { useCallback, useEffect, useState } from "react";

/**
 * Drag-to-rearrange lock for a sidebar tree, kept per-device in
 * localStorage rather than in the synced sidebar-preferences blob.
 *
 * It deliberately does NOT live in HostSidebarPreferences /
 * CredentialSidebarPreferences: those are fetched from the server on every
 * mount and the response replaces local state wholesale, so a value the
 * server has never stored (and, outside "cloud" storage mode, never will)
 * gets clobbered back to its default the moment the fetch resolves. That
 * made the toggle appear to do nothing at all.
 *
 * Locked is the default, so a fresh device never drags by accident.
 */
export function useArrangeLock(storageKey: string) {
  const syncEvent = `${storageKey}:changed`;

  const read = useCallback(() => {
    try {
      return localStorage.getItem(storageKey) === "false";
    } catch {
      return false;
    }
  }, [storageKey]);

  const [unlocked, setUnlocked] = useState(read);

  useEffect(() => {
    const handler = () => setUnlocked(read());
    window.addEventListener(syncEvent, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(syncEvent, handler);
      window.removeEventListener("storage", handler);
    };
  }, [syncEvent, read]);

  const toggle = useCallback(() => {
    const next = !read();
    try {
      localStorage.setItem(storageKey, next ? "false" : "true");
    } catch {
      /* ignore */
    }
    setUnlocked(next);
    window.dispatchEvent(new Event(syncEvent));
    return next;
  }, [storageKey, syncEvent, read]);

  return { arrangeLocked: !unlocked, toggleArrangeLock: toggle };
}
