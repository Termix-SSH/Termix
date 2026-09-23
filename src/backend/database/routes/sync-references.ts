import type { SyncEntityType } from "../repositories/sync-tombstone-repository.js";
import { getEntity } from "../../plugins/sync-registry.js";

/**
 * An entity another entity's rows may point at.
 *
 * A plain string rather than a union: the set is whatever is registered, and a
 * plugin can both register an entity and reference one. sync.ts resolves the
 * name through the registry, so an unknown one is an error there rather than a
 * silent fallthrough - which is what the old three-way if/else did, routing
 * anything that was not hosts or sshCredentials to vaultProfiles.
 */
export type SyncReferenceEntity = string;

interface SyncReference {
  field: string;
  syncField: string;
  entityType: SyncReferenceEntity;
}

export function orderSyncRows(
  entityType: SyncEntityType,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  // Only an entity that references itself needs its rows ordered among
  // themselves. Today that is hosts, through parentHostId.
  const selfReference = referencesFor(entityType).find(
    (reference) => reference.entityType === entityType,
  );
  if (!selfReference) return rows;

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

    const parentSyncId = row[selfReference.syncField];
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

function referencesFor(entityType: SyncEntityType): readonly SyncReference[] {
  return (getEntity(entityType)?.references ?? []) as readonly SyncReference[];
}

export async function serializeSyncReferences(
  entityType: SyncEntityType,
  row: Record<string, unknown>,
  resolveSyncId: (
    entityType: SyncReferenceEntity,
    id: number,
  ) => Promise<string | null>,
): Promise<Record<string, unknown>> {
  const serialized = { ...row };

  const custom = getEntity(entityType)?.serialize;
  if (custom) return custom(serialized, resolveSyncId);

  for (const reference of referencesFor(entityType)) {
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

  const custom = getEntity(entityType)?.deserialize;
  if (custom) return custom(deserialized, resolveId);

  for (const reference of referencesFor(entityType)) {
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
