// Was part of src/ui/api/settings-api.ts, moved here with the rest of the
// Tailscale plugin. The backing routes stay in place: /users/tailscale-settings
// is general user-settings infrastructure in core, and /tailscale/devices is
// this plugin's own route (plugins/tailscale/backend/routes.ts).

import axios from "axios";
import { authApi, handleApiError } from "@/main-axios";

export async function getTailscaleSettings(): Promise<{
  apiKey: string;
  hasApiKey: boolean;
  apiBaseUrl: string;
}> {
  try {
    const response = await authApi.get("/users/tailscale-settings");
    return response.data;
  } catch (error) {
    handleApiError(error, "fetch Tailscale settings");
  }
}

export async function updateTailscaleSettings(
  apiKey: string,
  apiBaseUrl?: string,
): Promise<{ hasApiKey: boolean }> {
  try {
    const response = await authApi.patch("/users/tailscale-settings", {
      apiKey,
      apiBaseUrl,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "update Tailscale settings");
  }
}

export async function getTailscaleDevices(): Promise<{
  devices: Array<{
    id: string;
    name: string;
    hostname: string;
    addresses: string[];
    os: string;
    lastSeen: string;
  }>;
  hasApiKey: boolean;
  error?: string;
}> {
  try {
    const response = await authApi.get("/tailscale/devices");
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data;
      if (
        data &&
        typeof data === "object" &&
        "hasApiKey" in data &&
        typeof data.hasApiKey === "boolean"
      ) {
        return data as {
          devices: [];
          hasApiKey: boolean;
          error?: string;
        };
      }
    }
    handleApiError(error, "fetch Tailscale devices");
    throw error;
  }
}
