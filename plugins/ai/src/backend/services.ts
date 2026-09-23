import type { PluginServices } from "@termix/plugin-sdk/backend";

let current: PluginServices | null = null;

/** Set in activate, cleared on deactivate. */
export function setPluginServices(services: PluginServices | null): void {
  current = services;
}

/** Another plugin's workspaces, as ctx.services.get("workspaces.saved") returns them. */
interface SavedWorkspaces {
  list: () => Promise<Array<{ id: number; name: string; isDefault: boolean }>>;
}

/**
 * The user's saved workspaces, or null when the workspaces plugin is off or
 * the user may not use it. Optional: the assistant works without it.
 */
export async function listSavedWorkspaces(
  userId: string,
): Promise<Array<{ id: number; name: string; isDefault: boolean }> | null> {
  if (!current) return null;
  try {
    return await current
      .get<SavedWorkspaces>("workspaces.saved", { userId })
      .list();
  } catch {
    return null;
  }
}

/** Another plugin's graph, as ctx.services.get("network-topology.graph") returns it. */
interface NetworkTopologyGraph {
  get: () => Promise<unknown | null>;
}

/**
 * The user's saved network topology, or null when the network-topology
 * plugin is off or the user may not use it. Optional: the tool disappears
 * without it.
 */
export async function getNetworkTopology(
  userId: string,
): Promise<unknown | null> {
  if (!current) return null;
  try {
    return await current
      .get<NetworkTopologyGraph>("network-topology.graph", { userId })
      .get();
  } catch {
    return null;
  }
}
