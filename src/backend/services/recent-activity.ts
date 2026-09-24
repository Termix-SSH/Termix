import {
  createCurrentHostResolutionRepository,
  createCurrentRbacAccessRepository,
  createCurrentRecentActivityRepository,
  createCurrentRoleRepository,
} from "../database/repositories/factory.js";
import { dashboardLogger } from "../utils/logger.js";

const RATE_LIMIT_MS = 1000;
const activityRateLimiter = new Map<string, number>();

export const RECENT_ACTIVITY_TYPES = [
  "terminal",
  "file_manager",
  "server_stats",
  "tunnel",
  "docker",
  "telnet",
  "vnc",
  "rdp",
] as const;

export type RecordActivityResult =
  | { status: "logged"; id: number }
  | { status: "rate_limited" }
  | { status: "invalid_type" }
  | { status: "denied" };

/**
 * Adds one recent activity entry: the dashboard's /activity/log route and
 * ctx.hosts.recordActivity both come through here, so the rate limit and the
 * access rule are the same for both.
 */
export async function recordRecentActivity(
  userId: string,
  entry: { type: string; hostId: number; hostName: string },
): Promise<RecordActivityResult> {
  const { type, hostId, hostName } = entry;
  if (!(RECENT_ACTIVITY_TYPES as readonly string[]).includes(type)) {
    return { status: "invalid_type" };
  }

  const rateLimitKey = `${userId}:${hostId}:${type}`;
  const now = Date.now();
  const lastLogged = activityRateLimiter.get(rateLimitKey);
  if (lastLogged && now - lastLogged < RATE_LIMIT_MS) {
    return { status: "rate_limited" };
  }
  activityRateLimiter.set(rateLimitKey, now);

  if (activityRateLimiter.size > 10000) {
    for (const [key, timestamp] of activityRateLimiter.entries()) {
      if (now - timestamp > RATE_LIMIT_MS * 2) activityRateLimiter.delete(key);
    }
  }

  const isOwnedHost =
    await createCurrentHostResolutionRepository().isHostOwnedByUser(
      hostId,
      userId,
    );
  if (!isOwnedHost) {
    const roleIds = await createCurrentRoleRepository().listUserRoleIds(userId);
    const sharedHosts =
      await createCurrentRbacAccessRepository().listVisibleHostAccessEntries(
        userId,
        roleIds,
      );
    if (!sharedHosts.some((access) => access.hostId === hostId)) {
      return { status: "denied" };
    }
  }

  const result = await createCurrentRecentActivityRepository().create({
    userId,
    type,
    hostId,
    hostName,
  });

  // Best-effort trim; a failure here must not fail the log itself.
  try {
    await createCurrentRecentActivityRepository().trimUserActivity(userId, 100);
  } catch (trimErr) {
    dashboardLogger.warn("Failed to trim recent_activity (non-fatal)", {
      operation: "trim_recent_activity",
      userId,
      error: trimErr instanceof Error ? trimErr.message : String(trimErr),
    });
  }

  return { status: "logged", id: result.id };
}
