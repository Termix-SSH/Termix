import { useState, useEffect, useCallback } from "react";
import {
  getDashboardPreferences,
  saveDashboardPreferences,
  type DashboardLayout,
} from "@/ui/main-axios";

const DEFAULT_LAYOUT: DashboardLayout = {
  cards: [
    { id: "server_overview", enabled: true, order: 1 },
    { id: "recent_activity", enabled: true, order: 2 },
    { id: "network_graph", enabled: false, order: 3 },
    { id: "quick_actions", enabled: true, order: 4 },
    { id: "server_stats", enabled: true, order: 5 },
  ],
  gridColumns: 2,
};

export function useDashboardPreferences() {
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const preferences = await getDashboardPreferences();
        setLayout(preferences);
      } catch (error) {
        console.error("Failed to load dashboard preferences:", error);
        setLayout(DEFAULT_LAYOUT);
      } finally {
        setLoading(false);
      }
    };

    fetchPreferences();
  }, []);

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
