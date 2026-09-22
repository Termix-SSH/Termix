// The API key and base URL are this plugin's own settings now, read and
// written through the generic /plugins/tailscale/settings/admin routes that
// core renders from the manifest. Only the device list is left here, because
// it is this plugin's own route.

import axios from "axios";
import { authApi, handleApiError } from "@/main-axios";

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
    const response = await authApi.get("/plugin-api/tailscale/devices");
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
