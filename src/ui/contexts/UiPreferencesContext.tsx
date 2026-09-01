/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getUiPreferences,
  saveUiPreferences,
  getUserPreferences,
} from "@/main-axios";
import {
  defaultUiPreferences,
  PRESETS,
  resolveArea,
  sanitizeUiPreferences,
  UI_ONBOARDING_VERSION,
  type UiAreaKey,
  type UiAreaPreferences,
  type UiOverrides,
  type UiPreferences,
  type UiPreset,
} from "@/types/ui-preferences";

const SAVE_DEBOUNCE_MS = 500;
const LS_KEY = "uiPreferences";
const SYNC_EVENT = "uiPreferencesChanged";

function readCache(): UiPreferences | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return sanitizeUiPreferences(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCache(preferences: UiPreferences) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(preferences));
  } catch {
    /* ignore */
  }
}

interface UiPreferencesContextValue {
  preferences: UiPreferences;
  loaded: boolean;
  resolve: <A extends UiAreaKey>(area: A) => UiAreaPreferences[A];
  setPreset: (preset: UiPreset) => void;
  setOverride: <A extends UiAreaKey, K extends keyof UiAreaPreferences[A]>(
    area: A,
    key: K,
    value: UiAreaPreferences[A][K] | null,
  ) => void;
  clearArea: (area: UiAreaKey) => void;
  clearAllOverrides: () => void;
  completeOnboarding: (skipped: boolean) => void;
}

const UiPreferencesContext = createContext<UiPreferencesContextValue | null>(
  null,
);

/**
 * App-wide interface preset and per-area overrides. Cached in localStorage for
 * instant paint and synced to the backend when storageMode is "cloud", the
 * same shape as useHostSidebarPreferences -- but provided once at the app root
 * rather than mounted per consumer, since almost every panel reads it.
 *
 * Writes send only the changed slice: the backend merges overrides two levels
 * deep and treats null as "clear this", so handing a knob back to the preset is
 * a single PUT rather than a read-modify-write of the whole document.
 */
export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<UiPreferences>(
    () => readCache() ?? defaultUiPreferences(),
  );
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<Record<string, unknown>>({});

  useEffect(() => {
    let cancelled = false;

    getUiPreferences()
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

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const queueSave = useCallback((patch: Record<string, unknown>) => {
    // Overrides accumulate key by key so a burst of edits still sends every
    // change; anything else is last-write-wins.
    const merged = { ...pendingPatch.current };
    for (const [key, value] of Object.entries(patch)) {
      if (key === "overrides" && value && typeof value === "object") {
        merged.overrides = {
          ...((merged.overrides as Record<string, unknown>) ?? {}),
          ...(value as Record<string, unknown>),
        };
      } else {
        merged[key] = value;
      }
    }
    pendingPatch.current = merged;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const body = pendingPatch.current;
      pendingPatch.current = {};
      getUserPreferences()
        .then((prefs) => {
          if (prefs.storageMode !== "cloud") return;
          return saveUiPreferences(body);
        })
        .catch(() => {
          /* best-effort; cache already holds it */
        });
    }, SAVE_DEBOUNCE_MS);
  }, []);

  /** Applies the local mirror of a patch, then queues the same patch remotely. */
  const applyLocal = useCallback(
    (
      mutate: (prev: UiPreferences) => UiPreferences,
      patch: Record<string, unknown>,
    ) => {
      setPreferences((prev) => {
        const next = sanitizeUiPreferences(mutate(prev));
        writeCache(next);
        window.dispatchEvent(new Event(SYNC_EVENT));
        return next;
      });
      queueSave(patch);
    },
    [queueSave],
  );

  const setPreset = useCallback(
    (preset: UiPreset) => {
      applyLocal((prev) => ({ ...prev, preset }), { preset });
    },
    [applyLocal],
  );

  const setOverride = useCallback(
    <A extends UiAreaKey, K extends keyof UiAreaPreferences[A]>(
      area: A,
      key: K,
      value: UiAreaPreferences[A][K] | null,
    ) => {
      applyLocal(
        (prev) => {
          const areaOverrides = {
            ...((prev.overrides[area] ?? {}) as Record<string, unknown>),
          };
          if (value === null) delete areaOverrides[key as string];
          else areaOverrides[key as string] = value;

          const overrides = { ...prev.overrides } as Record<string, unknown>;
          if (Object.keys(areaOverrides).length > 0)
            overrides[area] = areaOverrides;
          else delete overrides[area];

          return {
            ...prev,
            overrides: overrides as UiOverrides,
          };
        },
        { overrides: { [area]: { [key]: value } } },
      );
    },
    [applyLocal],
  );

  const clearArea = useCallback(
    (area: UiAreaKey) => {
      applyLocal(
        (prev) => {
          const overrides = { ...prev.overrides } as Record<string, unknown>;
          delete overrides[area];
          return { ...prev, overrides: overrides as UiOverrides };
        },
        { overrides: { [area]: null } },
      );
    },
    [applyLocal],
  );

  const clearAllOverrides = useCallback(() => {
    applyLocal((prev) => ({ ...prev, overrides: {} }), { overrides: null });
  }, [applyLocal]);

  const completeOnboarding = useCallback(
    (skipped: boolean) => {
      const onboarding = {
        completedVersion: UI_ONBOARDING_VERSION,
        completedAt: new Date().toISOString(),
        skipped,
      };
      applyLocal((prev) => ({ ...prev, onboarding }), { onboarding });
    },
    [applyLocal],
  );

  const value = useMemo<UiPreferencesContextValue>(
    () => ({
      preferences,
      loaded,
      resolve: (area) => resolveArea(preferences, area),
      setPreset,
      setOverride,
      clearArea,
      clearAllOverrides,
      completeOnboarding,
    }),
    [
      preferences,
      loaded,
      setPreset,
      setOverride,
      clearArea,
      clearAllOverrides,
      completeOnboarding,
    ],
  );

  return (
    <UiPreferencesContext.Provider value={value}>
      {children}
    </UiPreferencesContext.Provider>
  );
}

export function useUiPreferencesContext(): UiPreferencesContextValue | null {
  return useContext(UiPreferencesContext);
}

/**
 * Effective settings for one area. Falls back to the balanced preset (today's
 * behavior) outside a provider, so components rendered in isolation -- tests,
 * Electron sub-windows -- behave exactly as they did before presets existed
 * rather than crashing or silently going Simple.
 */
export function useAreaPreferences<A extends UiAreaKey>(
  area: A,
): UiAreaPreferences[A] {
  const ctx = useContext(UiPreferencesContext);
  if (!ctx) return PRESETS.balanced[area];
  return ctx.resolve(area);
}

export function useUiPreference<
  A extends UiAreaKey,
  K extends keyof UiAreaPreferences[A],
>(area: A, key: K): UiAreaPreferences[A][K] {
  return useAreaPreferences(area)[key];
}
