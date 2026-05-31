import { dashboardApi, handleApiError } from "@/main-axios";

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
