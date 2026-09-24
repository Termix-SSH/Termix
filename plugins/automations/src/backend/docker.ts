import type { PluginServices } from "@termix/plugin-sdk/backend";

let current: PluginServices | null = null;

/** Set in activate, cleared on deactivate. */
export function setDockerServices(services: PluginServices | null): void {
  current = services;
}

export type DockerEventName = "exited" | "started" | "unhealthy" | "restarting";

export interface DockerEvent {
  hostId: number;
  container: string;
  event: DockerEventName;
}

/** The docker plugin's "docker.containers" service, version 1. */
interface DockerService {
  action: (
    hostId: number,
    container: string,
    action: "start" | "stop" | "restart",
  ) => Promise<void>;
}

/** The docker plugin's "docker.events" service, version 1. */
interface DockerEventsService {
  subscribe: (
    hostId: number,
    listener: (event: DockerEvent) => void,
  ) => Promise<() => void>;
}

const UNAVAILABLE = "The docker plugin is not available";

function service<T extends object>(
  name: string,
  userId: string,
): Partial<T> | null {
  try {
    return current?.get<T>(name, { userId }) ?? null;
  } catch {
    return null;
  }
}

/**
 * Starts, stops or restarts a container as userId. Optional: without the
 * docker plugin the step fails with a clear message.
 */
export async function runDockerAction(
  userId: string,
  hostId: number,
  container: string,
  action: "start" | "stop" | "restart",
): Promise<{ ok: boolean; unavailable?: boolean; error?: string }> {
  const docker = service<DockerService>("docker.containers", userId);
  if (!docker || typeof docker.action !== "function") {
    return { ok: false, unavailable: true, error: UNAVAILABLE };
  }
  try {
    await docker.action(hostId, container, action);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Subscribes `listener` to container changes on a host as userId, or
 * resolves null while the docker plugin is off.
 */
export async function subscribeDockerEvents(
  userId: string,
  hostId: number,
  listener: (event: DockerEvent) => void,
): Promise<(() => void) | null> {
  const events = service<DockerEventsService>("docker.events", userId);
  if (!events || typeof events.subscribe !== "function") return null;
  return events.subscribe(hostId, listener);
}
