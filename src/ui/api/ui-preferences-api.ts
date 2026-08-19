import { authApi, handleApiError } from "@/main-axios";
import {
  sanitizeUiPreferences,
  type UiPreferences,
} from "@/types/ui-preferences";

// UI PREFERENCES API
// ============================================================================

export async function getUiPreferences(): Promise<UiPreferences> {
  try {
    const response = await authApi.get("/ui-preferences");
    return sanitizeUiPreferences(response.data?.preferences);
  } catch (error) {
    handleApiError(error, "fetch UI preferences");
    throw error;
  }
}

/**
 * Sends a partial document. The backend merges overrides two levels deep, so
 * only changed keys need to be sent; a null clears an override and hands the
 * knob back to the preset.
 */
export async function saveUiPreferences(
  preferences: Partial<UiPreferences> & Record<string, unknown>,
): Promise<void> {
  try {
    await authApi.put("/ui-preferences", preferences);
  } catch (error) {
    handleApiError(error, "save UI preferences");
    throw error;
  }
}
