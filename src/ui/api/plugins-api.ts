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

/**
 * What GET /plugins returns.
 *
 * The admin-only fields are absent for a caller without
 * admin.plugins.manage: what a plugin may do, what it has been granted and
 * why it failed are operational details the shell does not need.
 */
export interface PluginSummary {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  /** enabled | disabled | blocked | failed, or the loader's live state. */
  state: string;
  contributes: PluginContributions | null;

  tier?: string;
  source?: string;
  /** Capabilities this plugin's manifest declares. Admins only. */
  capabilities?: string[];
  /** The subset of `capabilities` actually granted. Admins only. */
  grantedCapabilities?: string[];
  /** Why the plugin is blocked or failed. Admins only. */
  lastError?: string | null;
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
