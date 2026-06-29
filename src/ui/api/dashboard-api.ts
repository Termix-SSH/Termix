import { dashboardApi, handleApiError } from "@/main-axios";
import { normalizeServiceLinkUrl } from "@/lib/service-link-url";

// DASHBOARD API
// ============================================================================

export interface UptimeInfo {
  uptimeMs: number;
  uptimeSeconds: number;
  formatted: string;
}

export interface RecentActivityItem {
  id: number;
  userId: string;
  type:
    | "terminal"
    | "file_manager"
    | "server_stats"
    | "tunnel"
    | "docker"
    | "telnet"
    | "vnc"
    | "rdp";
  hostId: number;
  hostName: string;
  timestamp: string;
}

export async function getUptime(): Promise<UptimeInfo> {
  try {
    const response = await dashboardApi.get("/uptime");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch uptime");
  }
}

export async function getRecentActivity(
  limit?: number,
): Promise<RecentActivityItem[]> {
  try {
    const response = await dashboardApi.get("/activity/recent", {
      params: { limit },
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch recent activity");
  }
}

export async function logActivity(
  type:
    | "terminal"
    | "file_manager"
    | "server_stats"
    | "tunnel"
    | "docker"
    | "rdp"
    | "vnc"
    | "telnet",
  hostId: number,
  hostName: string,
): Promise<{ message: string; id: number | string }> {
  try {
    const response = await dashboardApi.post("/activity/log", {
      type,
      hostId,
      hostName,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "log activity");
  }
}

export async function resetRecentActivity(): Promise<{ message: string }> {
  try {
    const response = await dashboardApi.delete("/activity/reset");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "reset recent activity");
  }
}

export interface ServiceLink {
  id: number;
  userId: string;
  label: string;
  url: string;
  order: number;
  createdAt: string;
}

export async function getServiceLinks(): Promise<ServiceLink[]> {
  try {
    const response = await dashboardApi.get("/service-links");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch service links");
  }
}

export async function createServiceLink(
  label: string,
  url: string,
): Promise<ServiceLink> {
  try {
    const response = await dashboardApi.post("/service-links", {
      label,
      url: normalizeServiceLinkUrl(url),
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "create service link");
  }
}

export async function deleteServiceLink(
  id: number,
): Promise<{ message: string }> {
  try {
    const response = await dashboardApi.delete(`/service-links/${id}`);
    return response.data;
  } catch (error) {
    throw handleApiError(error, "delete service link");
  }
}

export async function updateServiceLink(
  id: number,
  updates: { label?: string; url?: string },
): Promise<ServiceLink> {
  try {
    const response = await dashboardApi.put(`/service-links/${id}`, {
      ...updates,
      url:
        updates.url !== undefined
          ? normalizeServiceLinkUrl(updates.url)
          : undefined,
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "update service link");
  }
}
