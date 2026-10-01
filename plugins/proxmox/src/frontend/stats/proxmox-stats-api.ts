import type { PluginApiClient } from "@termix/plugin-sdk/frontend";
import type { ProxmoxStatsSnapshot } from "../types";

/**
 * The Proxmox node-stats routes, through the plugin's own client. Paths are
 * relative to /plugin-api/proxmox/, which the client already points at.
 */
export function createProxmoxStatsApi(api: PluginApiClient) {
  return {
    async getStats(hostId: number): Promise<ProxmoxStatsSnapshot | null> {
      try {
        const response = await api.get<ProxmoxStatsSnapshot>(
          `/stats/${hostId}`,
        );
        return response.data;
      } catch (error) {
        if (
          typeof error === "object" &&
          error &&
          "response" in error &&
          (error as { response?: { status?: number } }).response?.status === 404
        ) {
          return null;
        }
        throw error;
      }
    },

    async startPolling(hostId: number): Promise<{
      success: boolean;
      viewerSessionId?: string;
      status?: string;
      error?: string;
    }> {
      const response = await api.post<{
        success: boolean;
        viewerSessionId?: string;
        status?: string;
        error?: string;
      }>(`/stats/start/${hostId}`);
      return response.data;
    },

    async stopPolling(hostId: number, viewerSessionId?: string): Promise<void> {
      await api.post(`/stats/stop/${hostId}`, { viewerSessionId });
    },

    async sendHeartbeat(viewerSessionId: string): Promise<void> {
      await api.post("/stats/heartbeat", { viewerSessionId });
    },

    async getHistory(
      hostId: number,
      opts: { range?: string; from?: string; to?: string },
    ): Promise<ProxmoxStatsHistoryResponse> {
      const response = await api.get<ProxmoxStatsHistoryResponse>(
        `/stats/history/${hostId}`,
        { params: opts },
      );
      return response.data;
    },
  };
}

export type ProxmoxStatsApi = ReturnType<typeof createProxmoxStatsApi>;

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
