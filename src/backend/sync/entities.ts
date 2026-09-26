/**
 * Core's own sync entities, registered the same way a plugin registers one.
 *
 * Order values leave room between them (10, 30, 50...) so a plugin can slot
 * an entity in without renumbering; anything referenced syncs first.
 */

import { and, eq } from "drizzle-orm";
import type { SyncRow } from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import {
  hosts,
  sshCredentials,
  sshFolders,
  userPreferences,
} from "../database/db/schema.js";
import {
  CORE_OWNER,
  listEntities,
  registerEntity,
} from "../plugins/sync-registry.js";
import { FieldCrypto } from "../utils/field-crypto.js";
import { syncLogger } from "../utils/logger.js";
import { getPluginRuntime } from "../plugins/index.js";
import { singletonSyncId } from "./wire.js";
import {
  exportHostPluginSettings,
  importHostPluginSettings,
} from "./host-plugin-settings.js";

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
    field: "parentHostId",
    syncField: "parentHostSyncId",
    entityType: "hosts",
  },
  { field: "jumpHosts[].hostId", entityType: "hosts" },
  { field: "quickActions[].snippetId", entityType: "commandSnippet" },
] as const;

/** Columns that only mean something on the device that holds them. */
const HOST_LOCAL_FIELDS = [
  "connectionOrigin",
  "localOnly",
  "sharedSource",
  "hostKeyLastVerified",
];

let registered = false;

/** Registers core's entities. Idempotent. */
export function registerCoreSyncEntities(): void {
  if (
    registered &&
    listEntities().some((entity) => entity.owner === CORE_OWNER)
  )
    return;
  registered = true;

  registerEntity(
    CORE_OWNER,
    {
      type: "sshCredentials",
      table: sshCredentials,
      order: 10,
      encryptedFields: FieldCrypto.fieldsFor("ssh_credentials"),
      readOnlyFields: ["usageCount", "lastUsed", "sharedSource"],
      shouldSync: (row) => !row.sharedSource,
      permissions: {
        create: "credentials.create",
        update: "credentials.edit",
        delete: "credentials.delete",
      },
      afterWrite: async ({ id, userId, created }) => {
        if (id === null || created) return;
        const { SharedHostSecretsManager } =
          await import("../utils/shared-host-secrets-manager.js");
        await SharedHostSecretsManager.getInstance().resyncHostsForCredential(
          id,
          userId,
        );
        const { SharedCredentialSecretsManager } =
          await import("../utils/shared-credential-secrets-manager.js");
        await SharedCredentialSecretsManager.getInstance().resyncCredential(
          id,
          userId,
        );
      },
      remove: async (row, userId) => {
        const { deleteOwnedCredential } =
          await import("../hosts/delete-credential.js");
        await deleteOwnedCredential(userId, row.id as number);
      },
    },
    {
      // A credential shared with the user can back their own host.
      canReference: async (userId, _ownerId, id) => {
        const { findUsableCredential } =
          await import("../hosts/usable-credential.js");
        return (await findUsableCredential(id, userId)) !== null;
      },
    },
  );

  // vaultProfiles (order 20) belongs to the vault plugin.

  registerEntity(CORE_OWNER, {
    type: "sshFolders",
    table: sshFolders,
    order: 30,
    references: [CREDENTIAL_REFERENCE],
    readOnlyFields: ["localOnly"],
    shouldSync: (row) => !row.localOnly,
    permissions: {
      create: "hosts.create",
      update: "hosts.edit",
      delete: "hosts.delete",
    },
  });

  registerEntity(
    CORE_OWNER,
    {
      type: "hosts",
      table: hosts,
      order: 50,
      encryptedFields: FieldCrypto.fieldsFor("ssh_data"),
      readOnlyFields: HOST_LOCAL_FIELDS,
      references: HOST_REFERENCES,
      shouldSync: (row) => !row.localOnly && !row.sharedSource,
      permissions: {
        create: "hosts.create",
        update: "hosts.edit",
        delete: "hosts.delete",
      },
      serialize: async (row) => ({
        ...row,
        pluginSettings:
          typeof row.id === "number"
            ? await exportHostPluginSettings(row.id)
            : {},
      }),
      afterWrite: async ({ id, userId, wire }) => {
        if (id === null) return;
        await importHostPluginSettings(id, wire.pluginSettings);
        await dropInvalidParent(userId, id);
        const { SharedHostSecretsManager } =
          await import("../utils/shared-host-secrets-manager.js");
        await SharedHostSecretsManager.getInstance().resyncHost(id);
      },
      remove: async (row, userId) => {
        const { deleteOwnedHost } = await import("../hosts/delete-host.js");
        await deleteOwnedHost(userId, row.id as number);
      },
    },
    {
      canReference: async (userId, _ownerId, id) => {
        const { PermissionManager } =
          await import("../utils/permission-manager.js");
        const access = await PermissionManager.getInstance().canAccessHost(
          userId,
          id,
          "view",
        );
        return access.hasAccess;
      },
    },
  );

  // dashboardServiceLinks (70) and homepageItems (80) belong to homepage.

  registerEntity(CORE_OWNER, {
    type: "userPreferences",
    table: userPreferences,
    order: 90,
    singleton: true,
    readOnlyFields: ["storageMode"],
    references: [
      {
        field: "customKeybindings[].action.snippetId",
        entityType: "commandSnippet",
        idType: "string",
      },
    ],
  });

  registerEntity(
    CORE_OWNER,
    { type: "pluginUserSettings", table: null, order: 95 },
    {
      load: loadPluginUserSettings,
      write: writePluginUserSetting,
      erase: erasePluginUserSetting,
      covers: (syncId) => !!activeManifest(syncId.split(":")[0]),
    },
  );

  registerEntity(
    CORE_OWNER,
    { type: "accountProfile", table: null, order: 5, singleton: true },
    {
      readOnly: true,
      load: loadAccountProfile,
      write: writeAccountProfile,
      erase: async () => {},
    },
  );

  registerEntity(
    CORE_OWNER,
    { type: "sharedCredentials", table: null, order: 15 },
    {
      readOnly: true,
      load: loadSharedCredentials,
      write: (userId, wire) => writeSharedCopy("sshCredentials", userId, wire),
      erase: (userId, syncId) =>
        eraseSharedCopy("sshCredentials", userId, syncId),
    },
  );

  registerEntity(
    CORE_OWNER,
    { type: "sharedHosts", table: null, order: 55 },
    {
      readOnly: true,
      load: loadSharedHosts,
      write: (userId, wire) => writeSharedCopy("hosts", userId, wire),
      erase: (userId, syncId) => eraseSharedCopy("hosts", userId, syncId),
    },
  );
}

