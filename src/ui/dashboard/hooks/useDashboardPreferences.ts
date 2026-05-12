import { useState, useEffect, useCallback } from "react";
import {
  getDashboardPreferences,
  saveDashboardPreferences,
  type DashboardLayout,
} from "@/main-axios";

const LS_KEY = "dashboardLayout";

const DEFAULT_LAYOUT: DashboardLayout = {
  cards: [
    { id: "server_overview", enabled: true, order: 1, panel: "main" },
    { id: "quick_actions", enabled: true, order: 2, panel: "main" },
    { id: "server_stats", enabled: true, order: 3, panel: "main" },
    { id: "network_graph", enabled: false, order: 4, panel: "main" },
    { id: "recent_activity", enabled: true, order: 1, panel: "side" },
  ],
  mainWidthPct: 68,
};

function migrateLayout(preferences: DashboardLayout): DashboardLayout {
  const needsMigration = preferences.cards.some((c) => !c.panel);
  if (!needsMigration) return preferences;
  const defaultCardMap = new Map(DEFAULT_LAYOUT.cards.map((c) => [c.id, c]));
  return {
    ...preferences,
    mainWidthPct: preferences.mainWidthPct ?? DEFAULT_LAYOUT.mainWidthPct,
    cards: preferences.cards.map((c) => ({
      ...c,
      panel: c.panel ?? defaultCardMap.get(c.id)?.panel ?? "main",
    })),
  };
}

function readFromLocalStorage(): DashboardLayout | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.cards && Array.isArray(parsed.cards)) {
      return migrateLayout(parsed);
    }
  } catch {
    // ignore
  }
  return null;
}

function writeToLocalStorage(layout: DashboardLayout) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(layout));
  } catch {
    // ignore
  }
}

export function useDashboardPreferences(enabled: boolean = true) {
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLayout(DEFAULT_LAYOUT);
      setLoading(false);
      return;
    }

    // Show cached layout immediately so the UI doesn't wait for the network
    const cached = readFromLocalStorage();
    if (cached) {
      setLayout(cached);
      setLoading(false);
    }

    const fetchPreferences = async () => {
      try {
        const preferences = await getDashboardPreferences();
        if (preferences?.cards && Array.isArray(preferences.cards)) {
          const migrated = migrateLayout(preferences);
          setLayout(migrated);
          writeToLocalStorage(migrated);
        } else {
          if (!cached) {
            setLayout(DEFAULT_LAYOUT);
          }
        }
      } catch {
        if (!cached) {
          setLayout(DEFAULT_LAYOUT);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchPreferences();
  }, [enabled]);

  const updateLayout = useCallback(
    (newLayout: DashboardLayout) => {
      setLayout(newLayout);
      writeToLocalStorage(newLayout);

      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }

      const timeout = setTimeout(async () => {
        try {
          await saveDashboardPreferences(newLayout);
        } catch (error) {
          console.error("Failed to save dashboard preferences:", error);
        }
      }, 1000);

      setSaveTimeout(timeout);
    },
    [saveTimeout],
  );

  const resetLayout = useCallback(async () => {
    setLayout(DEFAULT_LAYOUT);
    writeToLocalStorage(DEFAULT_LAYOUT);
    try {
      await saveDashboardPreferences(DEFAULT_LAYOUT);
    } catch (error) {
      console.error("Failed to reset dashboard preferences:", error);
    }
  }, []);

  return {
    layout,
    loading,
    updateLayout,
    resetLayout,
  };
}
