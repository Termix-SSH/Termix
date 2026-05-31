import axios from "axios";
import { authApi, handleApiError, tunnelApi } from "@/main-axios";
import type {
  C2STunnelPreset,
  TunnelConfig,
  TunnelConnection,
  TunnelStatus,
} from "@/types/index";

// TUNNEL MANAGEMENT
// ============================================================================

export async function getTunnelStatuses(): Promise<
  Record<string, TunnelStatus>
> {
  try {
    const response = await tunnelApi.get("/tunnel/status");
    return response.data || {};
  } catch (error) {
    handleApiError(error, "fetch tunnel statuses");
  }
}

export function subscribeTunnelStatuses(
  onStatuses: (statuses: Record<string, TunnelStatus>) => void,
  onError?: () => void,
): () => void {
  const baseURL = (tunnelApi.defaults.baseURL || "").replace(/\/$/, "");
  const source = new EventSource(`${baseURL}/tunnel/status/stream`, {
    withCredentials: true,
  });

  source.addEventListener("statuses", (event) => {
    try {
      onStatuses(JSON.parse(event.data) as Record<string, TunnelStatus>);
    } catch {
      onError?.();
    }
  });

  source.onerror = () => {
    onError?.();
  };

  return () => source.close();
}

export async function getTunnelStatusByName(
  tunnelName: string,
): Promise<TunnelStatus | undefined> {
  const statuses = await getTunnelStatuses();
  return statuses[tunnelName];
}

export async function connectTunnel(
  tunnelConfig: TunnelConfig,
): Promise<Record<string, unknown>> {
  try {
    const response = await tunnelApi.post("/tunnel/connect", tunnelConfig);
    return response.data;
  } catch (error) {
    handleApiError(error, "connect tunnel");
  }
}

export async function disconnectTunnel(
  tunnelName: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await tunnelApi.post("/tunnel/disconnect", { tunnelName });
    return response.data;
  } catch (error) {
    handleApiError(error, "disconnect tunnel");
  }
}

export async function cancelTunnel(
  tunnelName: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await tunnelApi.post("/tunnel/cancel", { tunnelName });
    return response.data;
  } catch (error) {
    handleApiError(error, "cancel tunnel");
  }
}

export async function getC2STunnelPresets(): Promise<C2STunnelPreset[]> {
  try {
    const response = await authApi.get("/c2s-tunnel-presets");
    return response.data || [];
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return [];
    }
    handleApiError(error, "fetch client tunnel presets");
  }
}

export async function createC2STunnelPreset(data: {
  name: string;
  config: TunnelConnection[];
  platform?: string;
  computerName?: string;
}): Promise<C2STunnelPreset> {
  try {
    const response = await authApi.post("/c2s-tunnel-presets", data);
    return response.data;
  } catch (error) {
    handleApiError(error, "create client tunnel preset");
  }
}

export async function updateC2STunnelPreset(
  id: number,
  data: Partial<{
    name: string;
    config: TunnelConnection[];
    platform: string;
    computerName: string;
  }>,
): Promise<C2STunnelPreset> {
  try {
    const response = await authApi.put(`/c2s-tunnel-presets/${id}`, data);
    return response.data;
  } catch (error) {
    handleApiError(error, "update client tunnel preset");
  }
}

export async function deleteC2STunnelPreset(
  id: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await authApi.delete(`/c2s-tunnel-presets/${id}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "delete client tunnel preset");
  }
}

// ============================================================================
