/**
 * A personal login for a shared host that stays on this desktop. It points at
 * a credential kept on the device only, so nothing reaches the server. Device
 * logins live in the same override tables as server ones, but on the desktop
 * those tables are local and never sync. They come first on the desktop.
 */

import { and, eq } from "drizzle-orm";
import { hosts, sshCredentials } from "../database/db/schema.js";
import {
  createCurrentRepositoryContext,
  createCurrentSharedFolderAuthOverrideRepository,
  createCurrentSharedHostAuthOverrideRepository,
} from "../database/repositories/factory.js";
import type { HostResolutionCredentialRecord } from "../database/repositories/host-resolution-repository.js";
import { findUsableCredential } from "./usable-credential.js";
import type { AuthOverrideProtocol } from "../../types/auth-protocols.js";

export function deviceLoginsAvailable(): boolean {
  return process.env.ELECTRON_EMBEDDED === "true";
}

async function deviceCredential(
  credentialId: number,
  userId: string,
): Promise<HostResolutionCredentialRecord | null> {
  const credential = await findUsableCredential(credentialId, userId);
  return credential?.localOnly ? credential : null;
}

/** The device login for a shared host's copy, the host's own before its folder's. */
export async function resolveDeviceLogin(
  host: Record<string, unknown>,
  userId: string,
  protocol: AuthOverrideProtocol,
): Promise<HostResolutionCredentialRecord | null> {
  if (!deviceLoginsAvailable() || !host.sharedSource) return null;
  const own =
    await createCurrentSharedHostAuthOverrideRepository().findCredentialId(
      Number(host.id),
      userId,
      protocol,
    );
  if (own) {
    const credential = await deviceCredential(own, userId);
    if (credential) return credential;
  }
  const folder =
    await createCurrentSharedFolderAuthOverrideRepository().findClosest(
      userId,
      host.folder as string | null | undefined,
      protocol,
    );
  return folder ? deviceCredential(folder.credentialId, userId) : null;
}

/** The device only credentials a user can pick from. */
export async function listDeviceCredentials(
  userId: string,
): Promise<Array<{ id: number; name: string; username: string | null }>> {
  return createCurrentRepositoryContext()
    .drizzle.select({
      id: sshCredentials.id,
      name: sshCredentials.name,
      username: sshCredentials.username,
    })
    .from(sshCredentials)
    .where(
      and(
        eq(sshCredentials.userId, userId),
        eq(sshCredentials.localOnly, true),
      ),
    );
}

/** A device login must connect from here: the server has never seen it. */
export async function connectFromDevice(
  userId: string,
  matches: (host: { id: number; folder: string | null }) => boolean,
): Promise<void> {
  const { drizzle } = createCurrentRepositoryContext();
  const rows = await drizzle
    .select({
      id: hosts.id,
      folder: hosts.folder,
      sharedSource: hosts.sharedSource,
    })
    .from(hosts)
    .where(eq(hosts.userId, userId));
  for (const row of rows) {
    if (!row.sharedSource || !matches(row)) continue;
    await drizzle
      .update(hosts)
      .set({ connectionOrigin: "local" })
      .where(eq(hosts.id, row.id));
  }
}
