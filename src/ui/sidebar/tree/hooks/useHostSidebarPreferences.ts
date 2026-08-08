import { useCallback, useEffect, useRef, useState } from "react";
import {
  getHostSidebarPreferences,
  saveHostSidebarPreferences,
  getUserPreferences,
} from "@/main-axios";
import {
  defaultHostSidebarPreferences,
  sanitizeHostSidebarPreferences,
  type HostSidebarPreferences,
} from "@/types/host-sidebar-preferences";

const SAVE_DEBOUNCE_MS = 500;
const LS_KEY = "hostSidebarPreferences";
const SYNC_EVENT = "hostSidebarPreferencesChanged";

function readCache(): HostSidebarPreferences | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return sanitizeHostSidebarPreferences(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCache(preferences: HostSidebarPreferences) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(preferences));
  } catch {
    /* ignore */
  }
}

/**
 * Unified host sidebar preferences (sort, group, filters, open folders,
 * density, tag visibility, tray trigger, status color scheme), cached in
 * localStorage for instant paint and synced to the backend so they follow
 * the user across devices when storageMode is "cloud" -- same
 * cache-then-fetch-then-debounced-save shape as useHostMetricsPreferences,
 * but per-user rather than per-host, and gated on storageMode the way the
 * older per-preference localStorage toggles were.
 *
 * Multiple components (HostsPanel, CustomizeSidebarPanel, UserProfilePanel's
 * resetToDefaults) can call this hook at the same time. Each holds its own
 * React state, so a write in one instance broadcasts a same-tab custom event
 * (mirroring the showHostTagsChanged-style events the older per-preference
 * toggles used) that every other instance listens for to stay in sync.
 */
export function useHostSidebarPreferences() {
  const [preferences, setPreferences] = useState<HostSidebarPreferences>(
    () => readCache() ?? defaultHostSidebarPreferences(),
  );
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    getHostSidebarPreferences()
      .then((remote) => {
        if (cancelled) return;
        setPreferences(remote);
        writeCache(remote);
      })
      .catch(() => {
        /* keep cache/default */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      const cached = readCache();
      if (cached) setPreferences(cached);
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, []);

  const update = useCallback(
    (
      patch:
        | Partial<HostSidebarPreferences>
        | ((prev: HostSidebarPreferences) => HostSidebarPreferences),
    ) => {
      setPreferences((prev) => {
        const next = sanitizeHostSidebarPreferences(
          typeof patch === "function" ? patch(prev) : { ...prev, ...patch },
        );
        writeCache(next);
        window.dispatchEvent(new Event(SYNC_EVENT));

        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          getUserPreferences()
            .then((prefs) => {
              if (prefs.storageMode !== "cloud") return;
              return saveHostSidebarPreferences(next);
            })
            .catch(() => {
              /* best-effort; cache already holds it */
            });
        }, SAVE_DEBOUNCE_MS);

        return next;
      });
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return { preferences, update, loaded };
}
