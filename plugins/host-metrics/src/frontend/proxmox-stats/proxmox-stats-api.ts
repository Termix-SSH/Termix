import axios from "axios";
import { handleApiError, statsApi } from "@/main-axios";
import type { ProxmoxStatsSnapshot } from "@/types/proxmox";

// Every function below is keyed by a host's numeric database id, and the
// receiving backend must own that host in its own database -- same caveat as
// host-metrics-api.ts / host-metrics-status-api.ts. All routes live under the
// `/proxmox-stats/*` prefix on the stats app (port 30005).

export async function getProxmoxStats(
  hostId: number,
): Promise<ProxmoxStatsSnapshot | null> {
  try {
    const response = await statsApi.get(`/proxmox-stats/${hostId}`, {
      // Treat 404 as an expected "no stats yet / disabled" signal rather than
      // an error so we don't spam warn logs on the client.
      validateStatus: (status) => status === 200 || status === 404,
    });
    if (response.status === 404) {
      return null;
    }
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    handleApiError(error, "fetch proxmox stats");
    throw error;
  }
}

export async function startProxmoxStatsPolling(hostId: number): Promise<{
  success: boolean;
  viewerSessionId?: string;
  status?: string;
  error?: string;
}> {
  try {
    const response = await statsApi.post(`/proxmox-stats/start/${hostId}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "start proxmox stats polling");
    throw error;
  }
}

export async function stopProxmoxStatsPolling(
  hostId: number,
  viewerSessionId?: string,
): Promise<void> {
  try {
    await statsApi.post(`/proxmox-stats/stop/${hostId}`, { viewerSessionId });
  } catch (error) {
    handleApiError(error, "stop proxmox stats polling");
    throw error;
  }
}

export async function sendProxmoxStatsHeartbeat(
  viewerSessionId: string,
): Promise<void> {
  try {
    await statsApi.post("/proxmox-stats/heartbeat", { viewerSessionId });
  } catch (error) {
    handleApiError(error, "send proxmox stats heartbeat");
    throw error;
  }
}

export interface ProxmoxStatsHistoryRow {
  ts: string;
  cpu_percent: number | null;
  mem_percent: number | null;
  disk_percent: number | null;
  net_rx_bytes: number | null;
  net_tx_bytes: number | null;
}

export interface ProxmoxStatsHistoryResponse {
  rows: ProxmoxStatsHistoryRow[];
  fromTs: string;
  toTs: string;
}

export async function getProxmoxStatsHistory(
  hostId: number,
  opts: { range?: string; from?: string; to?: string },
): Promise<ProxmoxStatsHistoryResponse> {
  const res = await statsApi.get(`/proxmox-stats/history/${hostId}`, {
    params: opts,
  });
  return res.data as ProxmoxStatsHistoryResponse;
}
