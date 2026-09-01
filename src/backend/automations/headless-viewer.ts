import { statsLogger } from "../utils/logger.js";
import { listAutomationWatchedHosts } from "./triggers.js";

/**
 * Keeps metric collection running for hosts an automation watches.
 *
 * Heavy metric collection is normally started by a UI viewer and stops when
 * the last one leaves, which means threshold rules only ever evaluated while
 * somebody had the host open. Automations register a synthetic viewer instead
 * of bypassing that mechanism, so a real viewer arriving or leaving still
 * behaves exactly as before.
 *
 * The catch is `cleanupInactiveViewers`, which drops any viewer whose
 * heartbeat is older than 120s. Without the heartbeat below, headless polling
 * would quietly stop two minutes after it started.
 */

export interface ViewerRegistry {
  registerViewer(hostId: number, sessionId: string, userId: string): void;
  unregisterViewer(hostId: number, sessionId: string): void;
  updateHeartbeat(sessionId: string): boolean;
}

const SESSION_PREFIX = "automation:";

let registry: ViewerRegistry | null = null;
const registered = new Map<number, string>();

export function setViewerRegistry(next: ViewerRegistry | null): void {
  registry = next;
}

export function automationSessionId(hostId: number): string {
  return `${SESSION_PREFIX}${hostId}`;
}

/**
 * Brings the set of synthetic viewers in line with what the enabled
 * automations currently watch, and heartbeats the ones that stay.
 */
export async function reconcileHeadlessViewers(): Promise<{
  added: number;
  removed: number;
  active: number;
}> {
  if (!registry) return { added: 0, removed: 0, active: 0 };

  let watched: Map<number, string>;
  try {
    watched = await listAutomationWatchedHosts();
  } catch {
    return { added: 0, removed: 0, active: registered.size };
  }

  let added = 0;
  let removed = 0;

  for (const [hostId, userId] of watched) {
    const sessionId = automationSessionId(hostId);
    if (registered.has(hostId)) {
      // Refresh before the 120s reaper would take it.
      registry.updateHeartbeat(sessionId);
      continue;
    }

    try {
      registry.registerViewer(hostId, sessionId, userId);
      registered.set(hostId, userId);
      added++;
    } catch (error) {
      statsLogger.warn("Could not start headless metrics for a host", {
        operation: "automation_headless_register_error",
        hostId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const hostId of [...registered.keys()]) {
    if (watched.has(hostId)) continue;
    try {
      registry.unregisterViewer(hostId, automationSessionId(hostId));
    } catch {
      // Already gone; drop it either way.
    }
    registered.delete(hostId);
    removed++;
  }

  return { added, removed, active: registered.size };
}

/** Drops every synthetic viewer, for shutdown and tests. */
export function releaseHeadlessViewers(): void {
  if (registry) {
    for (const hostId of registered.keys()) {
      try {
        registry.unregisterViewer(hostId, automationSessionId(hostId));
      } catch {
        // Nothing useful to do during teardown.
      }
    }
  }
  registered.clear();
}
