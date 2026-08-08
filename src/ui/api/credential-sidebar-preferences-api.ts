import { authApi, handleApiError } from "@/main-axios";
import {
  sanitizeCredentialSidebarPreferences,
  type CredentialSidebarPreferences,
} from "@/types/credential-sidebar-preferences";

// CREDENTIAL SIDEBAR PREFERENCES API
// ============================================================================

export async function getCredentialSidebarPreferences(): Promise<CredentialSidebarPreferences> {
  try {
    const response = await authApi.get("/credential-sidebar/preferences");
    return sanitizeCredentialSidebarPreferences(response.data?.preferences);
  } catch (error) {
    handleApiError(error, "fetch credential sidebar preferences");
    throw error;
  }
}

export async function saveCredentialSidebarPreferences(
  preferences: CredentialSidebarPreferences,
): Promise<void> {
  try {
    await authApi.put("/credential-sidebar/preferences", preferences);
  } catch (error) {
    handleApiError(error, "save credential sidebar preferences");
    throw error;
  }
}
