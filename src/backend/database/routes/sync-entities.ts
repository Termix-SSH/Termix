/**
 * Core's own sync entities, registered the same way a plugin registers one.
 *
 * These were a hardcoded ENTITY_CONFIG in sync.ts, a SyncEntityType union in
 * the tombstone repository, a REFERENCES map in sync-references.ts and a
 * frozen array in electron/. Four lists that had to agree and had no test
 * saying they did - which is how networkTopology came to be missing from one
 * of them. Now there is one registration per entity and the rest is derived.
 *
 * The order values reproduce the dependency order the Electron array encoded:
 * anything referenced by another entity syncs first, and networkTopology
 * syncs last because it holds host ids inside a JSON blob.
 */

import {
  hosts,
  sshCredentials,
  sshFolders,
  snippets,
  snippetFolders,
  vaultProfiles,
  dashboardServiceLinks,
  homepageItems,
  userPreferences,
  networkTopology,
} from "../db/schema.js";
import {
  CORE_OWNER,
  registerEntity,
  listEntities,
} from "../../plugins/sync-registry.js";
import { mapTopologyHostIds } from "./sync-references.js";

const CREDENTIAL_REFERENCE = {
  field: "credentialId",
  syncField: "credentialSyncId",
  entityType: "sshCredentials",
} as const;

const HOST_REFERENCES = [
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
] as const;

let registered = false;

/**
 * Registers core's entities. Idempotent, because the sync routes and the
 * Electron entity endpoint both need the registry primed and neither can
 * assume it ran first.
 */
export function registerCoreSyncEntities(): void {
  if (registered && listEntities().length > 0) return;
  registered = true;

  // 10, 20, 30... so a plugin can slot an entity between two core ones
  // without every order value having to be renumbered.
  registerEntity(CORE_OWNER, {
    type: "sshCredentials",
    table: sshCredentials,
    order: 10,
  });

  registerEntity(CORE_OWNER, {
    type: "vaultProfiles",
    table: vaultProfiles,
    order: 20,
  });

  registerEntity(CORE_OWNER, {
    type: "sshFolders",
    table: sshFolders,
    order: 30,
    references: [CREDENTIAL_REFERENCE],
  });

  registerEntity(CORE_OWNER, {
    type: "snippetFolders",
    table: snippetFolders,
    order: 40,
  });

  registerEntity(CORE_OWNER, {
    type: "hosts",
    table: hosts,
    order: 50,
    // connectionOrigin says how this device reached the host, which is never
    // true of the other side.
    readOnlyFields: ["connectionOrigin"],
    references: HOST_REFERENCES,
    encryptedFields: ["ssh_data"],
  });

  registerEntity(CORE_OWNER, {
    type: "snippets",
    table: snippets,
    order: 60,
  });

  registerEntity(CORE_OWNER, {
    type: "dashboardServiceLinks",
    table: dashboardServiceLinks,
    order: 70,
  });

  registerEntity(CORE_OWNER, {
    type: "homepageItems",
    table: homepageItems,
    order: 80,
  });

  registerEntity(CORE_OWNER, {
    type: "userPreferences",
    table: userPreferences,
    order: 90,
    singleton: true,
    readOnlyFields: ["storageMode"],
  });

  registerEntity(CORE_OWNER, {
    type: "networkTopology",
    table: networkTopology,
    order: 100,
    singleton: true,
    // Host ids live inside the topology JSON rather than in a column, so the
    // generic reference machinery cannot reach them.
    serialize: async (row, resolveSyncId) => ({
      ...row,
      topology: await mapTopologyHostIds(
        row.topology as string | null | undefined,
        async (id) => {
          const numericId = Number(id);
          if (!Number.isInteger(numericId)) return null;
          return resolveSyncId("hosts", numericId);
        },
      ),
    }),
    deserialize: async (row, resolveId) => ({
      ...row,
      topology: await mapTopologyHostIds(
        row.topology as string | null | undefined,
        async (syncId) => {
          const id = await resolveId("hosts", syncId);
          return id === null ? null : String(id);
        },
      ),
    }),
  });
}

/** The tables a reference may point at, derived from the registrations. */
export const ENCRYPTED_ENTITY_TABLES: Readonly<Record<string, string>> = {
  hosts: "ssh_data",
  sshCredentials: "ssh_credentials",
};
