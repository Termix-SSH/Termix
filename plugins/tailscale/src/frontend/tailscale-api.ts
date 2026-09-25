// The API key and base URL are this plugin's own settings, read and written
// through the generic /plugins/tailscale/settings/admin routes that core
// renders from the manifest. Only the device list is left here, because it is
// this plugin's own route.

import type { PluginApiClient } from "@termix/plugin-sdk/frontend";

export interface TailscaleDevicesResponse {
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
}

let pluginApi: PluginApiClient | null = null;

/** Set from activate with app.api, cleared on deactivate. */
export function setTailscaleApi(api: PluginApiClient | null): void {
  pluginApi = api;
}

export async function getTailscaleDevices(): Promise<TailscaleDevicesResponse> {
  if (!pluginApi) throw new Error("The Tailscale plugin is not active");
  try {
    const response = await pluginApi.get<TailscaleDevicesResponse>("/devices");
    return response.data;
  } catch (error) {
    // The route answers with the key state even when the tailnet call fails.
    const data = (error as { response?: { data?: unknown } })?.response?.data;
    if (
      data &&
      typeof data === "object" &&
      "hasApiKey" in data &&
      typeof (data as { hasApiKey: unknown }).hasApiKey === "boolean"
    ) {
      return data as TailscaleDevicesResponse;
    }
    throw error;
  }
}
