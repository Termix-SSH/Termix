/**
 * Host defaults over sync.
 *
 * A user's own and folder defaults travel as one row per key. A value that
 * names a row by local id (the credential in an auth default, the hosts in a
 * jump chain, a plugin's own ids) travels by syncId and is translated back on
 * the other side. The server's admin defaults reach a linked desktop as one
 * read-only snapshot, so the desktop resolves a host the way its server does.
 */

import { and, eq } from "drizzle-orm";
import type { SyncRow } from "@termix/plugin-sdk/backend";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { hosts, sshCredentials, sshFolders } from "../database/db/schema.js";
import {
  createCurrentHostDefaultsRepository,
  createCurrentRepositoryContext,
  createCurrentSettingsRepository,
} from "../database/repositories/factory.js";
import { consume } from "../plugins/registry.js";
import {
  CORE_NAMESPACE,
  joinDefaultKey,
  splitDefaultKey,
} from "../../types/host-defaults.js";
import {
  decodeDefaultValue,
  encodeDefaultValue,
  REMOTE_ADMIN_DEFAULTS_KEY,
} from "../hosts/defaults/levels.js";
import type { PluginHostSettingsSync } from "./host-plugin-settings.js";
import { singletonSyncId } from "./wire.js";

type IdMapper = (id: number) => Promise<string | null>;
type SyncIdMapper = (syncId: string) => Promise<number | null>;

function db() {
  return createCurrentRepositoryContext().drizzle;
}

async function credentialSyncId(id: number): Promise<string | null> {
  const [row] = await db()
    .select({ syncId: sshCredentials.syncId })
    .from(sshCredentials)
    .where(eq(sshCredentials.id, id))
    .limit(1);
  return row?.syncId ?? null;
}

async function hostSyncId(id: number): Promise<string | null> {
  const [row] = await db()
    .select({ syncId: hosts.syncId })
    .from(hosts)
    .where(eq(hosts.id, id))
    .limit(1);
  return row?.syncId ?? null;
}

