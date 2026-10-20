/**
 * Recent activity is a provider: core owns the callers (the dashboard routes,
 * ctx.hosts.recordActivity, the cleanup when a user or host goes away) and one
 * provider owns the storage. A plugin registers with
 * ctx.hosts.activity.provide. With none, nothing is recorded and the list is
 * empty. Core checks that the user may reach the host before it records.
 */

export interface ActivityEntry {
  id: number;
  userId: string;
  type: string;
  hostId: number;
  hostName: string | null;
  timestamp: string;
}

export type RecordActivityResult =
  | { status: "logged"; id: number }
  | { status: "rate_limited" }
  | { status: "invalid_type" }
  | { status: "denied" }
  | { status: "unavailable" };

export interface ActivityProvider {
  record(
    userId: string,
    entry: { type: string; hostId: number; hostName: string },
  ): Promise<RecordActivityResult>;
  list(userId: string, limit: number): Promise<ActivityEntry[]>;
  deleteByUserId(userId: string): Promise<void>;
  deleteByHostIds(hostIds: number[]): Promise<void>;
}

let plugged: { pluginId: string; provider: ActivityProvider } | null = null;

export function provideActivity(
  pluginId: string,
  provider: ActivityProvider,
): () => void {
  if (plugged) {
    throw new Error(
      `Recent activity is already provided by plugin "${plugged.pluginId}"`,
    );
  }
  const entry = { pluginId, provider };
  plugged = entry;
  return () => {
    if (plugged === entry) plugged = null;
  };
}

function active(): ActivityProvider | null {
  return plugged?.provider ?? null;
}

async function canReachHost(userId: string, hostId: number): Promise<boolean> {
  const {
    createCurrentHostResolutionRepository,
    createCurrentRbacAccessRepository,
    createCurrentRoleRepository,
  } = await import("../database/repositories/factory.js");
  if (
    await createCurrentHostResolutionRepository().isHostOwnedByUser(
      hostId,
      userId,
    )
  ) {
    return true;
  }
  const roleIds = await createCurrentRoleRepository().listUserRoleIds(userId);
  const shared =
    await createCurrentRbacAccessRepository().listVisibleHostAccessEntries(
      userId,
      roleIds,
    );
  return shared.some((access) => access.hostId === hostId);
}

/** What the rest of core calls. */
export const recentActivity = {
  async record(
    userId: string,
    entry: { type: string; hostId: number; hostName: string },
  ): Promise<RecordActivityResult> {
    const provider = active();
    if (!provider) return { status: "unavailable" };
    if (!(await canReachHost(userId, entry.hostId))) {
      return { status: "denied" };
    }
    return provider.record(userId, entry);
  },
  async list(userId: string, limit: number): Promise<ActivityEntry[]> {
    return (await active()?.list(userId, limit)) ?? [];
  },
  async deleteByUserId(userId: string): Promise<void> {
    await active()?.deleteByUserId(userId);
  },
  async deleteByHostId(hostId: number): Promise<void> {
    await active()?.deleteByHostIds([hostId]);
  },
  async deleteByHostIds(hostIds: number[]): Promise<void> {
    await active()?.deleteByHostIds(hostIds);
  },
};
