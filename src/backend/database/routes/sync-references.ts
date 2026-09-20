import type { SyncEntityType } from "../repositories/sync-tombstone-repository.js";

export type SyncReferenceEntity = "hosts" | "sshCredentials" | "vaultProfiles";

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
 * Node/edge ids in a topology are either a host's local numeric `id` (as a
 * string) or a client-generated `group-<timestamp>` id. Only the former is
 * meaningful across sides, so translate just those through the mapper and
 * leave group ids untouched. Nodes/edges that fail to resolve (host deleted,
 * or not synced to this side yet) are dropped rather than left dangling.
 */
async function mapTopologyHostIds(
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

interface SyncReference {
  field: string;
  syncField: string;
  entityType: SyncReferenceEntity;
}

const CREDENTIAL_REFERENCE: SyncReference = {
  field: "credentialId",
  syncField: "credentialSyncId",
  entityType: "sshCredentials",
};

const HOST_REFERENCES: SyncReference[] = [
  CREDENTIAL_REFERENCE,
  {
    field: "rdpCredentialId",
    syncField: "rdpCredentialSyncId",
    entityType: "sshCredentials",
  },
  {
    field: "vncCredentialId",
    syncField: "vncCredentialSyncId",
    entityType: "sshCredentials",
  },
  {
    field: "telnetCredentialId",
    syncField: "telnetCredentialSyncId",
    entityType: "sshCredentials",
  },
  {
    field: "vaultProfileId",
    syncField: "vaultProfileSyncId",
    entityType: "vaultProfiles",
  },
  {
    field: "parentHostId",
    syncField: "parentHostSyncId",
    entityType: "hosts",
  },
];

export function orderSyncRows(
  entityType: SyncEntityType,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (entityType !== "hosts") return rows;

  const bySyncId = new Map(
    rows
      .filter((row) => typeof row.syncId === "string")
      .map((row) => [row.syncId as string, row]),
  );
  const ordered: Record<string, unknown>[] = [];
  const visited = new Set<Record<string, unknown>>();
  const visiting = new Set<Record<string, unknown>>();

  const visit = (row: Record<string, unknown>) => {
    if (visited.has(row)) return;
    if (visiting.has(row)) return;
    visiting.add(row);

    const parentSyncId = row.parentHostSyncId;
    if (typeof parentSyncId === "string") {
      const parent = bySyncId.get(parentSyncId);
      if (parent) visit(parent);
    }

    visiting.delete(row);
    visited.add(row);
    ordered.push(row);
  };

  rows.forEach(visit);
  return ordered;
}

const REFERENCES: Partial<Record<SyncEntityType, SyncReference[]>> = {
  hosts: HOST_REFERENCES,
  sshFolders: [CREDENTIAL_REFERENCE],
};

export async function serializeSyncReferences(
  entityType: SyncEntityType,
  row: Record<string, unknown>,
  resolveSyncId: (
    entityType: SyncReferenceEntity,
    id: number,
  ) => Promise<string | null>,
): Promise<Record<string, unknown>> {
  const serialized = { ...row };

  if (entityType === "networkTopology") {
    serialized.topology = await mapTopologyHostIds(
      serialized.topology as string | null | undefined,
      async (id) => {
        const numericId = Number(id);
        if (!Number.isInteger(numericId)) return null;
        return resolveSyncId("hosts", numericId);
      },
    );
    return serialized;
  }

  for (const reference of REFERENCES[entityType] ?? []) {
    const id = serialized[reference.field];
    serialized[reference.syncField] =
      typeof id === "number"
        ? await resolveSyncId(reference.entityType, id)
        : null;
    delete serialized[reference.field];
  }
  return serialized;
}

export async function deserializeSyncReferences(
  entityType: SyncEntityType,
  row: Record<string, unknown>,
  resolveId: (
    entityType: SyncReferenceEntity,
    syncId: string,
  ) => Promise<number | null>,
): Promise<Record<string, unknown>> {
  const deserialized = { ...row };

  if (entityType === "networkTopology") {
    deserialized.topology = await mapTopologyHostIds(
      deserialized.topology as string | null | undefined,
      async (syncId) => {
        const id = await resolveId("hosts", syncId);
        return id === null ? null : String(id);
      },
    );
    return deserialized;
  }

  for (const reference of REFERENCES[entityType] ?? []) {
    const syncId = deserialized[reference.syncField];
    delete deserialized[reference.syncField];
    delete deserialized[reference.field];

    if (syncId == null) {
      deserialized[reference.field] = null;
      continue;
    }
    if (typeof syncId !== "string") {
      throw new Error(`Invalid ${reference.syncField}`);
    }

    const id = await resolveId(reference.entityType, syncId);
    if (id === null) {
      throw new Error(
        `Missing ${reference.entityType} dependency ${reference.syncField}=${syncId}`,
      );
    }
    deserialized[reference.field] = id;
  }
  return deserialized;
}
