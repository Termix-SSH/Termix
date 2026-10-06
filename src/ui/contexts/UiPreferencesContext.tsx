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
  resolvePluginArea,
  type UiPluginPresets,
  sanitizeUiPreferences,
  type UiAreaKey,
  type UiAreaPreferences,
  type UiOverrides,
  type UiPreferences,
  type UiPreset,
} from "@/types/ui-preferences";
import { mergeSeen } from "@/types/onboarding";

const SAVE_DEBOUNCE_MS = 500;
const LS_KEY = "uiPreferences";

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
  /**
   * Records onboarding steps as seen (per-step max, never lowered).
   * `completed` stamps completedAt the first time a run finishes, and
   * `baselineDone` clears the carried-over-user flag.
   */
  markOnboardingSeen: (
    seen: Record<string, number>,
    options?: {
      completed?: boolean;
      skipped?: boolean;
      baselineDone?: boolean;
    },
  ) => void;
  /** Sends any queued change now instead of after the debounce. */
  flushNow: () => Promise<void>;
  /** A plugin's own area, from the presets it declared. */
  resolvePlugin: (
    pluginId: string,
    presets: UiPluginPresets | undefined,
  ) => Record<string, unknown>;
  setPluginOverride: (pluginId: string, key: string, value: unknown) => void;
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
export function UiPreferencesProvider({
  children,
  initial,
}: {
  children: ReactNode;
  /** Already fetched (by the onboarding gate), so no second request. */
  initial?: UiPreferences | null;
}) {
  const [preferences, setPreferences] = useState<UiPreferences>(
    () => initial ?? readCache() ?? defaultUiPreferences(),
  );
  const [loaded, setLoaded] = useState(!!initial);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<Record<string, unknown>>({});

  useEffect(() => {
    if (initial) {
      writeCache(initial);
      return;
    }
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
    // initial only matters on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = useCallback((): Promise<void> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const body = pendingPatch.current;
    pendingPatch.current = {};
    if (Object.keys(body).length === 0) return Promise.resolve();
    return getUserPreferences()
      .then((prefs) => {
        if (prefs.storageMode === "cloud") return saveUiPreferences(body);
        // The server copy replaces the cache on load, so onboarding has to
        // reach it even in local mode or it reruns every time.
        if (body.onboarding)
          return saveUiPreferences({
            onboarding: body.onboarding as UiPreferences["onboarding"],
          });
      })
      .catch(() => {
        /* best-effort; cache already holds it */
      });
  }, []);

  // A pending edit must not be lost when the provider goes away.
  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  const queueSave = useCallback(
    (patch: Record<string, unknown>) => {
      // Overrides accumulate key by key so a burst of edits still sends every
      // change, and onboarding seen maps merge; anything else is
      // last-write-wins.
      const merged = { ...pendingPatch.current };
      for (const [key, value] of Object.entries(patch)) {
        if (key === "overrides" && value && typeof value === "object") {
          merged.overrides = {
            ...((merged.overrides as Record<string, unknown>) ?? {}),
            ...(value as Record<string, unknown>),
          };
        } else if (key === "onboarding" && value && typeof value === "object") {
          const prev = (merged.onboarding ?? {}) as Record<string, unknown>;
          const next = value as Record<string, unknown>;
          merged.onboarding = {
            ...prev,
            ...next,
            seen: mergeSeen(
              prev.seen as Record<string, number>,
              next.seen as Record<string, number>,
            ),
          };
        } else {
          merged[key] = value;
        }
      }
      pendingPatch.current = merged;

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  /** Applies the local mirror of a patch, then queues the same patch remotely. */
  const applyLocal = useCallback(
    (
      mutate: (prev: UiPreferences) => UiPreferences,
      patch: Record<string, unknown>,
    ) => {
      setPreferences((prev) => {
        const next = sanitizeUiPreferences(mutate(prev));
        writeCache(next);
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

  const markOnboardingSeen = useCallback(
    (
      seen: Record<string, number>,
      options: {
        completed?: boolean;
        skipped?: boolean;
        baselineDone?: boolean;
      } = {},
    ) => {
      const patch: Record<string, unknown> = { seen };
      if (options.completed) patch.completedAt = new Date().toISOString();
      if (options.skipped !== undefined) patch.skipped = options.skipped;
      if (options.baselineDone) patch.baselinePending = false;
      applyLocal(
        (prev) => ({
          ...prev,
          onboarding: {
            ...prev.onboarding,
            ...patch,
            completedAt:
              prev.onboarding.completedAt ??
              (patch.completedAt as string | undefined) ??
              null,
            seen: mergeSeen(prev.onboarding.seen, seen),
          },
        }),
        { onboarding: patch },
      );
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
      markOnboardingSeen,
      flushNow: flush,
      resolvePlugin: (pluginId, presets) =>
        resolvePluginArea(preferences, pluginId, presets),
      setPluginOverride: (pluginId, key, value) =>
        setOverride(
          `plugin:${pluginId}` as never,
          key as never,
          value as never,
        ),
    }),
    [
      preferences,
      loaded,
      setPreset,
      setOverride,
      clearArea,
      clearAllOverrides,
      markOnboardingSeen,
      flush,
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
