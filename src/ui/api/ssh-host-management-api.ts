import { AxiosError } from "axios";
import { handleApiError, sshHostApi } from "@/main-axios";
import type { SSHHost, SSHHostData, ProxyNode } from "@/types/index";
import type { SSHHostWithStatus } from "@/main-axios";
import {
  getCachedSSHHosts,
  invalidateHostsAndStatusCaches,
} from "@/lib/hosts-request-cache";

// SSH HOST MANAGEMENT
// ============================================================================

async function loadSSHHostsFromApi(): Promise<SSHHost[]> {
  const hostsResponse = await sshHostApi.get("/db/host");
  return Array.isArray(hostsResponse.data) ? hostsResponse.data : [];
}

/** Host config only. Live status comes from ServerStatusContext. */
export async function getSSHHosts(): Promise<SSHHostWithStatus[]> {
  try {
    const hosts = await getCachedSSHHosts(loadSSHHostsFromApi);
    return hosts.map((host) => ({ ...host, status: "unknown" }));
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
      invalidateHostsAndStatusCaches();
      return response.data;
    }
    const response = await sshHostApi.post("/db/host", hostData);
    invalidateHostsAndStatusCaches();
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
      invalidateHostsAndStatusCaches();
      return response.data;
    }
    const response = await sshHostApi.put(`/db/host/${hostId}`, hostData);
    invalidateHostsAndStatusCaches();
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update SSH host");
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
    invalidateHostsAndStatusCaches();
    return response.data;
  } catch (error) {
    handleApiError(error, "bulk update SSH hosts");
  }
}

export interface HostPolicy {
  manualCreate: boolean;
  /** The plugin that manages hosts, when hosts can't be added by hand. */
  blockedBy?: string;
}

export async function getHostPolicy(): Promise<HostPolicy> {
  try {
    const response = await sshHostApi.get("/policy");
    return response.data;
  } catch (error) {
    handleApiError(error, "load host policy");
  }
}

export async function reorderSSHHosts(
  positions: { id: number; sortOrder: number }[],
): Promise<{ updated: number }> {
  try {
    const response = await sshHostApi.put("/reorder", { positions });
    invalidateHostsAndStatusCaches();
    return response.data;
  } catch (error) {
    handleApiError(error, "reorder SSH hosts");
  }
}

export async function deleteSSHHost(
  hostId: number,
): Promise<Record<string, unknown>> {
  try {
    const response = await sshHostApi.delete(`/db/host/${hostId}`);
    invalidateHostsAndStatusCaches();
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
