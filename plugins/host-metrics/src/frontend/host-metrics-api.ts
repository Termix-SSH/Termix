import { useMemo } from "react";
import {
  usePluginApi,
  type PluginApiClient,
} from "@termix/plugin-sdk/frontend";
import type { HostMetricsLayout } from "../shared/host-metrics.js";
import type { ServerMetrics } from "../shared/metrics.js";

// Every call is keyed by a host's numeric database id, and the receiving
// backend must own that host in its own database: a synced host has a
// different numeric id on each side. They always target this backend.

export interface MetricsHistoryRow {
  ts: string;
  cpu_percent: number | null;
  mem_percent: number | null;
  disk_percent: number | null;
  net_rx_bytes: number | null;
  net_tx_bytes: number | null;
}

export interface MetricsHistoryResponse {
  rows: MetricsHistoryRow[];
  fromTs: string;
  toTs: string;
}

export interface PlatformInfo {
  hasSystemd: boolean;
  pkg: "apt" | "dnf" | "yum" | "pacman" | null;
  hasCertbot: boolean;
  hasAcmeSh: boolean;
  hasDocker: boolean;
  osPrettyName: string | null;
}

export interface ConnectionLogEntry {
  type: "info" | "success" | "warning" | "error";
  stage: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface StartMetricsResult {
  success: boolean;
  requires_totp?: boolean;
  sessionId?: string;
  prompt?: string;
  viewerSessionId?: string;
  connectionLogs?: ConnectionLogEntry[];
}

function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}

function bodyOf(error: unknown): Record<string, unknown> | undefined {
  return (error as { response?: { data?: Record<string, unknown> } })?.response
    ?.data;
}

/** The plugin's routes, relative to /plugin-api/host-metrics/. */
export function createHostMetricsApi(api: PluginApiClient) {
  return {
    async getMetrics(hostId: number): Promise<ServerMetrics | null> {
      try {
        return (await api.get<ServerMetrics>(`/metrics/${hostId}`)).data;
      } catch (error) {
        // No sample yet, or metrics are off for the host.
        if (statusOf(error) === 404) return null;
        throw error;
      }
    },

    /** Throws an Error carrying the server's connectionLogs on failure. */
    async startMetrics(hostId: number): Promise<StartMetricsResult> {
      try {
        return (await api.post<StartMetricsResult>(`/metrics/start/${hostId}`))
          .data;
      } catch (error) {
        const body = bodyOf(error);
        if (body?.connectionLogs) {
          const wrapped = new Error(
            String(body.error || body.message || "Failed to start metrics"),
          );
          Object.assign(wrapped, { connectionLogs: body.connectionLogs });
          throw wrapped;
        }
        throw error;
      }
    },

    async stopMetrics(hostId: number, viewerSessionId?: string) {
      await api.post(`/metrics/stop/${hostId}`, { viewerSessionId });
    },

    async submitTotp(
      sessionId: string,
      totpCode: string,
    ): Promise<{ success: boolean; viewerSessionId?: string }> {
      return (
        await api.post<{ success: boolean; viewerSessionId?: string }>(
          "/metrics/connect-totp",
          { sessionId, totpCode },
        )
      ).data;
    },

    /** False when the server no longer knows the viewer. */
    async heartbeat(viewerSessionId: string): Promise<boolean> {
      try {
        await api.post("/metrics/heartbeat", { viewerSessionId });
        return true;
      } catch (error) {
        if (statusOf(error) === 404) return false;
        throw error;
      }
    },

    async registerViewer(hostId: number): Promise<{
      success: boolean;
      viewerSessionId?: string;
      skipped?: boolean;
      reason?: string;
    }> {
      return (await api.post("/metrics/register-viewer", { hostId })).data as {
        success: boolean;
        viewerSessionId?: string;
        skipped?: boolean;
        reason?: string;
      };
    },

    async unregisterViewer(hostId: number, viewerSessionId: string) {
      await api.post("/metrics/unregister-viewer", {
        hostId,
        viewerSessionId,
      });
    },

    async getMetricsHistory(
      hostId: number,
      opts: { range?: string; from?: string; to?: string },
    ): Promise<MetricsHistoryResponse> {
      return (
        await api.get<MetricsHistoryResponse>(`/metrics/history/${hostId}`, {
          params: opts,
        })
      ).data;
    },

    async getHostMetricsLayout(
      hostId: number,
    ): Promise<HostMetricsLayout | null> {
      try {
        const res = await api.get<{ layout?: HostMetricsLayout }>(
          `/host-metrics/preferences/${hostId}`,
        );
        return res.data?.layout ?? null;
      } catch (error) {
        if (statusOf(error) === 404) return null;
        throw error;
      }
    },

    async saveHostMetricsLayout(hostId: number, layout: HostMetricsLayout) {
      await api.post(`/host-metrics/preferences/${hostId}`, layout);
    },

    async getHostPlatform(hostId: number): Promise<PlatformInfo> {
      return (await api.get<PlatformInfo>(`/host-metrics/platform/${hostId}`))
        .data;
    },

    /** GET a manager resource (read). */
    async managerGet<T>(
      hostId: number,
      resource: string,
      params?: Record<string, string | number>,
    ): Promise<T> {
      return (
        await api.get<T>(`/host-metrics/managers/${resource}/${hostId}`, {
          params,
        })
      ).data;
    },

    /** GET where the host id sits mid-path: /managers/logs/{id}/files. */
    async managerGetSub<T>(
      hostId: number,
      resource: string,
      sub: string,
      params?: Record<string, string | number>,
    ): Promise<T> {
      return (
        await api.get<T>(
          `/host-metrics/managers/${resource}/${hostId}/${sub}`,
          { params },
        )
      ).data;
    },

    /** POST a manager action: /managers/{resource}/{id}[/{action}]. */
    async managerPost<T>(
      hostId: number,
      resource: string,
      body: unknown,
      action?: string,
    ): Promise<T> {
      const suffix = action ? `/${action}` : "";
      return (
        await api.post<T>(
          `/host-metrics/managers/${resource}/${hostId}${suffix}`,
          body,
        )
      ).data;
    },
  };
}

export type HostMetricsApi = ReturnType<typeof createHostMetricsApi>;

export function useHostMetricsApi(): HostMetricsApi {
  const api = usePluginApi();
  return useMemo(() => createHostMetricsApi(api), [api]);
}
