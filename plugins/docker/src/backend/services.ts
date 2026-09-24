import type { Client } from "ssh2";
import type { PluginContext, PluginSshHost } from "@termix/plugin-sdk/backend";
import { containerCommand } from "./container-runtime.js";
import {
  PS_STATE_FORMAT,
  diffContainerStates,
  parseContainerStates,
  type ContainerState,
  type DockerEventName,
} from "./container-state.js";
import { readDockerHostSettings } from "./host-settings.js";
import { execOnClient } from "./sessions.js";
import { listFormat, parseContainerList } from "./routes.js";
import {
  CONTAINER_ID_RE,
  getErrorMessage,
  type DockerLogger,
} from "./helpers.js";

export const POOL = "docker";
const TICK_MS = 15_000;
const POLL_INTERVAL_MS = 60_000;
const HOST_CACHE_MS = 5 * 60_000;

export interface DockerContainerSummary {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  created: string;
}

export type DockerContainerAction =
  "start" | "stop" | "restart" | "pause" | "unpause" | "remove";

const ACTIONS: DockerContainerAction[] = [
  "start",
  "stop",
  "restart",
  "pause",
  "unpause",
  "remove",
];

/** The "docker.containers" service, version 1. Runs as the caller's user. */
export interface DockerServiceV1 {
  listContainers: (
    hostId: number,
    options?: { all?: boolean },
  ) => Promise<DockerContainerSummary[]>;
  action: (
    hostId: number,
    container: string,
    action: DockerContainerAction,
  ) => Promise<void>;
}

export interface DockerEvent {
  hostId: number;
  container: string;
  event: DockerEventName;
}

/** The "docker.events" service, version 1. Runs as the caller's user. */
export interface DockerEventsV1 {
  /**
   * Calls `listener` for container state changes on a host, polled about
   * once a minute as the subscribing user. Subscribing the same listener
   * again is a no-op, so a consumer can re-subscribe on a timer and pick up
   * a restarted docker plugin. Resolves to an unsubscribe function.
   */
  subscribe: (
    hostId: number,
    listener: (event: DockerEvent) => void,
  ) => Promise<() => void>;
}

function actorOf(ctx: PluginContext): string {
  const userId = ctx.currentActor();
  if (!userId) throw new Error("The docker service needs a calling user");
  return userId;
}

export function registerServices(ctx: PluginContext, log: DockerLogger): void {
  const runOnHost = async <T>(
    hostId: number,
    command: (runtime: "docker" | "podman") => string,
    handle: (output: string) => T,
  ): Promise<T> => {
    const { runtime } = await readDockerHostSettings(ctx, hostId);
    const output = await ctx.ssh.withConnection<string, Client>(
      hostId,
      { pool: POOL, purpose: "docker" },
      (client) => execOnClient(client, command(runtime)),
    );
    return handle(output);
  };

  ctx.services.provide<DockerServiceV1>("docker.containers", {
    listContainers: async (hostId, options) => {
      actorOf(ctx);
      const all = options?.all !== false;
      return runOnHost(
        hostId,
        (runtime) =>
          containerCommand(
            runtime,
            `ps ${all ? "-a " : ""}--format ${listFormat(false)}`,
          ),
        (output) =>
          parseContainerList(output) as unknown as DockerContainerSummary[],
      );
    },
    action: async (hostId, container, action) => {
      actorOf(ctx);
      if (!CONTAINER_ID_RE.test(container)) {
        throw new Error("Invalid container name");
      }
      if (!ACTIONS.includes(action)) {
        throw new Error(`Unknown container action: ${action}`);
      }
      const args =
        action === "remove" ? `rm ${container}` : `${action} ${container}`;
      await runOnHost(
        hostId,
        (runtime) => containerCommand(runtime, args),
        () => undefined,
      );
    },
  });

  interface Watch {
    userId: string;
    hostId: number;
    listeners: Set<(event: DockerEvent) => void>;
    snapshot?: Map<string, ContainerState>;
    host?: { value: PluginSshHost; at: number };
    lastPolledAt: number;
    failing: boolean;
  }
  const watches = new Map<string, Watch>();
  ctx.disposables.add(() => watches.clear());

  const hostFor = async (watch: Watch): Promise<PluginSshHost | null> => {
    if (watch.host && Date.now() - watch.host.at < HOST_CACHE_MS) {
      return watch.host.value;
    }
    const host = await ctx.asUser(watch.userId, () =>
      ctx.ssh.resolveHost(watch.hostId),
    );
    watch.host = host ? { value: host, at: Date.now() } : undefined;
    return host;
  };

  const pollOne = async (watch: Watch) => {
    try {
      const host = await hostFor(watch);
      if (!host) throw new Error("Host not found");
      const { runtime } = await readDockerHostSettings(ctx, watch.hostId);
      const output = await ctx.ssh.withConnection<string, Client>(
        host,
        { pool: POOL, purpose: "docker" },
        (client) =>
          execOnClient(
            client,
            containerCommand(runtime, `ps -a --format ${PS_STATE_FORMAT}`),
          ),
      );
      const current = parseContainerStates(output);
      const previous = watch.snapshot;
      watch.snapshot = current;
      watch.failing = false;
      if (!previous) return;
      for (const { container, event } of diffContainerStates(
        previous,
        current,
      )) {
        for (const listener of [...watch.listeners]) {
          try {
            listener({ hostId: watch.hostId, container, event });
          } catch (error) {
            log.warn("Docker event listener failed", {
              hostId: watch.hostId,
              error: getErrorMessage(error),
            });
          }
        }
      }
    } catch (error) {
      // Docker missing, the host down or the owner's data locked. A later
      // success is a first observation again rather than a diff.
      watch.snapshot = undefined;
      watch.host = undefined;
      if (!watch.failing) {
        log.warn("Docker event poll failed", {
          hostId: watch.hostId,
          error: getErrorMessage(error),
        });
      }
      watch.failing = true;
    }
  };

  ctx.schedule.every(TICK_MS, async () => {
    const now = Date.now();
    for (const watch of [...watches.values()]) {
      if (now - watch.lastPolledAt < POLL_INTERVAL_MS) continue;
      watch.lastPolledAt = now;
      await pollOne(watch);
    }
  });

  ctx.events.on("host.updated", (payload) => {
    const { hostId } = payload as { hostId?: number };
    if (!hostId) return;
    ctx.ssh.dropPooled(POOL, hostId);
    for (const watch of watches.values()) {
      if (watch.hostId === hostId) watch.host = undefined;
    }
  });
  ctx.events.on("host.deleted", (payload) => {
    const { hostId } = payload as { hostId?: number };
    if (!hostId) return;
    for (const [key, watch] of watches) {
      if (watch.hostId === hostId) watches.delete(key);
    }
  });

  ctx.services.provide<DockerEventsV1>("docker.events", {
    subscribe: async (hostId, listener) => {
      const userId = actorOf(ctx);
      const key = `${userId}:${hostId}`;
      let watch = watches.get(key);
      if (!watch) {
        watch = {
          userId,
          hostId,
          listeners: new Set(),
          lastPolledAt: 0,
          failing: false,
        };
        watches.set(key, watch);
      }
      watch.listeners.add(listener);
      const current = watch;
      return () => {
        current.listeners.delete(listener);
        if (current.listeners.size === 0 && watches.get(key) === current) {
          watches.delete(key);
        }
      };
    },
  });
}
