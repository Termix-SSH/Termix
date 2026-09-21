import { rbacApi } from "@/main-axios";

export interface PluginTabContribution {
  id: string;
  titleKey: string;
  icon: string;
  openFrom: string[];
}

export interface PluginContributions {
  tabs?: PluginTabContribution[];
}

export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  tier: string;
  source: string;
  enabled: boolean;
  runtimeState: string;
  lastError: string | null;
  contributes: PluginContributions | null;
  /** Capabilities this plugin's manifest declares it may ask for. */
  permissions: string[];
  /** The subset of `permissions` an admin has actually granted. */
  grantedCapabilities: string[];
}

export async function getPlugins(): Promise<PluginSummary[]> {
  const response = await rbacApi.get("/plugins");
  return Array.isArray(response.data) ? response.data : [];
}

export async function setPluginEnabled(
  pluginId: string,
  enabled: boolean,
): Promise<void> {
  await rbacApi.patch(`/plugins/${encodeURIComponent(pluginId)}/state`, {
    enabled,
  });
}

export async function grantPluginCapability(
  pluginId: string,
  capability: string,
): Promise<void> {
  await rbacApi.post(`/plugins/${encodeURIComponent(pluginId)}/grants`, {
    capability,
  });
}

export async function revokePluginCapability(
  pluginId: string,
  capability: string,
): Promise<void> {
  await rbacApi.delete(
    `/plugins/${encodeURIComponent(pluginId)}/grants/${encodeURIComponent(capability)}`,
  );
}
