import {
  createCurrentHostRepository,
  createCurrentHostResolutionRepository,
  createCurrentRbacAccessRepository,
  createCurrentRecentActivityRepository,
  createCurrentSshCredentialUsageRepository,
} from "../database/repositories/factory.js";
import { pluginEvents, TOPICS } from "../plugins/events.js";
import { sshLogger } from "../utils/logger.js";
import { emitInternalEvent } from "./internal-events.js";

export interface DeletedHost {
  id: number;
  name: string;
}

/**
 * Deletes a host the user owns, with everything that hangs off it. Shared by
 * the host editor's delete route and ctx.hosts.delete, so a plugin deleting a
 * host leaves exactly what a person deleting it would. Null when the host
 * does not exist or is not the user's.
 */
export async function deleteOwnedHost(
  userId: string,
  hostId: number,
): Promise<DeletedHost | null> {
  const host =
    await createCurrentHostResolutionRepository().findHostByIdForUser(
      hostId,
      userId,
    );
  if (!host) return null;

  // Plugin rows tied to a host cascade on their refHost() foreign keys.
  await createCurrentSshCredentialUsageRepository().deleteByHostId(hostId);
  await createCurrentRecentActivityRepository().deleteByHostId(hostId);
  await createCurrentRbacAccessRepository().deleteHostAccessForHost(hostId);
  await createCurrentHostRepository().deleteForUser(userId, hostId);

  const name = host.name ?? host.ip;
  emitInternalEvent("host_deleted", userId, hostId, { name });

  try {
    pluginEvents.emit(TOPICS.hostDeleted, { hostId, userId });
  } catch (err) {
    sshLogger.warn("Failed to publish host deletion event", {
      operation: "host_delete",
      hostId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { id: hostId, name };
}
