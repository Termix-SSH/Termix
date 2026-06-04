import { AxiosError } from "axios";
import {
  authApi,
  handleApiError,
  isElectron,
  markUserAuthenticated,
} from "@/main-axios";
import type { AuthResponse } from "@/main-axios";

// ALERTS
// ============================================================================

export async function setupTOTP(): Promise<{
  secret: string;
  qr_code: string;
}> {
  try {
    const response = await authApi.post("/users/totp/setup");
    return response.data;
  } catch (error) {
    handleApiError(error as AxiosError, "setup TOTP");
    throw error;
  }
}

export async function enableTOTP(
  totp_code: string,
): Promise<{ message: string; backup_codes: string[] }> {
  try {
    const response = await authApi.post("/users/totp/enable", { totp_code });
    return response.data;
  } catch (error) {
    handleApiError(error as AxiosError, "enable TOTP");
    throw error;
  }
}

export async function disableTOTP(
  password?: string,
  totp_code?: string,
): Promise<{ message: string }> {
  try {
    const response = await authApi.post("/users/totp/disable", {
      password,
      totp_code,
    });
    return response.data;
  } catch (error) {
    handleApiError(error as AxiosError, "disable TOTP");
    throw error;
  }
}

export async function verifyTOTPLogin(
  temp_token: string,
  totp_code: string,
  rememberMe: boolean = false,
): Promise<AuthResponse> {
  try {
    const response = await authApi.post("/users/totp/verify-login", {
      temp_token,
      totp_code,
      rememberMe,
    });

    const isInIframe =
      typeof window !== "undefined" && window.self !== window.top;

    if (isInIframe && isElectron() && response.data.success) {
      try {
        window.parent.postMessage(
          {
            type: "AUTH_SUCCESS",
            source: "totp_verify",
            platform: "desktop",
            timestamp: Date.now(),
          },
          window.location.origin,
        );
      } catch (e) {
        console.error("[main-axios] Error posting message to parent:", e);
      }
    }

    if (response.data.success) {
      markUserAuthenticated();
    }

    return response.data;
  } catch (error) {
    handleApiError(error as AxiosError, "verify TOTP login");
    throw error;
  }
}

export async function generateBackupCodes(
  password?: string,
  totp_code?: string,
): Promise<{ backup_codes: string[] }> {
  try {
    const response = await authApi.post("/users/totp/backup-codes", {
      password,
      totp_code,
    });
    return response.data;
  } catch (error) {
    handleApiError(error as AxiosError, "generate backup codes");
    throw error;
  }
}

export async function getUserAlerts(): Promise<{
  alerts: Array<Record<string, unknown>>;
}> {
  try {
    const response = await authApi.get(`/alerts`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch user alerts");
    throw error;
  }
}

export async function dismissAlert(
  alertId: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.post("/alerts/dismiss", { alertId });
    return response.data;
  } catch (error) {
    handleApiError(error, "dismiss alert");
    throw error;
  }
}

// ============================================================================
// UPDATES & RELEASES
// ============================================================================

export async function getReleasesRSS(
  perPage: number = 100,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get(`/releases/rss?per_page=${perPage}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch releases RSS");
  }
}

export async function getVersionInfo(
  checkRemote = true,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get(
      `/version${checkRemote ? "" : "?checkRemote=false"}`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch version info");
  }
}

// ============================================================================
// DATABASE HEALTH
// ============================================================================

export async function getDatabaseHealth(): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.get("/health");
    return response.data;
  } catch (error) {
    handleApiError(error, "check database health");
  }
}

// ============================================================================
