import type { AutomationDefinition } from "../../../../src/types/automations.js";
import { createCurrentAutomationRepository } from "../../../../src/backend/database/repositories/factory.js";
import { subscribeDockerEvents, type DockerEvent } from "./docker.js";
import { onDockerEvent } from "./triggers.js";

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

const watches = new Map<string, Watch>();

const keyOf = (hostId: number, userId: string) => `${userId}:${hostId}`;

/** Hosts named by an enabled docker_event trigger, with the owning user. */
export async function listDockerWatchedHosts(): Promise<Map<number, string>> {
  const watched = new Map<number, string>();

  try {
    const rows = await createCurrentAutomationRepository().listAllEnabled();
    for (const row of rows) {
      let definition: AutomationDefinition;
      try {
        definition = JSON.parse(row.definition) as AutomationDefinition;
      } catch {
        continue;
      }

      const trigger = definition.trigger;
      if (trigger?.kind !== "docker_event") continue;

      const selector = trigger.hostSelector;
      if (selector?.kind === "host") {
        watched.set(selector.hostId, row.userId);
      } else if (selector?.kind === "hosts") {
        for (const hostId of selector.hostIds) watched.set(hostId, row.userId);
      }
      // Fleet and "all" selectors are deliberately not expanded: watching
      // every host a user owns for container state is far too costly.
    }
  } catch {
    return watched;
  }

  return watched;
}

/** Brings the subscriptions in line with the watched hosts. */
export async function reconcileDockerWatch(
  now: number = Date.now(),
  watched?: Map<number, string>,
): Promise<void> {
  const wanted = watched ?? (await listDockerWatchedHosts());
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
          void onDockerEvent({
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
    try {
      watch.unsubscribe = await subscribeDockerEvents(
        userId,
        hostId,
        watch.listener,
      );
      watch.subscribedAt = watch.unsubscribe ? now : 0;
    } catch {
      watch.subscribedAt = 0;
    }
  }
}

/** Drops every subscription, for shutdown and tests. */
export function resetDockerWatcher(): void {
  for (const watch of watches.values()) watch.unsubscribe?.();
  watches.clear();
}
