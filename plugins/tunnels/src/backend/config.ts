import type {
  PluginContext,
  PluginHostSummary,
} from "@termix/plugin-sdk/backend";
import type {
  TunnelConfig,
  TunnelConnectRequest,
  TunnelConnection,
} from "./types.js";
import { serverTunnelName } from "../shared/tunnel-naming.js";
import {
  findHostByTunnelEndpoint,
  getTunnelMode,
  isSingleHostTunnel,
  parseTunnelName,
} from "./utils.js";

export function hostLabel(host: {
  name?: string | null;
  username: string;
  ip: string;
}): string {
  return host.name || `${host.username}@${host.ip}`;
}

/** The name a host's saved tunnel runs under. */
export function savedTunnelName(
  host: PluginHostSummary,
  index: number,
  connection: Pick<
    TunnelConnection,
    "sourcePort" | "endpointHost" | "endpointPort"
  >,
): string {
  return serverTunnelName(host, index, connection);
}

/**
 * Builds the runtime config for a tunnel from what the client or a host's
 * saved list says about it. Credentials are never part of it: both legs
 * resolve theirs through ctx.ssh as `userId`.
 */
export function buildTunnelConfig(
  host: PluginHostSummary,
  request: Omit<TunnelConnectRequest, "sourceHostId">,
  userId: string,
): TunnelConfig {
  const mode = getTunnelMode(request);
  return {
    name: request.name,
    scope: request.scope || "s2s",
    mode,
    tunnelType: request.tunnelType || (mode === "remote" ? "remote" : "local"),
    bindHost: request.bindHost,
    targetHost: request.targetHost,
    sourceHostId: host.id,
    tunnelIndex: request.tunnelIndex,
    requestingUserId: userId,
    hostName: hostLabel(host),
    sourceIP: host.ip,
    sourceSSHPort: host.port,
    sourceUsername: host.username,
    endpointHost: (request.endpointHost ?? "").trim(),
    sourcePort: Number(request.sourcePort),
    endpointPort: Number(request.endpointPort),
    maxRetries: Number(request.maxRetries) || 3,
    retryInterval: (Number(request.retryInterval) || 5) * 1000,
    autoStart: Boolean(request.autoStart),
  };
}

export function connectionToRequest(
  host: PluginHostSummary,
  index: number,
  connection: TunnelConnection,
): Omit<TunnelConnectRequest, "sourceHostId"> {
  return {
    name: savedTunnelName(host, index, connection),
    tunnelIndex: index,
    scope: connection.scope || "s2s",
    mode: connection.mode,
    tunnelType: connection.tunnelType,
    bindHost: connection.bindHost,
    targetHost: connection.targetHost,
    endpointHost: connection.endpointHost,
    sourcePort: connection.sourcePort,
    endpointPort: connection.endpointPort,
    maxRetries: connection.maxRetries,
    retryInterval: connection.retryInterval,
    autoStart: connection.autoStart,
  };
}

/**
 * Fills in the endpoint leg from the user's own host list. A local or
 * dynamic tunnel whose endpoint is not a saved host just forwards to that
 * address through the source; a remote tunnel needs a real SSH host there.
 * Must run as the tunnel's user.
 */
export async function resolveEndpoint(
  ctx: PluginContext,
  config: TunnelConfig,
): Promise<TunnelConfig> {
  if (isSingleHostTunnel(config)) return config;

  const hosts = await ctx.hosts.list();
  const endpoint = findHostByTunnelEndpoint(hosts, config.endpointHost);

  if (!endpoint) {
    if (getTunnelMode(config) === "remote") {
      throw new Error(
        `Endpoint host '${config.endpointHost}' not found in database`,
      );
    }
    return { ...config, endpointIP: config.endpointIP || config.endpointHost };
  }

  const access = await ctx.hosts.checkAccess(endpoint.id, "connect");
  if (!access.hasAccess) throw new Error("Endpoint host not found");

  return {
    ...config,
    endpointHostId: endpoint.id,
    endpointIP: endpoint.ip,
    endpointSSHPort: endpoint.port,
    endpointUsername: endpoint.username,
  };
}

/** A host's saved tunnel list, as its host setting holds it. */
export function readTunnelConnections(value: unknown): TunnelConnection[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? (parsed as TunnelConnection[]) : [];
}

/**
 * The saved tunnel a name points at, for starting one by name alone
 * (automations). Must run as the user it is for.
 */
export async function findSavedTunnel(
  ctx: PluginContext,
  name: string,
): Promise<{
  host: PluginHostSummary;
  index: number;
  connection: TunnelConnection;
} | null> {
  const parsed = parseTunnelName(name);
  if (parsed.isLegacyFormat || parsed.hostId === undefined) return null;
  const index = parsed.tunnelIndex ?? -1;

  const host = await ctx.hosts.get(parsed.hostId);
  if (!host) return null;
  if (!(await ctx.settings.getHost<boolean>(host.id, "enableTunnel"))) {
    return null;
  }

  const connections = readTunnelConnections(
    await ctx.settings.getHost(host.id, "tunnelConnections"),
  );
  const connection = connections[index];
  if (!connection) return null;
  if (savedTunnelName(host, index, connection) !== name) return null;
  return { host, index, connection };
}
