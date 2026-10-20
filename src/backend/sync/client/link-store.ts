/**
 * The desktop's links to servers, one row each in sync_link and at most one
 * per local user, since each link has its own replica user. Secrets (the
 * session token, proxy headers, basic auth) are stored encrypted with the
 * system key. Without a user, a call means the active account's link.
 */

import { createSecureContext } from "node:tls";
import { eq } from "drizzle-orm";
import { getActiveUserId } from "../accounts.js";
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

/** A PFX/P12 client certificate for servers that require mutual TLS. */
export interface ClientCert {
  /** Base64 of the PFX/P12 file. */
  pfx: string;
  passphrase: string;
  name: string | null;
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
  clientCert: ClientCert | null;
  remoteUserId: string | null;
  remoteUsername: string | null;
  account: LinkAccount | null;
  /** Entity types switched off on this device. */
  disabledTypes: string[];
  /** Extra connection options for this server, kept open for new ones. */
  options: Record<string, unknown>;
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
  const scope = parseJson<{
    disabled?: string[];
    options?: Record<string, unknown>;
    clientCert?: string;
  }>(row.scope, {});
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
    clientCert: await decryptJson<ClientCert | null>(
      scope.clientCert ?? null,
      null,
    ),
    remoteUserId: row.remoteUserId,
    remoteUsername: row.remoteUsername,
    account: parseJson<LinkAccount | null>(row.account, null),
    disabledTypes: Array.isArray(scope.disabled) ? scope.disabled : [],
    options:
      scope.options && typeof scope.options === "object" ? scope.options : {},
    knownTypes: parseJson<string[]>(row.knownTypes, []),
    cursor: Number(row.cursor) || 0,
    status: (row.status as LinkStatus) || "idle",
    lastError: row.lastError,
    linkedAt: row.linkedAt,
    lastSyncAt: row.lastSyncAt,
  };
}

export async function listLinks(): Promise<SyncLink[]> {
  const rows = await db().select().from(syncLink);
  return Promise.all(rows.map(fromRow));
}

/** The link of one local user, or of the active account when none is given. */
export async function getLink(userId?: string): Promise<SyncLink | null> {
  const owner = userId ?? (await getActiveUserId());
  if (!owner) return null;
  const [row] = await db()
    .select()
    .from(syncLink)
    .where(eq(syncLink.userId, owner))
    .limit(1);
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
  clientCert?: ClientCert | null;
  remoteUserId?: string | null;
  remoteUsername?: string | null;
}

/** Throws when the PFX is unreadable or the passphrase is wrong. */
export function assertClientCert(cert: ClientCert): void {
  try {
    createSecureContext({
      pfx: Buffer.from(cert.pfx, "base64"),
      passphrase: cert.passphrase,
    });
  } catch {
    throw new Error("The client certificate or its passphrase is not valid");
  }
}

async function sealScope(
  disabled: string[],
  options: Record<string, unknown>,
  clientCert: ClientCert | null,
): Promise<string> {
  return JSON.stringify({
    disabled,
    options,
    ...(clientCert
      ? { clientCert: await encryptSystemSecret(JSON.stringify(clientCert)) }
      : {}),
  });
}

export async function createLink(link: NewLink): Promise<SyncLink> {
  if (link.clientCert) assertClientCert(link.clientCert);
  await db().delete(syncLink).where(eq(syncLink.userId, link.userId));
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
      scope: link.clientCert ? await sealScope([], {}, link.clientCert) : null,
      remoteUserId: link.remoteUserId ?? null,
      remoteUsername: link.remoteUsername ?? null,
      cursor: 0,
      status: "idle",
      knownTypes: "[]",
      linkedAt: new Date().toISOString(),
    });
  await DatabaseSaveTrigger.forceSave("sync_link");
  return (await getLink(link.userId))!;
}

export interface LinkPatch {
  serverName?: string | null;
  serverVersion?: string | null;
  sessionToken?: string | null;
  customHeaders?: ProxyHeader[];
  basicAuth?: BasicAuth | null;
  allowInvalidCertificate?: boolean;
  clientCert?: ClientCert | null;
  remoteUserId?: string | null;
  remoteUsername?: string | null;
  account?: LinkAccount | null;
  disabledTypes?: string[];
  options?: Record<string, unknown>;
  knownTypes?: string[];
  cursor?: number;
  status?: LinkStatus;
  lastError?: string | null;
  lastSyncAt?: string | null;
}

export async function updateLink(
  patch: LinkPatch,
  userId?: string,
): Promise<SyncLink | null> {
  const current = await getLink(userId);
  if (!current) return null;
  if (patch.clientCert) assertClientCert(patch.clientCert);
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
  if (
    patch.disabledTypes !== undefined ||
    patch.options !== undefined ||
    patch.clientCert !== undefined
  ) {
    set.scope = await sealScope(
      patch.disabledTypes ?? current.disabledTypes,
      patch.options ?? current.options,
      patch.clientCert === undefined ? current.clientCert : patch.clientCert,
    );
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
  return getLink(current.userId);
}

export async function deleteLink(userId?: string): Promise<void> {
  const owner = userId ?? (await getActiveUserId());
  if (!owner) return;
  await db().delete(syncLink).where(eq(syncLink.userId, owner));
  await DatabaseSaveTrigger.forceSave("sync_link");
}
