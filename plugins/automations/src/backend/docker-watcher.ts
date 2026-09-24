import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { Deps, DockerEvent } from "./deps.js";
import type { DockerEvent as TriggerDockerEvent } from "./triggers.js";

/**
 * Keeps a docker.events subscription for every host a docker_event trigger
 * names, as the automation's owner. The docker plugin does the polling; this
 * only follows which hosts are watched.
 *
 * Subscribing is idempotent on the docker side, so every watched host is
 * subscribed again once a minute. That is what picks the subscriptions back
 * up after the docker plugin is disabled and enabled again.
 */

const RESUBSCRIBE_MS = 60_000;

interface Watch {
  listener: (event: DockerEvent) => void;
  unsubscribe: (() => void) | null;
  subscribedAt: number;
}

export function createDockerWatcher(
  ctx: Pick<PluginContext, "asUser">,
  deps: Pick<Deps, "dockerEvents">,
  watchedHosts: () => Promise<Map<number, string>>,
  onEvent: (event: TriggerDockerEvent) => Promise<void>,
) {
  const watches = new Map<string, Watch>();
  const keyOf = (hostId: number, userId: string) => `${userId}:${hostId}`;

  return {
    /** Brings the subscriptions in line with the watched hosts. */
    async reconcile(now: number = Date.now()): Promise<void> {
      const wanted = await watchedHosts();
      const wantedKeys = new Set(
        [...wanted].map(([hostId, userId]) => keyOf(hostId, userId)),
      );

      for (const [key, watch] of watches) {
        if (wantedKeys.has(key)) continue;
        watch.unsubscribe?.();
        watches.delete(key);
      }

      for (const [hostId, userId] of wanted) {
        const key = keyOf(hostId, userId);
        let watch = watches.get(key);
        if (!watch) {
          watch = {
            listener: (event) => {
              void onEvent({
                hostId: event.hostId,
                ownerUserId: userId,
                container: event.container,
                event: event.event,
              }).catch(() => undefined);
            },
            unsubscribe: null,
            subscribedAt: 0,
          };
          watches.set(key, watch);
        }
        if (watch.subscribedAt && now - watch.subscribedAt < RESUBSCRIBE_MS) {
          continue;
        }
        const subscribe = deps.dockerEvents().subscribe;
        if (typeof subscribe !== "function") {
          watch.subscribedAt = 0;
          continue;
        }
        try {
          const current = watch;
          watch.unsubscribe = await ctx.asUser(userId, () =>
            subscribe(hostId, current.listener),
          );
          watch.subscribedAt = now;
        } catch {
          watch.subscribedAt = 0;
        }
      }
    },

    /** Drops every subscription, on deactivate. */
    reset(): void {
      for (const watch of watches.values()) watch.unsubscribe?.();
      watches.clear();
    },
  };
}
