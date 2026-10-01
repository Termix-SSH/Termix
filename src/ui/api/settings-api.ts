import { authApi, handleApiError } from "@/main-axios";

// LOG LEVEL SETTINGS
// ============================================================================

export async function getLogLevel(): Promise<{ level: string }> {
  try {
    const response = await authApi.get("/users/log-level");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch log level");
  }
}

export async function updateLogLevel(level: string): Promise<void> {
  try {
    await authApi.patch("/users/log-level", { level });
  } catch (error) {
    handleApiError(error, "update log level");
  }
}

// ============================================================================
// SESSION TIMEOUT SETTINGS
// ============================================================================

export async function getSessionTimeout(): Promise<{ timeoutHours: number }> {
  try {
    const response = await authApi.get("/users/session-timeout");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch session timeout");
  }
}

export async function updateSessionTimeout(
  timeoutHours: number,
): Promise<void> {
  try {
    await authApi.patch("/users/session-timeout", { timeoutHours });
  } catch (error) {
    handleApiError(error, "update session timeout");
  }
}

// Tailscale settings/device API wrappers moved to
// plugins/tailscale/src/frontend/tailscale-api.ts.

// ============================================================================
// BRANDING SETTINGS
// ============================================================================

export interface BrandingSettings {
  appName: string;
  tagline: string;
  /** PNG data URL, or null when no custom logo is configured. */
  logo: string | null;
}

export interface BrandingSettingsUpdate {
  appName?: string;
  tagline?: string;
  logo?: string | null;
}

/** Public endpoint -- no auth required, so the login screen can read it. */
export async function getBranding(): Promise<BrandingSettings> {
  try {
    const response = await authApi.get("/users/branding");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch branding settings");
  }
}

export async function updateBranding(
  update: BrandingSettingsUpdate,
): Promise<BrandingSettings> {
  try {
    const response = await authApi.patch("/users/branding", update);
    return response.data;
  } catch (error) {
    handleApiError(error, "update branding settings");
  }
}
