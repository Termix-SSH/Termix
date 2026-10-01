/**
 * The desktop's link to a server, one row in sync_link. Secrets (the session
 * token, proxy headers, basic auth) are stored encrypted with the system key.
 */

import { eq } from "drizzle-orm";
import { syncLink } from "../../database/db/schema.js";
import { createCurrentRepositoryContext } from "../../database/repositories/factory.js";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import {
  decryptSystemSecret,
  encryptSystemSecret,
} from "../../utils/system-secret-crypto.js";

export type LinkStatus =
  "idle" | "syncing" | "offline" | "error" | "signed_out";

export interface LinkAccount {
  remoteUserId?: string;
  username?: string;
  isAdmin?: boolean;
  roles?: string[];
  permissions?: string[];
}

export interface ProxyHeader {
  name: string;
  value: string;
}

export interface BasicAuth {
  username: string;
  password: string;
}

export interface SyncLink {
  id: number;
  userId: string;
  serverUrl: string;
  serverName: string | null;
  serverVersion: string | null;
  sessionToken: string | null;
  customHeaders: ProxyHeader[];
  basicAuth: BasicAuth | null;
  allowInvalidCertificate: boolean;
  remoteUserId: string | null;
  remoteUsername: string | null;
  account: LinkAccount | null;
  /** Entity types switched off on this device. */
  disabledTypes: string[];
  /** Entity types this device has fully pulled at least once. */
  knownTypes: string[];
  cursor: number;
  status: LinkStatus;
  lastError: string | null;
  linkedAt: string;
  lastSyncAt: string | null;
}

type Row = typeof syncLink.$inferSelect;

function db() {
  return createCurrentRepositoryContext().drizzle;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function decryptJson<T>(value: string | null, fallback: T): Promise<T> {
  if (!value) return fallback;
  try {
    return JSON.parse(await decryptSystemSecret(value)) as T;
  } catch {
    return fallback;
  }
}

async function fromRow(row: Row): Promise<SyncLink> {
  let sessionToken: string | null = null;
  if (row.sessionToken) {
    try {
      sessionToken = await decryptSystemSecret(row.sessionToken);
    } catch {
      sessionToken = null;
    }
  }
  const scope = parseJson<{ disabled?: string[] }>(row.scope, {});
  return {
    id: row.id,
    userId: row.userId,
    serverUrl: row.serverUrl,
    serverName: row.serverName,
    serverVersion: row.serverVersion,
    sessionToken,
    customHeaders: await decryptJson<ProxyHeader[]>(row.customHeaders, []),
    basicAuth: await decryptJson<BasicAuth | null>(row.basicAuth, null),
    allowInvalidCertificate: !!row.allowInvalidCertificate,
    remoteUserId: row.remoteUserId,
    remoteUsername: row.remoteUsername,
    account: parseJson<LinkAccount | null>(row.account, null),
    disabledTypes: Array.isArray(scope.disabled) ? scope.disabled : [],
    knownTypes: parseJson<string[]>(row.knownTypes, []),
    cursor: Number(row.cursor) || 0,
    status: (row.status as LinkStatus) || "idle",
    lastError: row.lastError,
    linkedAt: row.linkedAt,
    lastSyncAt: row.lastSyncAt,
  };
}

export async function getLink(): Promise<SyncLink | null> {
  const [row] = await db().select().from(syncLink).limit(1);
  return row ? fromRow(row) : null;
}

export interface NewLink {
  userId: string;
  serverUrl: string;
  serverName?: string | null;
  serverVersion?: string | null;
  sessionToken: string;
  customHeaders?: ProxyHeader[];
  basicAuth?: BasicAuth | null;
  allowInvalidCertificate?: boolean;
  remoteUserId?: string | null;
  remoteUsername?: string | null;
}

export async function createLink(link: NewLink): Promise<SyncLink> {
  await db().delete(syncLink);
  await db()
    .insert(syncLink)
    .values({
      userId: link.userId,
      serverUrl: link.serverUrl,
      serverName: link.serverName ?? null,
      serverVersion: link.serverVersion ?? null,
      sessionToken: await encryptSystemSecret(link.sessionToken),
      customHeaders: link.customHeaders?.length
        ? await encryptSystemSecret(JSON.stringify(link.customHeaders))
        : null,
      basicAuth: link.basicAuth
        ? await encryptSystemSecret(JSON.stringify(link.basicAuth))
        : null,
      allowInvalidCertificate: !!link.allowInvalidCertificate,
      remoteUserId: link.remoteUserId ?? null,
      remoteUsername: link.remoteUsername ?? null,
      cursor: 0,
      status: "idle",
      knownTypes: "[]",
      linkedAt: new Date().toISOString(),
    });
  await DatabaseSaveTrigger.forceSave("sync_link");
  return (await getLink())!;
}

export interface LinkPatch {
  serverName?: string | null;
  serverVersion?: string | null;
  sessionToken?: string | null;
  customHeaders?: ProxyHeader[];
  basicAuth?: BasicAuth | null;
  allowInvalidCertificate?: boolean;
  remoteUserId?: string | null;
  remoteUsername?: string | null;
  account?: LinkAccount | null;
  disabledTypes?: string[];
  knownTypes?: string[];
  cursor?: number;
  status?: LinkStatus;
  lastError?: string | null;
  lastSyncAt?: string | null;
}

export async function updateLink(patch: LinkPatch): Promise<SyncLink | null> {
  const current = await getLink();
  if (!current) return null;
  const set: Partial<Row> = {};
  if (patch.serverName !== undefined) set.serverName = patch.serverName;
  if (patch.serverVersion !== undefined)
    set.serverVersion = patch.serverVersion;
  if (patch.sessionToken !== undefined) {
    set.sessionToken = patch.sessionToken
      ? await encryptSystemSecret(patch.sessionToken)
      : null;
  }
  if (patch.customHeaders !== undefined) {
    set.customHeaders = patch.customHeaders.length
      ? await encryptSystemSecret(JSON.stringify(patch.customHeaders))
      : null;
  }
  if (patch.basicAuth !== undefined) {
    set.basicAuth = patch.basicAuth
      ? await encryptSystemSecret(JSON.stringify(patch.basicAuth))
      : null;
  }
  if (patch.allowInvalidCertificate !== undefined) {
    set.allowInvalidCertificate = patch.allowInvalidCertificate;
  }
  if (patch.remoteUserId !== undefined) set.remoteUserId = patch.remoteUserId;
  if (patch.remoteUsername !== undefined) {
    set.remoteUsername = patch.remoteUsername;
  }
  if (patch.account !== undefined) {
    set.account = patch.account ? JSON.stringify(patch.account) : null;
  }
  if (patch.disabledTypes !== undefined) {
    set.scope = JSON.stringify({ disabled: patch.disabledTypes });
  }
  if (patch.knownTypes !== undefined) {
    set.knownTypes = JSON.stringify(patch.knownTypes);
  }
  if (patch.cursor !== undefined) set.cursor = patch.cursor;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.lastError !== undefined) set.lastError = patch.lastError;
  if (patch.lastSyncAt !== undefined) set.lastSyncAt = patch.lastSyncAt;
  if (Object.keys(set).length > 0) {
    await db().update(syncLink).set(set).where(eq(syncLink.id, current.id));
    DatabaseSaveTrigger.triggerSave("sync_link");
  }
  return getLink();
}

export async function deleteLink(): Promise<void> {
  await db().delete(syncLink);
  await DatabaseSaveTrigger.forceSave("sync_link");
}
