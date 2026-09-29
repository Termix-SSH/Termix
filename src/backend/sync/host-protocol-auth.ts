/**
 * A host's plugin protocol logins over sync. They travel on the host row as
 * `protocolAuth`, keyed by protocol id, with the owner's secrets decrypted
 * for the wire like the host's own and a credential named by its syncId.
 */

import type { SyncRow } from "@termix/plugin-sdk/backend";
import type { HostProtocolLogin } from "../database/repositories/host-protocol-auth-repository.js";
import {
  fromPortableLogin,
  listProtocolLogins,
  replaceProtocolLogins,
  toPortableLogins,
} from "../hosts/protocol-auth/protocol-auth.js";
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
