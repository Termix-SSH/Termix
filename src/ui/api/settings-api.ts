import axios from "axios";
import { authApi, handleApiError, statsApi } from "@/main-axios";

// GLOBAL MONITORING SETTINGS
// ============================================================================

export async function getGlobalMonitoringSettings(): Promise<{
  statusCheckInterval: number;
  metricsInterval: number;
}> {
  try {
    const response = await statsApi.get("/global-settings");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch global monitoring settings");
  }
}

export async function updateGlobalMonitoringSettings(settings: {
  statusCheckInterval?: number;
  metricsInterval?: number;
}): Promise<void> {
  try {
    await statsApi.post("/global-settings", settings);
  } catch (error) {
    handleApiError(error, "update global monitoring settings");
  }
}

// ============================================================================
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

// How long a detached terminal session is kept alive server-side.
export async function getTerminalSessionSettings(): Promise<{
  timeoutMinutes: number;
  enabled: boolean;
}> {
  try {
    const response = await authApi.get("/terminal/session_settings");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch terminal session settings");
  }
}

export async function updateTerminalSessionSettings(input: {
  timeoutMinutes?: number;
  enabled?: boolean;
}): Promise<void> {
  try {
    await authApi.patch("/terminal/session_settings", input);
  } catch (error) {
    handleApiError(error, "update terminal session settings");
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

// ============================================================================
// TAILSCALE SETTINGS
// ============================================================================

export async function getTailscaleSettings(): Promise<{
  apiKey: string;
  hasApiKey: boolean;
  apiBaseUrl: string;
}> {
  try {
    const response = await authApi.get("/users/tailscale-settings");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch Tailscale settings");
  }
}

export async function updateTailscaleSettings(
  apiKey: string,
  apiBaseUrl?: string,
): Promise<{ hasApiKey: boolean }> {
  try {
    const response = await authApi.patch("/users/tailscale-settings", {
      apiKey,
      apiBaseUrl,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update Tailscale settings");
  }
}

export async function getTailscaleDevices(): Promise<{
  devices: Array<{
    id: string;
    name: string;
    hostname: string;
    addresses: string[];
    os: string;
    lastSeen: string;
  }>;
  hasApiKey: boolean;
  error?: string;
}> {
  try {
    const response = await authApi.get("/tailscale/devices");
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data;
      if (
        data &&
        typeof data === "object" &&
        "hasApiKey" in data &&
        typeof data.hasApiKey === "boolean"
      ) {
        return data as {
          devices: [];
          hasApiKey: boolean;
          error?: string;
        };
      }
    }
    handleApiError(error, "fetch Tailscale devices");
    throw error;
  }
}

// ============================================================================
// GUACAMOLE SETTINGS
// ============================================================================

export async function getGuacamoleSettings(): Promise<{
  enabled: boolean;
  url: string;
}> {
  try {
    const response = await authApi.get("/users/guacamole-settings");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch guacamole settings");
  }
}

export async function updateGuacamoleSettings(settings: {
  enabled?: boolean;
  url?: string;
}): Promise<void> {
  try {
    await authApi.patch("/users/guacamole-settings", settings);
  } catch (error) {
    handleApiError(error, "update guacamole settings");
  }
}

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

export type TerminalImageStorageMode = "auto" | "local" | "remote-sftp";

/** Public settings shape: the backend-internal localDir is never returned. */
export interface TerminalImageStorageSettings {
  mode: TerminalImageStorageMode;
  hostPath: string;
  ttlMs: number;
  maxCount: number;
  maxBytes: number;
  localMappingConfigured: boolean;
}

export interface TerminalImageStorageSettingsUpdate {
  mode?: TerminalImageStorageMode;
  localDir?: string;
  hostPath?: string;
  ttlMs?: number;
  maxCount?: number;
  maxBytes?: number;
}

export interface TerminalImageStorageTestResult {
  mode: TerminalImageStorageMode;
  connected: boolean;
  remoteSftpAvailable: boolean;
  localHostVisible: boolean | null;
  selectedMode: "local" | "remote-sftp" | "unavailable";
  localMappingConfigured: boolean;
}

export async function getTerminalImageStorageSettings(): Promise<TerminalImageStorageSettings> {
  try {
    const response = await authApi.get(
      "/users/terminal-image-storage-settings",
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch terminal image storage settings");
  }
}

export async function updateTerminalImageStorageSettings(
  settings: TerminalImageStorageSettingsUpdate,
): Promise<TerminalImageStorageSettings> {
  try {
    const response = await authApi.patch(
      "/users/terminal-image-storage-settings",
      settings,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "update terminal image storage settings");
  }
}

export async function testTerminalImageStorage(
  instanceId: string,
): Promise<TerminalImageStorageTestResult> {
  try {
    const response = await authApi.post(
      "/users/terminal-image-storage-settings/test",
      { instanceId },
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "test terminal image storage");
  }
}

// ============================================================================
// WHITE LABEL BRANDING
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
  metricsEnabled?: boolean;
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
