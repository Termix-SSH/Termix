import type { AutomationDefinition } from "../../types/automations.js";
import { createCurrentAutomationRepository } from "../database/repositories/factory.js";
import { resolveHostById } from "../hosts/host-resolver.js";
import { DataCrypto } from "../utils/data-crypto.js";
import { execCommand } from "../hosts/metrics/widgets/common-utils.js";
import {
  createFleetSshFactory,
  getFleetPoolKey,
} from "../hosts/ssh-client-factory.js";
import { withConnection } from "../hosts/ssh-connection-pool.js";
import { statsLogger } from "../utils/logger.js";
import { onDockerEvent } from "./triggers.js";

/**
 * Container state polling for docker_event triggers.
 *
 * Everything else Docker-related in the backend hangs off an interactive
 * session that only exists while somebody has the UI open, so a trigger built
 * on it would only ever fire while being watched. This polls over the same
 * pooled SSH connection the other automation steps use, and only for hosts a
 * docker_event trigger actually names, so an install with no such automation
 * does no extra work at all.
 *
 * Events are derived by diffing successive snapshots: the poll interval is the
 * resolution, so a container that stops and starts between two polls is not
 * reported. That is the tradeoff for not holding a `docker events` stream open
 * against every host.
 */

const POLL_INTERVAL_MS = 60_000;
const EXEC_TIMEOUT_MS = 15_000;

interface ContainerState {
  /** Docker's own state word: running, exited, restarting, ... */
  state: string;
  /** Health from the status text, when the image declares a healthcheck. */
  unhealthy: boolean;
}

/** Last snapshot per host, so transitions can be spotted. */
const snapshots = new Map<number, Map<string, ContainerState>>();
const lastPolledAt = new Map<number, number>();

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
      // Fleet and "all" selectors are deliberately not expanded: polling every
      // host a user owns for container state is far too costly to do blindly.
    }
  } catch {
    return watched;
  }

  return watched;
}

/**
 * Parses `docker ps -a` output. One JSON object per line, matching the format
 * string the container routes use.
 */
export function parseContainerStates(
  output: string,
): Map<string, ContainerState> {
  const states = new Map<string, ContainerState>();

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed) as {
        name?: string;
        state?: string;
        status?: string;
      };
      if (!parsed.name) continue;

      states.set(parsed.name, {
        state: (parsed.state ?? "").toLowerCase(),
        unhealthy: /\(unhealthy\)/i.test(parsed.status ?? ""),
      });
    } catch {
      // A partial line is not worth failing the whole poll over.
    }
  }

  return states;
}

/**
 * Works out which events a pair of snapshots implies.
 *
 * A container missing from the previous snapshot is treated as newly seen
 * rather than started, so the first poll after a restart does not replay every
 * running container as a fresh start event.
 */
export function diffContainerStates(
  previous: Map<string, ContainerState>,
  current: Map<string, ContainerState>,
): Array<{ container: string; event: DockerEventName }> {
  const events: Array<{ container: string; event: DockerEventName }> = [];

  for (const [name, now] of current) {
    const before = previous.get(name);
    if (!before) continue;

    if (before.state !== now.state) {
      if (now.state === "exited")
        events.push({ container: name, event: "exited" });
      else if (now.state === "running")
        events.push({ container: name, event: "started" });
      else if (now.state === "restarting")
        events.push({ container: name, event: "restarting" });
    }

    // Health is independent of state: a container can go unhealthy while it
    // stays up, which is exactly the case worth alerting on.
    if (!before.unhealthy && now.unhealthy) {
      events.push({ container: name, event: "unhealthy" });
    }
  }

  return events;
}

export type DockerEventName = "exited" | "started" | "unhealthy" | "restarting";

const PS_FORMAT = `'{"name":"{{.Names}}","state":"{{.State}}","status":"{{.Status}}"}'`;

async function pollHost(hostId: number, userId: string): Promise<void> {
  const host = await resolveHostById(hostId, userId);
  if (!host) {
    snapshots.delete(hostId);
    return;
  }

  const result = await withConnection(
    getFleetPoolKey(host as never),
    createFleetSshFactory(host as never),
    (client) =>
      execCommand(
        client,
        `docker ps -a --format ${PS_FORMAT}`,
        EXEC_TIMEOUT_MS,
      ),
  );

  if (result.code !== 0 && result.code !== null) {
    // Docker missing or not permitted on this host. Drop the snapshot so a
    // later success is treated as a first observation rather than a diff.
    snapshots.delete(hostId);
    return;
  }

  const current = parseContainerStates(result.stdout);
  const previous = snapshots.get(hostId);
  snapshots.set(hostId, current);

  if (!previous) return;

  for (const { container, event } of diffContainerStates(previous, current)) {
    await onDockerEvent({
      hostId,
      ownerUserId: userId,
      container,
      event,
    }).catch(() => undefined);
  }
}

/**
 * Polls every watched host whose interval has elapsed. Called from the
 * automation scheduler tick rather than owning a timer of its own.
 */
export async function pollDockerEvents(
  now: number = Date.now(),
): Promise<void> {
  const watched = await listDockerWatchedHosts();

  for (const hostId of [...snapshots.keys()]) {
    if (!watched.has(hostId)) {
      snapshots.delete(hostId);
      lastPolledAt.delete(hostId);
    }
  }

  for (const [hostId, userId] of watched) {
    const last = lastPolledAt.get(hostId) ?? 0;
    if (now - last < POLL_INTERVAL_MS) continue;
    // Host credentials cannot be decrypted while the owner's key is locked.
    if (!canAccess(userId)) continue;
    lastPolledAt.set(hostId, now);

    try {
      await pollHost(hostId, userId);
    } catch (error) {
      statsLogger.warn("Docker event poll failed", {
        operation: "automation_docker_poll_error",
        hostId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function canAccess(userId: string): boolean {
  try {
    return DataCrypto.canUserAccessData(userId);
  } catch {
    return false;
  }
}

/** Clears cached state, for shutdown and tests. */
export function resetDockerWatcher(): void {
  snapshots.clear();
  lastPolledAt.clear();
}
