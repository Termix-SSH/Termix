import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCredentialSidebarPreferences,
  saveCredentialSidebarPreferences,
  getUserPreferences,
} from "@/main-axios";
import {
  defaultCredentialSidebarPreferences,
  sanitizeCredentialSidebarPreferences,
  type CredentialSidebarPreferences,
} from "@/types/credential-sidebar-preferences";

const SAVE_DEBOUNCE_MS = 500;
const LS_KEY = "credentialSidebarPreferences";
const SYNC_EVENT = "credentialSidebarPreferencesChanged";

function readCache(): CredentialSidebarPreferences | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return sanitizeCredentialSidebarPreferences(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCache(preferences: CredentialSidebarPreferences) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(preferences));
  } catch {
    /* ignore */
  }
}

/**
 * Unified credential sidebar preferences (sort, filters, open folders,
 * density, tag visibility, tray trigger), cached in localStorage for instant
 * paint and synced to the backend so they follow the user across devices
 * when storageMode is "cloud" -- same cache-then-fetch-then-debounced-save
 * shape as useHostSidebarPreferences, but a fully independent parallel
 * system (separate table, separate localStorage key, separate sync event),
 * not a shared blob with hosts.
 *
 * Multiple components (CredentialsPanel, CustomizeCredentialsSidebarPanel)
 * can call this hook at the same time. Each holds its own React state, so a
 * write in one instance broadcasts a same-tab custom event that every other
 * instance listens for to stay in sync.
 */
export function useCredentialSidebarPreferences() {
  const [preferences, setPreferences] = useState<CredentialSidebarPreferences>(
    () => readCache() ?? defaultCredentialSidebarPreferences(),
  );
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    getCredentialSidebarPreferences()
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
        | Partial<CredentialSidebarPreferences>
        | ((
            prev: CredentialSidebarPreferences,
          ) => CredentialSidebarPreferences),
    ) => {
      setPreferences((prev) => {
        const next = sanitizeCredentialSidebarPreferences(
          typeof patch === "function" ? patch(prev) : { ...prev, ...patch },
        );
        writeCache(next);
        window.dispatchEvent(new Event(SYNC_EVENT));

        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          getUserPreferences()
            .then((prefs) => {
              if (prefs.storageMode !== "cloud") return;
              return saveCredentialSidebarPreferences(next);
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
