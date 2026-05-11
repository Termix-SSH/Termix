import { useState, useEffect, useCallback } from "react";
import {
  getDashboardPreferences,
  saveDashboardPreferences,
  type DashboardLayout,
} from "@/main-axios";

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

    const fetchPreferences = async () => {
      try {
        const preferences = await getDashboardPreferences();
        if (preferences?.cards && Array.isArray(preferences.cards)) {
          // Migrate old layouts that don't have panel assignments
          const needsMigration = preferences.cards.some((c) => !c.panel);
          if (needsMigration) {
            const defaultCardMap = new Map(
              DEFAULT_LAYOUT.cards.map((c) => [c.id, c]),
            );
            const migrated: DashboardLayout = {
              ...preferences,
              mainWidthPct:
                preferences.mainWidthPct ?? DEFAULT_LAYOUT.mainWidthPct,
              cards: preferences.cards.map((c) => ({
                ...c,
                panel: c.panel ?? defaultCardMap.get(c.id)?.panel ?? "main",
              })),
            };
            setLayout(migrated);
          } else {
            setLayout(preferences);
          }
        } else {
          setLayout(DEFAULT_LAYOUT);
        }
      } catch {
        setLayout(DEFAULT_LAYOUT);
      } finally {
        setLoading(false);
      }
    };

    fetchPreferences();
  }, [enabled]);

  const updateLayout = useCallback(
    (newLayout: DashboardLayout) => {
      setLayout(newLayout);

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