/** A synced parent link that would make a cycle here is dropped. */
async function dropInvalidParent(userId: string, hostId: number) {
  const { createCurrentRepositoryContext } =
    await import("../database/repositories/factory.js");
  const db = createCurrentRepositoryContext().drizzle;
  const [row] = await db
    .select({ parentHostId: hosts.parentHostId })
    .from(hosts)
    .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId)))
    .limit(1);
  if (typeof row?.parentHostId !== "number") return;
  const { validateParentHostId } =
    await import("../database/routes/host-parent-validation.js");
  if (await validateParentHostId(userId, hostId, row.parentHostId)) {
    await db
      .update(hosts)
      .set({ parentHostId: null })
      .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId)));
  }
}

function activeManifests(): PluginManifest[] {
  try {
    return getPluginRuntime()
      .loader.list()
      .filter((plugin) => plugin.state === "active" && plugin.manifest)
      .map((plugin) => plugin.manifest as PluginManifest);
  } catch {
    return [];
  }
}

function activeManifest(pluginId: string): PluginManifest | undefined {
  return activeManifests().find((manifest) => manifest.id === pluginId);
}

async function loadPluginUserSettings(userId: string): Promise<SyncRow[]> {
  const { declaredFields, getSetting } = await import("../plugins/settings.js");
  const { createCurrentPluginSettingsRepository } =
    await import("../database/repositories/factory.js");
  const repository = createCurrentPluginSettingsRepository();
  const rows: SyncRow[] = [];
  for (const manifest of activeManifests()) {
    const fields = declaredFields(manifest, "user");
    if (fields.length === 0) continue;
    const stored = new Set(
      (await repository.getAll(manifest.id, "user", userId))
        .filter((row) => row.value !== null)
        .map((row) => row.key),
    );
    for (const field of fields) {
      if (!stored.has(field.key)) continue;
      rows.push({
        syncId: `${manifest.id}:${field.key}`,
        pluginId: manifest.id,
        key: field.key,
        value: await getSetting(manifest, "user", userId, field.key),
      });
    }
  }
  return rows;
}

