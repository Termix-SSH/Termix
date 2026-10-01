import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { Deps } from "./deps.js";

/**
 * Keeps metric collection running for hosts an automation watches.
 *
 * Host metrics only polls hosts somebody is looking at. Automations register
 * as a viewer through the host-metrics.viewers service, as the automation's
 * owner, and heartbeat every tick so the viewer is not reaped. A heartbeat
 * that comes back false means host-metrics restarted and forgot the viewer,
 * so the next tick registers it again.
 */

interface Registered {
  userId: string;
  viewerSessionId: string;
}

export function createHeadlessViewers(
  ctx: Pick<PluginContext, "asUser" | "log">,
  deps: Pick<Deps, "viewers">,
  watchedHosts: () => Promise<Map<number, string>>,
) {
  const registered = new Map<number, Registered>();

  async function release(hostId: number, entry: Registered): Promise<void> {
    registered.delete(hostId);
    const unregister = deps.viewers().unregister;
    if (typeof unregister !== "function") return;
    try {
      await ctx.asUser(entry.userId, () =>
        unregister(hostId, entry.viewerSessionId),
      );
    } catch {
      // Already gone; drop it either way.
    }
  }

  return {
    /** Brings the viewers in line with what the automations watch. */
    async reconcile(): Promise<{ added: number; removed: number }> {
      const viewers = deps.viewers();
      if (typeof viewers.register !== "function") {
        // host-metrics is off: its viewers went with it.
        registered.clear();
        return { added: 0, removed: 0 };
      }

      const watched = await watchedHosts();
      let added = 0;
      let removed = 0;

      for (const [hostId, entry] of [...registered]) {
        if (watched.get(hostId) === entry.userId) continue;
        await release(hostId, entry);
        removed++;
      }

      for (const [hostId, userId] of watched) {
        const existing = registered.get(hostId);
        if (existing) {
          const alive = await ctx
            .asUser(userId, () => viewers.heartbeat!(existing.viewerSessionId))
            .catch(() => false);
          if (alive) continue;
          registered.delete(hostId);
        }

        try {
          const result = await ctx.asUser(userId, () =>
            viewers.register!(hostId),
          );
          if ("viewerSessionId" in result) {
            registered.set(hostId, {
              userId,
              viewerSessionId: result.viewerSessionId,
            });
            added++;
          }
        } catch (error) {
          ctx.log.warn(
            `Could not start headless metrics for host ${hostId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      return { added, removed };
    },

    /** Drops every viewer, on deactivate. */
    async releaseAll(): Promise<void> {
      for (const [hostId, entry] of [...registered]) {
        await release(hostId, entry);
      }
    },

    registeredHosts: () => [...registered.keys()],
  };
}
