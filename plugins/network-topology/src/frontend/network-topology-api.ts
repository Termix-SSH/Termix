import type { PluginApiClient } from "@termix/plugin-sdk/frontend";

export interface NetworkTopologyNode {
  data: {
    id: string;
    label?: string;
    ip?: string;
    status?: string;
    tags?: string[];
    parent?: string;
    color?: string;
    /** Absent on nodes; callers tell nodes from edges by testing these. */
    source?: undefined;
    target?: undefined;
  };
  position?: { x: number; y: number };
}

export interface NetworkTopologyEdge {
  data: {
    id?: string;
    source: string;
    target: string;
    label?: undefined;
    ip?: undefined;
  };
}

export interface NetworkTopologyData {
  nodes: NetworkTopologyNode[];
  edges: NetworkTopologyEdge[];
}

/**
 * The topology routes, through the plugin's own client. Paths are relative
 * to /plugin-api/network-topology/, which the client already points at.
 */
export function createNetworkTopologyApi(api: PluginApiClient) {
  return {
    get: async (): Promise<NetworkTopologyData | null> => {
      const response = await api.get<NetworkTopologyData | null>("/");
      return response.data;
    },
    save: async (
      topology: NetworkTopologyData,
    ): Promise<{ success: boolean }> => {
      const response = await api.post<{ success: boolean }>("/", {
        topology,
      });
      return response.data;
    },
  };
}

export type NetworkTopologyApi = ReturnType<typeof createNetworkTopologyApi>;
