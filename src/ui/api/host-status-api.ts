import axios, { type AxiosRequestConfig } from "axios";
import {
  handleApiError,
  getRemoteCoreApi,
  isElectron,
  sshHostApi,
} from "@/main-axios";
import type { ServerStatus } from "@/main-axios";
import { getCachedServerStatuses } from "@/lib/hosts-request-cache";
import { resolveConnectionOrigin } from "@/lib/connection-origin";
import type { SSHHost } from "@/types/index";

// Core's host status checks (/host/status). On the desktop app the aggregate
// read is merged across the local backend and the connected remote server.
async function isRemoteSyncConnected(): Promise<boolean> {
  if (!isElectron()) return false;
  try {
    const config = (await window.electronAPI?.invoke?.(
      "get-remote-sync-config",
    )) as { serverUrl?: string } | null;
    return !!config?.serverUrl;
  } catch {
    return false;
  }
}

// HOST STATUS
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
  return getCachedServerStatuses(async () => {
    let lastError: unknown = null;
    let localStatuses: Record<number, ServerStatus> = {};
    let localHostIds: number[] | null = null;

    if (isElectron()) {
      try {
        const response = await sshHostApi.get<SSHHost[]>("/db/host");
        const defaultOrigin = await resolveConnectionOrigin({
          connectionOrigin: null,
        });
        localHostIds = (response.data || [])
          .filter(
            (host) => (host.connectionOrigin ?? defaultOrigin) === "local",
          )
          .map((host) => host.id);
      } catch {
        // A host-list failure must not start local probes for hosts whose
        // configured origin may be remote.
        localHostIds = [];
      }
    }

    for (let i = 0; i < STATUS_RETRY_SCHEDULE.length; i++) {
      const { timeoutMs, pauseAfterMs } = STATUS_RETRY_SCHEDULE[i];
      const isFinalAttempt = i === STATUS_RETRY_SCHEDULE.length - 1;

      try {
        const response = await sshHostApi.get("/status", {
          timeout: timeoutMs,
          ...(localHostIds === null
            ? {}
            : { params: { hostIds: localHostIds.join(",") } }),
          // Silence per-attempt interceptor logging & health-monitor side
          // effects on all attempts except the final one, so background
          // blips don't look like real outages.
          __silentRetry: !isFinalAttempt,
        } as AxiosRequestConfig & { __silentRetry?: boolean });
        localStatuses = response.data || {};
        lastError = null;
        break;
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

    if (lastError) {
      handleApiError(lastError, "fetch server statuses");
      return {};
    }

    if (await isRemoteSyncConnected()) {
      try {
        const remoteResult = await getRemoteCoreApi().get("/host/status", {
          timeout: 8000,
          __silentRetry: true,
        } as AxiosRequestConfig & { __silentRetry?: boolean });
        return { ...localStatuses, ...(remoteResult.data || {}) };
      } catch {
        // remote unreachable this tick -- fall back to local-only statuses
      }
    }

    return localStatuses;
  });
}

export async function getServerStatusById(id: number): Promise<ServerStatus> {
  try {
    const response = await sshHostApi.get(`/status/${id}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch server status");
    throw error;
  }
}

export async function refreshServerPolling(): Promise<void> {
  try {
    await sshHostApi.post("/status/refresh");
  } catch (error) {
    console.warn("Failed to refresh status checks:", error);
  }
}

export async function getStatusCheckSettings(): Promise<{
  statusCheckInterval: number;
}> {
  try {
    const response = await sshHostApi.get("/status/settings");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch status check settings");
  }
}

export async function updateStatusCheckSettings(settings: {
  statusCheckInterval: number;
}): Promise<void> {
  try {
    await sshHostApi.put("/status/settings", settings);
  } catch (error) {
    handleApiError(error, "update status check settings");
  }
}

// ============================================================================
