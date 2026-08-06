import type { SyncEntityType } from "../repositories/sync-tombstone-repository.js";

export type SyncReferenceEntity = "sshCredentials" | "vaultProfiles";

interface SyncReference {
  field: string;
  syncField: string;
  entityType: SyncReferenceEntity;
}

const HOST_REFERENCES: SyncReference[] = [
  {
    field: "credentialId",
    syncField: "credentialSyncId",
    entityType: "sshCredentials",
  },
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
];

const REFERENCES: Partial<Record<SyncEntityType, SyncReference[]>> = {
  hosts: HOST_REFERENCES,
  sshFolders: [HOST_REFERENCES[0]],
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