async function writePluginUserSetting(userId: string, wire: SyncRow) {
  const manifest = activeManifest(String(wire.pluginId));
  if (!manifest) return;
  const { setSetting } = await import("../plugins/settings.js");
  const error = await setSetting(
    manifest,
    "user",
    userId,
    String(wire.key),
    wire.value,
  );
  if (error) throw new Error(error);
}

async function erasePluginUserSetting(userId: string, syncId: string) {
  const [pluginId, ...rest] = syncId.split(":");
  const { createCurrentPluginSettingsRepository } =
    await import("../database/repositories/factory.js");
  await createCurrentPluginSettingsRepository().delete(
    pluginId,
    "user",
    userId,
    rest.join(":"),
  );
}

async function loadAccountProfile(userId: string): Promise<SyncRow[]> {
  const { createCurrentUserRepository, createCurrentRoleRepository } =
    await import("../database/repositories/factory.js");
  const user = await createCurrentUserRepository().findById(userId);
  if (!user) return [];
  const { PermissionManager } = await import("../utils/permission-manager.js");
  const roles = await createCurrentRoleRepository().listUserRoles(userId);
  return [
    {
      syncId: singletonSyncId("accountProfile"),
      remoteUserId: userId,
      username: user.username,
      isAdmin: !!user.isAdmin,
      roles: roles.map((role) => role.roleName).sort(),
      permissions: (
        await PermissionManager.getInstance().getUserPermissions(userId)
      ).sort(),
    },
  ];
}

async function writeAccountProfile(userId: string, wire: SyncRow) {
  const { updateLink } = await import("./client/link-store.js");
  await updateLink({
    remoteUserId: (wire.remoteUserId as string) ?? null,
    remoteUsername: (wire.username as string) ?? null,
    account: {
      remoteUserId: wire.remoteUserId as string,
      username: wire.username as string,
      isAdmin: !!wire.isAdmin,
      roles: (wire.roles as string[]) ?? [],
      permissions: (wire.permissions as string[]) ?? [],
    },
  });
  if (typeof wire.username === "string" && wire.username) {
    const { createCurrentUserRepository } =
      await import("../database/repositories/factory.js");
    const users = createCurrentUserRepository();
    const current = await users.findById(userId);
    if (current && current.username !== wire.username) {
      await users.update(userId, { username: wire.username });
    }
  }
}

/** Host columns a shared copy never carries. */
const SHARED_HOST_DROP = [
  "id",
  "userId",
  "credentialId",
  "rdpCredentialId",
  "vncCredentialId",
  "telnetCredentialId",
  "parentHostId",
  "pluginSettings",
  "quickActions",
  "createdAt",
  "updatedAt",
  "isShared",
  "permissionLevel",
  ...HOST_LOCAL_FIELDS,
];

