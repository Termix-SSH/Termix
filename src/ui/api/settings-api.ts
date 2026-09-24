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

export interface StepCaSettings {
  configured: boolean;
  caUrl: string;
  fingerprint: string;
  provisioner: string;
}

export async function getStepCaSettings(): Promise<StepCaSettings> {
  try {
    const response = await authApi.get("/users/step-ca-settings");
    return {
      configured: !!response.data.configured,
      caUrl: response.data.caUrl ?? "",
      fingerprint: response.data.fingerprint ?? "",
      provisioner: response.data.provisioner ?? "",
    };
  } catch (error) {
    handleApiError(error, "fetch Step CA settings");
  }
}

export async function updateStepCaSettings(input: {
  caUrl: string;
  fingerprint: string;
  provisioner: string;
}): Promise<void> {
  try {
    await authApi.patch("/users/step-ca-settings", input);
  } catch (error) {
    handleApiError(error, "update Step CA settings");
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
// ANALYTICS SETTINGS
// ============================================================================

export async function getAnalyticsEnabled(): Promise<{
  enabled: boolean;
  locked?: boolean;
}> {
  try {
    const response = await authApi.get("/users/analytics-enabled");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch analytics enabled setting");
  }
}

export async function updateAnalyticsEnabled(
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  try {
    const response = await authApi.patch("/users/analytics-enabled", {
      enabled,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update analytics enabled setting");
  }
}

// ============================================================================
// TERMINAL IMAGE STORAGE SETTINGS
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

// ============================================================================
// HOST DEFAULTS SETTINGS
// ============================================================================

export type HostDefaults = {
  useSocks5?: boolean;
  socks5Host?: string;
  socks5Port?: number;
  socks5Username?: string;
  socks5Password?: string;
  credentialId?: number | null;
  statusCheckEnabled?: boolean;
  fontSize?: number;
  fontFamily?: string;
  theme?: string;
  cursorStyle?: string;
  cursorBlink?: boolean;
  enableSessionLogging?: boolean;
  enableCommandHistory?: boolean;
  autoTmux?: boolean;
};

export async function getHostDefaults(): Promise<HostDefaults> {
  try {
    const response = await authApi.get("/users/host-defaults");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch host defaults");
  }
}

export async function updateHostDefaults(
  defaults: HostDefaults,
): Promise<HostDefaults> {
  try {
    const response = await authApi.patch("/users/host-defaults", defaults);
    return response.data;
  } catch (error) {
    handleApiError(error, "update host defaults");
  }
}
