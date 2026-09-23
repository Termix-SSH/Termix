interface TopologyNode {
  data?: { id?: string; [key: string]: unknown };
  [key: string]: unknown;
}

interface TopologyEdge {
  data?: { source?: string; target?: string; [key: string]: unknown };
  [key: string]: unknown;
}

interface Topology {
  nodes?: TopologyNode[];
  edges?: TopologyEdge[];
  [key: string]: unknown;
}

/**
 * Node/edge ids in a topology are either a host's local numeric id (as a
 * string) or a client-generated group-<timestamp> id. Only the former is
 * meaningful across sides, so translate just those through the mapper and
 * leave group ids untouched. Nodes/edges that fail to resolve (host deleted,
 * or not synced to this side yet) are dropped rather than left dangling.
 */
export async function mapTopologyHostIds(
  topologyJson: string | null | undefined,
  mapId: (id: string) => Promise<string | null>,
): Promise<string | null> {
  if (!topologyJson) return topologyJson ?? null;

  let topology: Topology;
  try {
    topology = JSON.parse(topologyJson);
  } catch {
    return topologyJson;
  }

  const isGroupId = (id: string) => id.startsWith("group-");
  const idMap = new Map<string, string | null>();

  const resolve = async (id: string): Promise<string | null> => {
    if (isGroupId(id)) return id;
    if (!idMap.has(id)) idMap.set(id, await mapId(id));
    return idMap.get(id) ?? null;
  };

  const nodes: TopologyNode[] = [];
  for (const node of topology.nodes ?? []) {
    const id = node.data?.id;
    if (typeof id !== "string") continue;
    const mapped = await resolve(id);
    if (mapped === null) continue;
    nodes.push({ ...node, data: { ...node.data, id: mapped } });
  }

  const nodeIds = new Set(nodes.map((n) => n.data?.id));
  const edges: TopologyEdge[] = [];
  for (const edge of topology.edges ?? []) {
    const source = edge.data?.source;
    const target = edge.data?.target;
    if (typeof source !== "string" || typeof target !== "string") continue;
    const mappedSource = await resolve(source);
    const mappedTarget = await resolve(target);
    if (mappedSource === null || mappedTarget === null) continue;
    if (!nodeIds.has(mappedSource) || !nodeIds.has(mappedTarget)) continue;
    edges.push({
      ...edge,
      data: { ...edge.data, source: mappedSource, target: mappedTarget },
    });
  }

  return JSON.stringify({ ...topology, nodes, edges });
}
