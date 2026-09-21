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
