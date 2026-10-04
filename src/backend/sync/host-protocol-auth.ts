/**
 * A host's plugin protocol logins over sync. They travel on the host row as
 * `protocolAuth`, keyed by protocol id, with the owner's secrets decrypted
 * for the wire like the host's own and a credential named by its syncId.
 */

import type { SyncRow } from "@termix/plugin-sdk/backend";
import type { HostProtocolLogin } from "../database/repositories/host-protocol-auth-repository.js";
import { createCurrentHostProtocolAuthRepository } from "../database/repositories/factory.js";
import {
  fromPortableLogin,
  listProtocolLogins,
  replaceProtocolLogins,
  resolveRecipientProtocolLogin,
  toPortableLogins,
} from "../hosts/protocol-auth/protocol-auth.js";
import { findHostProtocol } from "../hosts/protocol-auth/registry.js";
import { syncLogger } from "../utils/logger.js";

type ResolveSyncId = (entityType: string, id: number) => Promise<string | null>;
type ResolveId = (entityType: string, syncId: string) => Promise<number | null>;

const CREDENTIALS = "sshCredentials";

export async function exportProtocolLogins(
  hostId: number,
  ownerId: string,
  resolveSyncId: ResolveSyncId,
): Promise<SyncRow> {
  const out: SyncRow = {};
  const portable = toPortableLogins(await listProtocolLogins(hostId, ownerId));
  for (const [protocol, login] of Object.entries(portable)) {
    const { credentialId, ...rest } = login;
    out[protocol] = {
      ...rest,
      credentialSyncId: credentialId
        ? await resolveSyncId(CREDENTIALS, credentialId)
        : null,
    };
  }
  return out;
}

/**
 * The logins a user a host is shared with may use, for their desktop's copy:
 * their own override or the owner's shared snapshot, never the owner's own
 * secret. Each goes as a direct login since its credential is not theirs.
 */
export async function exportSharedProtocolLogins(
  host: Record<string, unknown>,
  userId: string,
): Promise<SyncRow> {
  const out: SyncRow = {};
  const hostId = Number(host.id);
  const rows =
    await createCurrentHostProtocolAuthRepository().listRowsForHost(hostId);
  for (const row of rows) {
    const declared = findHostProtocol(row.protocol);
    if (!declared) continue;
    try {
      const login = await resolveRecipientProtocolLogin(host, userId, declared);
      out[row.protocol] = {
        authType: login.authType === "none" ? "none" : "direct",
        username: login.username || null,
        password: login.password || null,
        fields: Object.fromEntries(
          Object.entries(login.fields).filter(([, value]) => value),
        ),
        credentialSyncId: null,
      };
    } catch (error) {
      syncLogger.warn("Could not include a shared host's protocol login", {
        operation: "sync_shared_host_protocol_auth",
        hostId,
        protocol: row.protocol,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
}

/**
 * Writes what a synced host carried. A row from a peer that sends no
 * protocolAuth leaves the stored logins alone.
 */
export async function importProtocolLogins(
  hostId: number,
  userId: string,
  carried: unknown,
  resolveId: ResolveId | undefined,
): Promise<void> {
  if (!carried || typeof carried !== "object" || Array.isArray(carried)) {
    return;
  }
  try {
    const current = new Map(
      (await listProtocolLogins(hostId, userId)).map((login) => [
        login.protocol,
        login,
      ]),
    );
    const logins: HostProtocolLogin[] = [];
    for (const [protocol, value] of Object.entries(carried)) {
      const syncId = (value as { credentialSyncId?: unknown })
        ?.credentialSyncId;
      let credentialId: number | null = null;
      if (typeof syncId === "string" && syncId) {
        // A credential not here yet keeps whatever the login pointed at.
        credentialId =
          (resolveId ? await resolveId(CREDENTIALS, syncId) : null) ??
          current.get(protocol)?.credentialId ??
          null;
      }
      const login = fromPortableLogin(protocol, value, credentialId);
      if (login) logins.push(login);
    }
    await replaceProtocolLogins(userId, hostId, logins);
  } catch (error) {
    syncLogger.warn("Could not apply a synced host's protocol logins", {
      operation: "sync_host_protocol_auth",
      hostId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
