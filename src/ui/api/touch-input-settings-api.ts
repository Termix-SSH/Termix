import { authApi, handleApiError } from "@/main-axios";
import type { TouchInputSettings } from "@/types/touch-input-settings";
import { normalizeTouchInputSettings } from "@/types/touch-input-settings";

export async function getTouchInputSettings(): Promise<TouchInputSettings> {
  try {
    const response = await authApi.get("/users/touch-input-settings");
    return normalizeTouchInputSettings(response.data);
  } catch (error) {
    handleApiError(error, "fetch touch input settings");
  }
}

export async function updateTouchInputSettings(
  settings: TouchInputSettings,
): Promise<TouchInputSettings> {
  try {
    const response = await authApi.patch(
      "/users/touch-input-settings",
      settings,
    );
    return normalizeTouchInputSettings(response.data);
  } catch (error) {
    handleApiError(error, "update touch input settings");
  }
}
