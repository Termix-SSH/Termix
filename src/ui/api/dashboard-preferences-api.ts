import { dashboardApi } from "@/main-axios";

export interface DashboardLayout {
  cards: Array<{
    id: string;
    enabled: boolean;
    order: number;
    panel?: "main" | "side";
    height?: number | null;
  }>;
  mainWidthPct?: number;
}

export async function getDashboardPreferences(): Promise<DashboardLayout> {
  const response = await dashboardApi.get("/dashboard/preferences");
  return response.data;
}

export async function saveDashboardPreferences(
  layout: DashboardLayout,
): Promise<{ success: boolean }> {
  const response = await dashboardApi.post("/dashboard/preferences", layout);
  return response.data;
}

// ============================================================================
