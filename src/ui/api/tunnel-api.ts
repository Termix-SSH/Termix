import axios from "axios";
import {
  authApi,
  handleApiError,
  tunnelApi,
  getRemoteTunnelApi,
  isElectron,
} from "@/main-axios";
import type {
  C2STunnelPreset,
  TunnelConfig,
  TunnelConnection,
  TunnelStatus,
} from "@/types/index";

// TUNNEL MANAGEMENT
// ============================================================================
//
// Tunnel status is a process-local, in-memory view (no DB lookup) so it's
// safe to read from both the embedded backend and a connected remote server
// and merge the results. connectTunnel/disconnectTunnel/cancelTunnel are
// NOT origin-routed: they resolve the target host by numeric database id
// against whichever backend receives the request, and a synced host has a
// different numeric id in each database (only its syncId matches across
// them) -- routing those calls to a remote backend would need a
// local-id-to-remote-id resolution step that doesn't exist yet. They always
// target the embedded local backend for now.

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

export async function getTunnelStatuses(): Promise<
  Record<string, TunnelStatus>
> {
  try {
    const [localResult, remoteConnected] = await Promise.all([
      tunnelApi.get("/tunnel/status"),
      isRemoteSyncConnected(),
    ]);
    const localStatuses = localResult.data || {};
    if (!remoteConnected) return localStatuses;

    try {
      const remoteResult = await getRemoteTunnelApi().get("/tunnel/status");
      return { ...localStatuses, ...(remoteResult.data || {}) };
    } catch {
      return localStatuses;
    }
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

  let latestLocal: Record<string, TunnelStatus> = {};
  let latestRemote: Record<string, TunnelStatus> = {};
  let remotePollTimer: ReturnType<typeof setInterval> | null = null;

  const emitMerged = () => {
    onStatuses({ ...latestLocal, ...latestRemote });
  };

  source.addEventListener("statuses", (event) => {
    try {
      latestLocal = JSON.parse(event.data) as Record<string, TunnelStatus>;
      emitMerged();
    } catch {
      onError?.();
    }
  });

  source.onerror = () => {
    onError?.();
  };

  // Remote tunnel status has no SSE stream exposed to the desktop app yet,
  // so poll it at a modest interval when a remote server is connected.
  isRemoteSyncConnected().then((connected) => {
    if (!connected) return;
    const pollRemote = async () => {
      try {
        const result = await getRemoteTunnelApi().get("/tunnel/status");
        latestRemote = result.data || {};
        emitMerged();
      } catch {
        // remote unreachable this tick -- keep last known remote statuses
      }
    };
    pollRemote();
    remotePollTimer = setInterval(pollRemote, 5000);
  });

  return () => {
    source.close();
    if (remotePollTimer) clearInterval(remotePollTimer);
  };
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
