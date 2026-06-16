import { AxiosError } from "axios";
import {
  authApi,
  getAllServerStatuses,
  handleApiError,
  sshHostApi,
} from "@/main-axios";
import type { SSHHost, SSHHostData, ProxyNode } from "@/types/index";
import type { ServerStatus, SSHHostWithStatus } from "@/main-axios";
import type { ProxmoxDiscoverResult } from "@/types/proxmox";

// SSH HOST MANAGEMENT
// ============================================================================

export async function getSSHHosts(): Promise<SSHHostWithStatus[]> {
  try {
    const hostsResponse = await sshHostApi.get("/db/host");
    const hosts: SSHHost[] = Array.isArray(hostsResponse.data)
      ? hostsResponse.data
      : [];

    let statuses: Record<number, ServerStatus> = {};
    try {
      statuses = (await getAllServerStatuses()) || {};
    } catch {
      // Status fetch failure should not prevent host list from loading
    }

    return hosts.map((host) => ({
      ...host,
      status: statuses[host.id]?.status || "unknown",
    }));
  } catch (error) {
    throw handleApiError(error, "fetch SSH hosts");
  }
}

export async function createSSHHost(hostData: SSHHostData): Promise<SSHHost> {
  try {
    if (hostData.authType === "key" && hostData.key instanceof File) {
      const formData = new FormData();
      formData.append("key", hostData.key);
      const dataWithoutFile = { ...hostData, key: undefined };
      formData.append("data", JSON.stringify(dataWithoutFile));
      const response = await sshHostApi.post("/db/host", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data;
    }
    const response = await sshHostApi.post("/db/host", hostData);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create SSH host");
  }
}

export async function updateSSHHost(
  hostId: number,
  hostData: SSHHostData,
): Promise<SSHHost> {
  try {
    if (hostData.authType === "key" && hostData.key instanceof File) {
      const formData = new FormData();
      formData.append("key", hostData.key);
      const dataWithoutFile = { ...hostData, key: undefined };
      formData.append("data", JSON.stringify(dataWithoutFile));
      const response = await sshHostApi.put(`/db/host/${hostId}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data;
    }
    const response = await sshHostApi.put(`/db/host/${hostId}`, hostData);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update SSH host");
  }
}

export async function wakeOnLan(hostId: number): Promise<{ success: boolean }> {
  try {
    const response = await sshHostApi.post(`/db/host/${hostId}/wake`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "wake on LAN");
  }
}

export async function bulkImportSSHHosts(
  hosts: SSHHostData[],
  overwrite = false,
): Promise<{
  message: string;
  success: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
}> {
  try {
    const response = await sshHostApi.post("/bulk-import", {
      hosts,
      overwrite,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "bulk import SSH hosts");
  }
}

export async function discoverProxmoxGuests(
  hostId: number,
): Promise<ProxmoxDiscoverResult> {
  try {
    const response = await authApi.post(
      "/proxmox/discover",
      { hostId },
      { timeout: 120000 },
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "discover Proxmox guests");
  }
}

export async function bulkUpdateSSHHosts(
  hostIds: number[],
  updates: Record<string, unknown>,
): Promise<{ updated: number; failed: number; errors: string[] }> {
  try {
    const response = await sshHostApi.patch("/bulk-update", {
      hostIds,
      updates,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "bulk update SSH hosts");
  }
}

export async function deleteSSHHost(
  hostId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.delete(`/db/host/${hostId}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "delete SSH host");
  }
}

export async function getSSHHostById(hostId: number): Promise<SSHHost> {
  try {
    const response = await sshHostApi.get(`/db/host/${hostId}`);
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch SSH host");
  }
}

export async function exportSSHHostWithCredentials(
  hostId: number,
): Promise<SSHHost> {
  try {
    const response = await sshHostApi.get(`/db/host/${hostId}/export`);
    return response.data;
  } catch (error) {
    handleApiError(error, "export SSH host with credentials");
  }
}

export async function exportAllSSHHosts(): Promise<{
  hosts: SSHHost[];
}> {
  try {
    const response = await sshHostApi.get("/db/hosts/export");
    return response.data;
  } catch (error) {
    handleApiError(error, "export all SSH hosts");
  }
}

// ============================================================================
// SSH AUTOSTART MANAGEMENT
// ============================================================================

export async function enableAutoStart(
  sshConfigId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.post("/autostart/enable", {
      sshConfigId,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "enable autostart");
  }
}

export async function disableAutoStart(
  sshConfigId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.delete("/autostart/disable", {
      data: { sshConfigId },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "disable autostart");
  }
}

export async function getAutoStartStatus(): Promise<{
  autostart_configs: Array<{
    sshConfigId: number;
    host: string;
    port: number;
    username: string;
    authType: string;
  }>;
  total_count: number;
}> {
  try {
    const response = await sshHostApi.get("/autostart/status");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch autostart status");
  }
}

// ============================================================================
// PROXY CONNECTIVITY TEST
// ============================================================================

export async function testProxyConnection(options: {
  singleProxy?: {
    host: string;
    port: number;
    type?: 4 | 5 | "http";
    username?: string;
    password?: string;
  };
  proxyChain?: ProxyNode[];
  testTarget?: { host: string; port: number };
}): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
  try {
    const response = await sshHostApi.post("/db/proxy/test", options);
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError && error.response?.data?.error) {
      return { success: false, error: error.response.data.error };
    }
    handleApiError(error, "test proxy connection");
  }
}

// ============================================================================
