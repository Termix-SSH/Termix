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
