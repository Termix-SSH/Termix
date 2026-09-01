import { authApi, handleApiError } from "@/main-axios";
import {
  sanitizeHostSidebarPreferences,
  type HostSidebarPreferences,
} from "@/types/host-sidebar-preferences";

// HOST SIDEBAR PREFERENCES API
// ============================================================================

export async function getHostSidebarPreferences(): Promise<HostSidebarPreferences> {
  try {
    const response = await authApi.get("/host-sidebar/preferences");
    return sanitizeHostSidebarPreferences(response.data?.preferences);
  } catch (error) {
    handleApiError(error, "fetch host sidebar preferences");
    throw error;
  }
}

export async function saveHostSidebarPreferences(
  preferences: HostSidebarPreferences,
): Promise<void> {
  try {
    await authApi.put("/host-sidebar/preferences", preferences);
  } catch (error) {
    handleApiError(error, "save host sidebar preferences");
    throw error;
  }
}
