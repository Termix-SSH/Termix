import { authApi, handleApiError } from "@/main-axios";

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
  /** Core records file_manager and tunnel; plugin tabs record their own. */
  type: string;
  hostId: number;
  hostName: string;
  timestamp: string;
}

export async function getUptime(): Promise<UptimeInfo> {
  try {
    const response = await authApi.get("/dashboard/uptime");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch uptime");
  }
}

export async function getRecentActivity(
  limit?: number,
): Promise<RecentActivityItem[]> {
  try {
    const response = await authApi.get("/dashboard/activity/recent", {
      params: { limit },
    });
    return response.data;
  } catch (error) {
    throw handleApiError(error, "fetch recent activity");
  }
}

export async function logActivity(
  type: string,
  hostId: number,
  hostName: string,
): Promise<{ message: string; id: number | string }> {
  try {
    const response = await authApi.post("/dashboard/activity/log", {
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
    const response = await authApi.delete("/dashboard/activity/reset");
    return response.data;
  } catch (error) {
    throw handleApiError(error, "reset recent activity");
  }
}