function localCredential(userId: string): SyncIdMapper {
  return async (syncId) => {
    const [row] = await db()
      .select({ id: sshCredentials.id })
      .from(sshCredentials)
      .where(
        and(
          eq(sshCredentials.syncId, syncId),
          eq(sshCredentials.userId, userId),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  };
}

function localHost(userId: string): SyncIdMapper {
  return async (syncId) => {
    const [row] = await db()
      .select({ id: hosts.id })
      .from(hosts)
      .where(and(eq(hosts.syncId, syncId), eq(hosts.userId, userId)))
      .limit(1);
    return row?.id ?? null;
  };
}

function hostSettingsHook(
  pluginId: string,
): PluginHostSettingsSync | undefined {
  return consume<PluginHostSettingsSync>(`${pluginId}.hostSettingsSync`);
}

/** A value on its way out: local ids become syncIds. */
export async function exportDefaultValue(
  namespace: string,
  key: string,
  value: unknown,
  maps: { credential: IdMapper; host: IdMapper } = {
    credential: credentialSyncId,
    host: hostSyncId,
  },
): Promise<unknown> {
  if (namespace !== CORE_NAMESPACE) {
    const hook = hostSettingsHook(namespace);
    return hook?.exportValue ? hook.exportValue(key, value) : value;
  }
  if (key === "auth" && value && typeof value === "object") {
    const auth = value as Record<string, unknown>;
    if (typeof auth.credentialId !== "number") return value;
    const { credentialId, ...rest } = auth;
    return { ...rest, credentialSyncId: await maps.credential(credentialId) };
  }
  if (key === "jumpHosts" && Array.isArray(value)) {
    const mapped = [];
    for (const entry of value) {
      const hostId = Number((entry as { hostId?: unknown })?.hostId);
      const syncId = Number.isInteger(hostId) ? await maps.host(hostId) : null;
      if (syncId) mapped.push({ hostSyncId: syncId });
    }
    return mapped;
  }
  return value;
}

/** A value on its way in: syncIds become this side's ids. */
export async function importDefaultValue(
  namespace: string,
  key: string,
  value: unknown,
  maps: { credential: SyncIdMapper; host: SyncIdMapper },
): Promise<unknown> {
  if (namespace !== CORE_NAMESPACE) {
    const hook = hostSettingsHook(namespace);
    return hook?.importValue ? hook.importValue(key, value) : value;
  }
  if (key === "auth" && value && typeof value === "object") {
    const auth = value as Record<string, unknown>;
    if (typeof auth.credentialSyncId !== "string") return value;
    const { credentialSyncId, ...rest } = auth;
    return { ...rest, credentialId: await maps.credential(credentialSyncId) };
  }
  if (key === "jumpHosts" && Array.isArray(value)) {
    const mapped = [];
    for (const entry of value) {
      const syncId = (entry as { hostSyncId?: unknown })?.hostSyncId;
      const hostId =
        typeof syncId === "string" ? await maps.host(syncId) : null;
      if (hostId !== null) mapped.push({ hostId });
    }
    return mapped;
  }
  return value;
}

export async function loadHostDefaults(userId: string): Promise<SyncRow[]> {
  const repository = createCurrentHostDefaultsRepository();
  const rows = await repository.listOwnedBy(userId);
  const folderSyncIds = new Map<number, string>();
  const folders = await db()
    .select({
      id: sshFolders.id,
      syncId: sshFolders.syncId,
      localOnly: sshFolders.localOnly,
    })
    .from(sshFolders)
    .where(eq(sshFolders.userId, userId));
  for (const folder of folders) {
    if (folder.syncId && !folder.localOnly) {
      folderSyncIds.set(folder.id, folder.syncId);
    }
  }

  const result: SyncRow[] = [];
  for (const row of rows) {
    const fullKey = joinDefaultKey(row.namespace, row.key);
    let syncId: string;
    let folderSyncId: string | null = null;
    if (row.level === "user") {
      syncId = `u:${fullKey}`;
    } else if (row.level === "folder" && row.folderId !== null) {
      const folder = folderSyncIds.get(row.folderId);
      if (!folder) continue;
      folderSyncId = folder;
      syncId = `f:${folder}:${fullKey}`;
    } else {
      continue;
    }
    result.push({
      syncId,
      level: row.level,
      folderSyncId,
      namespace: row.namespace,
      key: row.key,
      value: await exportDefaultValue(
        row.namespace,
        row.key,
        decodeDefaultValue(row.value),
      ),
    });
  }
  return result;
}

/** Splits "u:<ns.key>" or "f:<folderSyncId>:<ns.key>". */
export function parseHostDefaultsSyncId(syncId: string): {
  level: "user" | "folder";
  folderSyncId: string | null;
  fullKey: string;
} | null {
  if (syncId.startsWith("u:")) {
    return { level: "user", folderSyncId: null, fullKey: syncId.slice(2) };
  }
  if (syncId.startsWith("f:")) {
    const rest = syncId.slice(2);
    const colon = rest.indexOf(":");
    if (colon <= 0) return null;
    return {
      level: "folder",
      folderSyncId: rest.slice(0, colon),
      fullKey: rest.slice(colon + 1),
    };
  }
  return null;
}

async function folderIdFor(
  userId: string,
  folderSyncId: string,
): Promise<number | null> {
  const [row] = await db()
    .select({ id: sshFolders.id })
    .from(sshFolders)
    .where(
      and(eq(sshFolders.syncId, folderSyncId), eq(sshFolders.userId, userId)),
    )
    .limit(1);
  return row?.id ?? null;
}

async function scopeFor(
  userId: string,
  parsed: NonNullable<ReturnType<typeof parseHostDefaultsSyncId>>,
) {
  if (parsed.level === "user") return { level: "user" as const, userId };
  const folderId = parsed.folderSyncId
    ? await folderIdFor(userId, parsed.folderSyncId)
    : null;
  if (folderId === null) return null;
  return { level: "folder" as const, userId, folderId };
}

export async function writeHostDefault(
  userId: string,
  wire: SyncRow,
): Promise<void> {
  const parsed = parseHostDefaultsSyncId(String(wire.syncId));
  if (!parsed) return;
  const scope = await scopeFor(userId, parsed);
  if (!scope) return;
  const [namespace, key] = splitDefaultKey(parsed.fullKey);
  const value = await importDefaultValue(namespace, key, wire.value, {
    credential: localCredential(userId),
    host: localHost(userId),
  });
  await createCurrentHostDefaultsRepository().apply(
    scope,
    [{ namespace, key, value: encodeDefaultValue(value) }],
    [],
    null,
  );
  await afterSyncedLevelChange(userId);
}

export async function eraseHostDefault(
  userId: string,
  syncId: string,
): Promise<void> {
  const parsed = parseHostDefaultsSyncId(syncId);
  if (!parsed) return;
  const scope = await scopeFor(userId, parsed);
  if (!scope) return;
  const [namespace, key] = splitDefaultKey(parsed.fullKey);
  await createCurrentHostDefaultsRepository().apply(
    scope,
    [],
    [{ namespace, key }],
    null,
  );
  await afterSyncedLevelChange(userId);
}

/**
 * A level a desktop pushed changes what the server's hosts resolve to. On a
 * desktop the hosts arrive already resolved, so nothing runs there.
 */
async function afterSyncedLevelChange(userId: string): Promise<void> {
  const { getLink } = await import("./client/link-store.js");
  if (await getLink().catch(() => null)) return;
  const { recompute } = await import("../hosts/defaults/recompute.js");
  void recompute({ userIds: [userId] }).catch(() => {});
}

export function coversHostDefault(
  syncId: string,
  activeManifest: (pluginId: string) => PluginManifest | undefined,
): boolean {
  const parsed = parseHostDefaultsSyncId(syncId);
  if (!parsed) return false;
  const [namespace] = splitDefaultKey(parsed.fullKey);
  return namespace === CORE_NAMESPACE || !!activeManifest(namespace);
}

export async function loadAdminDefaults(): Promise<SyncRow[]> {
  const rows = await createCurrentHostDefaultsRepository().listScope({
    level: "admin",
  });
  const values: Record<string, unknown> = {};
  for (const row of rows) {
    values[joinDefaultKey(row.namespace, row.key)] = decodeDefaultValue(
      row.value,
    );
  }
  return [{ syncId: singletonSyncId("hostDefaultsAdmin"), values }];
}

export async function writeAdminDefaults(
  _userId: string,
  wire: SyncRow,
): Promise<void> {
  const values =
    wire.values && typeof wire.values === "object" ? wire.values : {};
  await createCurrentSettingsRepository().set(
    REMOTE_ADMIN_DEFAULTS_KEY,
    JSON.stringify(values),
  );
}
