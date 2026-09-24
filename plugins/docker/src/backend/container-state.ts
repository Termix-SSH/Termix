/**
 * Container state snapshots and the events two of them imply, for the
 * docker.events service.
 *
 * Events come from diffing successive `ps -a` snapshots, so the poll interval
 * is the resolution: a container that stops and starts between two polls is
 * not reported. That is the tradeoff for not holding a `docker events` stream
 * open against every watched host.
 */

export interface ContainerState {
  /** Docker's own state word: running, exited, restarting, ... */
  state: string;
  /** Health from the status text, when the image declares a healthcheck. */
  unhealthy: boolean;
}

export type DockerEventName = "exited" | "started" | "unhealthy" | "restarting";

export const PS_STATE_FORMAT = `'{"name":"{{.Names}}","state":"{{.State}}","status":"{{.Status}}"}'`;

/** Parses `ps -a --format PS_STATE_FORMAT` output, one JSON object per line. */
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
 * The events a pair of snapshots implies. A container missing from the
 * previous snapshot counts as newly seen rather than started, so the first
 * poll after a restart does not replay every running container.
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
