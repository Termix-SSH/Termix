import axios, { type AxiosRequestConfig } from "axios";
import { handleApiError, statsApi } from "@/main-axios";
import type { ServerMetrics, ServerStatus } from "@/main-axios";

type ApiConnectionLog = {
  type: "info" | "success" | "warning" | "error";
  stage: string;
  message: string;
  details?: Record<string, unknown>;
};

type ConnectErrorResponse = {
  error?: string;
  message?: string;
  connectionLogs?: ApiConnectionLog[];
  requires_totp?: boolean;
  requires_warpgate?: boolean;
  sessionId?: string;
  prompt?: string;
  url?: string;
  securityKey?: string;
  status?: string;
  reason?: string;
};

// SERVER STATISTICS
// ============================================================================

/**
 * Progressive retry schedule for the background /status poll.
 *
 * Each entry describes one attempt's per-request timeout and the pause to
 * observe before the next attempt. The pause on the last entry is `null`:
 * after that final failure we surface the network error, which flows
 * through the response interceptor + dbHealthMonitor (which decides
 * between the degraded toast and the full-outage overlay based on whether
 * any WebSocket is still alive).
 *
 * Sequence: try(2s) -> wait 3s -> try(5s) -> wait 5s -> try(8s) -> fail.
 * Worst-case wall-clock = 23s, which fits inside the 30s ServerStatusContext
 * poll cadence, so the next tick acts as the next retry without overlap.
 */
const STATUS_RETRY_SCHEDULE: ReadonlyArray<{
  timeoutMs: number;
  pauseAfterMs: number | null;
}> = [
  { timeoutMs: 2000, pauseAfterMs: 3000 },
  { timeoutMs: 5000, pauseAfterMs: 5000 },
  { timeoutMs: 8000, pauseAfterMs: null },
];

function isTransientStatusError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (error.response) {
    // Definitive server response (even 5xx) is not something more retries
    // will fix in a useful timeframe; bail out and report it normally.
    return false;
  }
  const code = error.code;
  if (!code) {
    // No code + no response means classic network error (offline / DNS / TCP)
    return true;
  }
  return (
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "ERR_NETWORK" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET"
  );
}

export async function getAllServerStatuses(): Promise<
  Record<number, ServerStatus>
> {
  let lastError: unknown = null;

  for (let i = 0; i < STATUS_RETRY_SCHEDULE.length; i++) {
    const { timeoutMs, pauseAfterMs } = STATUS_RETRY_SCHEDULE[i];
    const isFinalAttempt = i === STATUS_RETRY_SCHEDULE.length - 1;

    try {
      const response = await statsApi.get("/status", {
        timeout: timeoutMs,
        // Silence per-attempt interceptor logging & health-monitor side
        // effects on all attempts except the final one, so background
        // blips don't look like real outages.
        __silentRetry: !isFinalAttempt,
      } as AxiosRequestConfig & { __silentRetry?: boolean });
      return response.data || {};
    } catch (error) {
      lastError = error;
      if (!isTransientStatusError(error)) {
        break;
      }
      if (pauseAfterMs === null) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, pauseAfterMs));
    }
  }

  handleApiError(lastError, "fetch server statuses");
}

export async function getServerStatusById(id: number): Promise<ServerStatus> {
  try {
    const response = await statsApi.get(`/status/${id}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch server status");
    throw error;
  }
}

export async function getServerMetricsById(
  id: number,
): Promise<ServerMetrics | null> {
  try {
    const response = await statsApi.get(`/metrics/${id}`, {
      // Treat 404 as an expected "no metrics yet / disabled" signal rather
      // than an error so we don't spam warn logs on the client.
      validateStatus: (status) => status === 200 || status === 404,
    });
    if (response.status === 404) {
      return null;
    }
    return response.data;
  } catch (error) {
    // If a 404 still slips through (e.g. intercepted before reaching here),
    // swallow it quietly; everything else still flows through handleApiError.
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    handleApiError(error, "fetch server metrics");
    throw error;
  }
}

export async function startMetricsPolling(hostId: number): Promise<{
  success: boolean;
  requires_totp?: boolean;
  sessionId?: string;
  prompt?: string;
  viewerSessionId?: string;
  connectionLogs?: ApiConnectionLog[];
}> {
  try {
    const response = await statsApi.post(`/metrics/start/${hostId}`);
    return response.data;
  } catch (error: unknown) {
    if (
      axios.isAxiosError<ConnectErrorResponse>(error) &&
      error.response?.data?.connectionLogs
    ) {
      const data = error.response.data;
      const errorWithLogs = new Error(
        data.error || data.message || error.message,
      );
      Object.assign(errorWithLogs, {
        connectionLogs: data.connectionLogs,
      });
      throw errorWithLogs;
    }
    handleApiError(error, "start metrics polling");
    throw error;
  }
}

export async function stopMetricsPolling(
  hostId: number,
  viewerSessionId?: string,
): Promise<void> {
  try {
    await statsApi.post(`/metrics/stop/${hostId}`, { viewerSessionId });
  } catch (error) {
    handleApiError(error, "stop metrics polling");
    throw error;
  }
}

export async function sendMetricsHeartbeat(
  viewerSessionId: string,
): Promise<void> {
  try {
    await statsApi.post("/metrics/heartbeat", { viewerSessionId });
  } catch (error) {
    handleApiError(error, "send metrics heartbeat");
    throw error;
  }
}

export async function registerMetricsViewer(hostId: number): Promise<{
  success: boolean;
  viewerSessionId?: string;
  skipped?: boolean;
  reason?: string;
}> {
  try {
    const response = await statsApi.post("/metrics/register-viewer", {
      hostId,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "register metrics viewer");
    throw error;
  }
}

export async function unregisterMetricsViewer(
  hostId: number,
  viewerSessionId: string,
): Promise<void> {
  try {
    await statsApi.post("/metrics/unregister-viewer", {
      hostId,
      viewerSessionId,
    });
  } catch (error) {
    handleApiError(error, "unregister metrics viewer");
    throw error;
  }
}

export async function submitMetricsTOTP(
  sessionId: string,
  totpCode: string,
): Promise<{
  success: boolean;
  viewerSessionId?: string;
}> {
  try {
    const response = await statsApi.post("/metrics/connect-totp", {
      sessionId,
      totpCode,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "submit metrics TOTP");
    throw error;
  }
}

export async function refreshServerPolling(): Promise<void> {
  try {
    await statsApi.post("/refresh");
  } catch (error) {
    console.warn("Failed to refresh server polling:", error);
  }
}

export async function notifyHostCreatedOrUpdated(
  hostId: number,
): Promise<void> {
  try {
    await statsApi.post("/host-updated", { hostId });
  } catch (error) {
    console.warn("Failed to notify stats server of host update:", error);
  }
}

// ============================================================================