async function loadSharedHosts(userId: string): Promise<SyncRow[]> {
  const {
    createCurrentRbacAccessRepository,
    createCurrentRoleRepository,
    createCurrentHostResolutionRepository,
    createCurrentUserRepository,
  } = await import("../database/repositories/factory.js");
  const roleIds = await createCurrentRoleRepository().listUserRoleIds(userId);
  const entries =
    await createCurrentRbacAccessRepository().listVisibleHostAccessEntries(
      userId,
      roleIds,
    );
  const hostRepository = createCurrentHostResolutionRepository();
  const owned = await hostRepository.listOwnedHostIds(userId);
  const levels = new Map<number, string>();
  for (const entry of entries) {
    if (owned.has(entry.hostId)) continue;
    if (!levels.has(entry.hostId)) {
      levels.set(entry.hostId, entry.permissionLevel);
    }
  }
  if (levels.size === 0) return [];

  const { resolveHostById } = await import("../hosts/host-resolver.js");
  const users = createCurrentUserRepository();
  const ownerNames = new Map<string, string>();
  const rows: SyncRow[] = [];

  for (const [hostId, permissionLevel] of levels) {
    try {
      const host = (await resolveHostById(
        hostId,
        userId,
      )) as unknown as SyncRow | null;
      if (!host || typeof host.syncId !== "string") continue;
      const ownerId = String(host.userId);
      if (!ownerNames.has(ownerId)) {
        ownerNames.set(
          ownerId,
          (await users.findById(ownerId))?.username ?? "",
        );
      }

      const wire: SyncRow = {};
      for (const [field, value] of Object.entries(host)) {
        if (SHARED_HOST_DROP.includes(field)) continue;
        wire[field] =
          value !== null && typeof value === "object"
            ? JSON.stringify(value)
            : value;
      }
      wire.jumpHosts = await jumpHostsToSyncIds(host.jumpHosts);
      wire.syncId = host.syncId;
      wire.shared = {
        hostId,
        owner: ownerNames.get(ownerId) ?? "",
        permissionLevel,
      };
      rows.push(wire);
    } catch (error) {
      syncLogger.warn("Could not include a shared host in sync", {
        operation: "sync_shared_host",
        hostId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return rows;
}

async function jumpHostsToSyncIds(value: unknown): Promise<string | null> {
  const list = Array.isArray(value) ? value : [];
  if (list.length === 0) return null;
  const { createCurrentHostRepository } =
    await import("../database/repositories/factory.js");
  const repository = createCurrentHostRepository();
  const mapped = [];
  for (const item of list) {
    const hostId = (item as { hostId?: unknown })?.hostId;
    if (typeof hostId !== "number") continue;
    const target = await repository.findById(hostId);
    if (target?.syncId) mapped.push({ ...item, hostId: target.syncId });
  }
  return JSON.stringify(mapped);
}

async function loadSharedCredentials(userId: string): Promise<SyncRow[]> {
  const {
    createCurrentCredentialAccessRepository,
    createCurrentCredentialRepository,
    createCurrentRoleRepository,
    createCurrentUserRepository,
  } = await import("../database/repositories/factory.js");
  const roleIds = await createCurrentRoleRepository().listUserRoleIds(userId);
  const grants =
    await createCurrentCredentialAccessRepository().listSharedWithUser(
      userId,
      roleIds,
    );
  if (grants.length === 0) return [];
  const { findUsableCredential } =
    await import("../hosts/usable-credential.js");
  const credentials = createCurrentCredentialRepository();
  const users = createCurrentUserRepository();
  const rows: SyncRow[] = [];
  for (const grant of grants) {
    try {
      const row = (await credentials.findById(
        grant.credentialId,
      )) as SyncRow | null;
      const usable = (await findUsableCredential(
        grant.credentialId,
        userId,
      )) as unknown as SyncRow | null;
      if (!row || !usable || typeof row.syncId !== "string") continue;
      rows.push({
        syncId: row.syncId,
        name: row.name,
        description: row.description ?? null,
        tags: row.tags ?? null,
        authType: usable.authType,
        username: usable.username ?? null,
        password: usable.password ?? null,
        privateKey: usable.privateKey ?? null,
        keyPassword: usable.keyPassword ?? null,
        keyType: usable.keyType ?? null,
        publicKey: usable.publicKey ?? null,
        certPublicKey: usable.certPublicKey ?? null,
        shared: {
          credentialId: grant.credentialId,
          owner: (await users.findById(grant.ownerId))?.username ?? "",
          permissionLevel: grant.permissionLevel,
        },
      });
    } catch (error) {
      syncLogger.warn("Could not include a shared credential in sync", {
        operation: "sync_shared_credential",
        credentialId: grant.credentialId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return rows;
}

/** Stores a read-only copy of something shared with the linked account. */
async function writeSharedCopy(
  entityType: "hosts" | "sshCredentials",
  userId: string,
  wire: SyncRow,
): Promise<void> {
  const { getEntity } = await import("../plugins/sync-registry.js");
  const { writeWireRow, createResolvers } = await import("./store.js");
  const entity = getEntity(entityType);
  if (!entity) return;
  const { shared, ...rest } = wire;
  await writeWireRow(entity, userId, rest, createResolvers(userId), {
    sharedSource: JSON.stringify(shared ?? {}),
  });
}

async function eraseSharedCopy(
  entityType: "hosts" | "sshCredentials",
  userId: string,
  syncId: string,
): Promise<void> {
  const { getEntity } = await import("../plugins/sync-registry.js");
  const { deleteStoredRow, findStoredRow } = await import("./store.js");
  const entity = getEntity(entityType);
  if (!entity) return;
  const row = await findStoredRow(entity, userId, syncId);
  if (!row?.sharedSource) return;
  await deleteStoredRow(entity, userId, syncId);
}
