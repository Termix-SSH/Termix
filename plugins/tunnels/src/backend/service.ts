import type { Client } from "ssh2";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { TunnelConfig, TunnelStatus } from "./types.js";
import type { TunnelManager, TunnelRuntime } from "./manager.js";
import { forwardOut } from "./ssh-primitives.js";
import {
  RESERVED_TUNNEL_NAME_PREFIX,
  isReservedTunnelName,
  parseReservedTunnelName,
} from "./utils.js";
import { authorizeTunnelAction } from "./authorize.js";
import {
  buildTunnelConfig,
  connectionToRequest,
  findSavedTunnel,
  hostLabel,
  resolveEndpoint,
} from "./config.js";

export interface TunnelForwardTarget {
  targetHost: string;
  targetPort: number;
  /** Where the local listener binds. Defaults to 127.0.0.1. */
  bindHost?: string;
  /** A fixed local port. Defaults to one the kernel picks. */
  bindPort?: number;
}

export interface TunnelForwardHandle {
  bindHost: string;
  bindPort: number;
  close: () => Promise<void>;
}

/** What other plugins get from ctx.services.get("tunnels.access"). */
export interface TunnelsAccess {
  /**
   * Opens (or reuses) a local forward to target through a source host and
   * resolves only once it works: connected, listening and the target
   * answered one probe. Rejects with the real reason otherwise.
   */
  forward(
    sourceHostId: number,
    target: TunnelForwardTarget,
    options?: { name?: string; idleTimeoutMs?: number },
  ): Promise<TunnelForwardHandle>;
  /** Starts a saved tunnel by name. Its outcome arrives as status. */
  start(name: string): Promise<void>;
  /** Stops a tunnel by name and holds off its retries. */
  stop(name: string): Promise<void>;
  status(name: string): Promise<TunnelStatus | null>;
  list(): Promise<Record<string, TunnelStatus>>;
}

const TARGET_PROBE_TIMEOUT_MS = 10_000;

/**
 * Opens one channel to the target and closes it again. Without it a forward
 * reports success the moment its listener is up, and the likeliest failure
 * (nothing listening on the target port) only shows up as a blank page.
 */
async function probeTarget(
  client: Client,
  targetHost: string,
  targetPort: number,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const channel = await Promise.race([
      forwardOut(client, targetHost, targetPort),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Timed out reaching the endpoint port")),
          TARGET_PROBE_TIMEOUT_MS,
        );
      }),
    ]);
    try {
      channel.end();
    } catch {
      // Already gone; the probe succeeded either way.
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isPort(value: unknown, allowZero = false): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= (allowZero ? 0 : 1) &&
    value <= 65535
  );
}

export function createTunnelsService(
  ctx: PluginContext,
  manager: TunnelManager,
): TunnelsAccess {
  // What each live forward was opened for, so an edited target reopens it
  // instead of silently forwarding to the old one.
  const fingerprints = new Map<string, string>();

  const actor = (): string => {
    const userId = ctx.currentActor();
    if (!userId) throw new Error("No acting user");
    return userId;
  };

  const handleFor = (
    name: string,
    runtime: TunnelRuntime,
  ): TunnelForwardHandle => ({
    bindHost: runtime.bindHost,
    bindPort: runtime.bindPort,
    close: async () => {
      fingerprints.delete(name);
      await manager.cleanup(name, true);
    },
  });

  const canAccess = (hostId: number) => manager.canAccessHost(actor(), hostId);

  return {
    async forward(sourceHostId, target, options = {}) {
      const userId = actor();
      if (!isPort(target.targetPort)) throw new Error("Invalid target port");
      if (target.bindPort !== undefined && !isPort(target.bindPort, true)) {
        throw new Error("Invalid bind port");
      }
      const targetHost = target.targetHost?.trim();
      if (!targetHost) throw new Error("Invalid target host");

      const access = await ctx.hosts.checkAccess(sourceHostId, "connect");
      const host = access.hasAccess ? await ctx.hosts.get(sourceHostId) : null;
      if (!host) throw new Error("Host not found or access denied");

      const name =
        options.name ??
        `${RESERVED_TUNNEL_NAME_PREFIX}${sourceHostId}:${targetHost}:${target.targetPort}`;
      if (
        !isReservedTunnelName(name) ||
        parseReservedTunnelName(name)?.hostId !== sourceHostId
      ) {
        throw new Error(
          `Forward names must be "${RESERVED_TUNNEL_NAME_PREFIX}<hostId>:<id>" for the source host`,
        );
      }

      const bindHost = target.bindHost?.trim() || "127.0.0.1";
      const fingerprint = JSON.stringify({
        targetHost,
        targetPort: target.targetPort,
        bindHost,
        bindPort: target.bindPort ?? null,
        ip: host.ip,
        sshPort: host.port,
        username: host.username,
      });

      const existing = manager.runtimes.get(name);
      if (existing) {
        const recorded = fingerprints.get(name);
        if (recorded === undefined || recorded === fingerprint) {
          fingerprints.set(name, fingerprint);
          return handleFor(name, existing);
        }
        ctx.log.info(`Reopening tunnel ${name} after its target changed`);
        await manager.cleanup(name, true);
        fingerprints.delete(name);
      }

      const config: TunnelConfig = {
        name,
        scope: "s2s",
        mode: "local",
        tunnelType: "local",
        bindHost,
        targetHost,
        sourceHostId: host.id,
        tunnelIndex: 0,
        requestingUserId: userId,
        hostName: hostLabel(host),
        sourceIP: host.ip,
        sourceSSHPort: host.port,
        sourceUsername: host.username,
        // Loopback marks it single host, which is what picks the
        // listen-here-and-forwardOut path.
        endpointHost: "127.0.0.1",
        sourcePort: target.bindPort ?? 0,
        endpointPort: target.targetPort,
        maxRetries: 0,
        retryInterval: 0,
        autoStart: false,
        idleTimeoutMs: options.idleTimeoutMs,
      };

      manager.manualDisconnects.delete(name);
      try {
        const runtime = await manager.connect(config, 0, {
          throwOnError: true,
        });
        if (!runtime) {
          throw new Error("The tunnel closed before it could be used");
        }
        await probeTarget(runtime.sourceClient, targetHost, target.targetPort);
        fingerprints.set(name, fingerprint);
        return handleFor(name, runtime);
      } catch (error) {
        // Nothing half-built may be handed out on the next call.
        await manager.cleanup(name, true).catch(() => undefined);
        fingerprints.delete(name);
        throw error;
      }
    },

    async start(name) {
      const existing = manager.configs.get(name);
      if (existing) {
        if (!(await canAccess(existing.sourceHostId))) {
          throw new Error(`Tunnel "${name}" is not configured`);
        }
        await manager.start(existing);
        return;
      }

      const saved = await findSavedTunnel(ctx, name);
      if (!saved) throw new Error(`Tunnel "${name}" is not configured`);
      const config = await resolveEndpoint(
        ctx,
        buildTunnelConfig(
          saved.host,
          connectionToRequest(saved.host, saved.index, saved.connection),
          actor(),
        ),
      );
      await manager.start(config);
    },

    async stop(name) {
      const decision = await authorizeTunnelAction(
        canAccess,
        name,
        manager.configs.get(name),
      );
      if (!decision.allowed) throw new Error("Access denied");
      await manager.stop(name);
    },

    async status(name) {
      if (!(await manager.canAccessTunnel(actor(), name))) return null;
      return manager.statuses.get(name) ?? null;
    },

    async list() {
      return manager.statusesFor(actor());
    },
  };
}
