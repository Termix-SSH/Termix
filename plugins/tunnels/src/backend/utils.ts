import { buildTunnelName } from "../shared/tunnel-naming.js";
import type { TunnelConfig, TunnelErrorType } from "./types.js";

export function classifyTunnelError(errorMessage: string): TunnelErrorType {
  if (!errorMessage) return "UNKNOWN";

  const message = errorMessage.toLowerCase();

  if (
    message.includes("closed by remote host") ||
    message.includes("connection reset by peer") ||
    message.includes("connection refused") ||
    message.includes("broken pipe")
  ) {
    return "NETWORK_ERROR";
  }

  if (
    message.includes("authentication failed") ||
    message.includes("authentication methods failed") ||
    message.includes("permission denied") ||
    message.includes("incorrect password")
  ) {
    return "AUTHENTICATION_FAILED";
  }

  if (
    message.includes("connect etimedout") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("keepalive timeout")
  ) {
    return "TIMEOUT";
  }

  if (
    message.includes("bind: address already in use") ||
    message.includes("failed for listen port") ||
    message.includes("port forwarding failed")
  ) {
    return "CONNECTION_FAILED";
  }

  if (message.includes("permission") || message.includes("access denied")) {
    return "CONNECTION_FAILED";
  }

  return "UNKNOWN";
}

/** The name a host's saved tunnel runs under. See shared/tunnel-naming.ts. */
export const normalizeTunnelName = buildTunnelName;

export function getTunnelMode(
  tunnelConfig: Pick<TunnelConfig, "mode" | "tunnelType">,
): "local" | "remote" | "dynamic" {
  return tunnelConfig.mode || tunnelConfig.tunnelType || "remote";
}

export function getTunnelScope(
  tunnelConfig: Pick<TunnelConfig, "scope">,
): "s2s" | "c2s" {
  return tunnelConfig.scope || "s2s";
}

export function getTunnelBindHost(
  tunnelConfig: Pick<TunnelConfig, "bindHost">,
): string {
  return tunnelConfig.bindHost || "127.0.0.1";
}

export function parseTunnelName(tunnelName: string): {
  hostId?: number;
  tunnelIndex?: number;
  displayName: string;
  sourcePort: string;
  endpointHost: string;
  endpointPort: string;
  isLegacyFormat: boolean;
} {
  const parts = tunnelName.split("::");

  if (parts.length === 6) {
    return {
      hostId: parseInt(parts[0]),
      tunnelIndex: parseInt(parts[1]),
      displayName: parts[2],
      sourcePort: parts[3],
      endpointHost: parts[4],
      endpointPort: parts[5],
      isLegacyFormat: false,
    };
  }

  const legacyParts = tunnelName.split("_");
  return {
    displayName: legacyParts[0] || "unknown",
    sourcePort: legacyParts[legacyParts.length - 3] || "0",
    endpointHost: legacyParts[legacyParts.length - 2] || "unknown",
    endpointPort: legacyParts[legacyParts.length - 1] || "0",
    isLegacyFormat: true,
  };
}

export function validateTunnelConfig(
  tunnelName: string,
  tunnelConfig: Pick<
    TunnelConfig,
    | "sourceHostId"
    | "tunnelIndex"
    | "sourcePort"
    | "endpointHost"
    | "endpointPort"
  >,
): boolean {
  const parsed = parseTunnelName(tunnelName);

  if (parsed.isLegacyFormat) {
    return true;
  }

  return (
    parsed.hostId === tunnelConfig.sourceHostId &&
    parsed.tunnelIndex === tunnelConfig.tunnelIndex &&
    String(parsed.sourcePort) === String(tunnelConfig.sourcePort) &&
    parsed.endpointHost === tunnelConfig.endpointHost &&
    String(parsed.endpointPort) === String(tunnelConfig.endpointPort)
  );
}

/**
 * Tunnel names beginning with this prefix are reserved for forward() tunnels
 * (web endpoints): they are opened on demand and never retried on disconnect.
 * A user-supplied name using the prefix would silently lose its own retry
 * behaviour and could collide with a live forward, so POST /connect rejects
 * it.
 */
export const RESERVED_TUNNEL_NAME_PREFIX = "web:";

export function isReservedTunnelName(tunnelName: string): boolean {
  return tunnelName.startsWith(RESERVED_TUNNEL_NAME_PREFIX);
}

/** The exact inverse of parseReservedTunnelName. */
export function buildWebEndpointTunnelName(
  hostId: number,
  endpointId: string,
): string {
  return `${RESERVED_TUNNEL_NAME_PREFIX}${hostId}:${endpointId}`;
}

/**
 * Recovers the host id and endpoint id from a reserved name, so a route that
 * only has the name can still check ownership.
 *
 * Returns null for anything that is not a reserved name or whose host id is
 * not a positive integer. Callers must treat null as "cannot verify" and deny.
 * The endpoint id is everything after the first ":" following the host id,
 * so it may contain colons itself.
 */
export function parseReservedTunnelName(
  tunnelName: string,
): { hostId: number; endpointId: string } | null {
  if (!isReservedTunnelName(tunnelName)) return null;

  const rest = tunnelName.slice(RESERVED_TUNNEL_NAME_PREFIX.length);
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex === -1) return null;

  const hostIdPart = rest.slice(0, separatorIndex);
  const endpointId = rest.slice(separatorIndex + 1);
  if (!/^[0-9]+$/.test(hostIdPart) || !endpointId) return null;

  const hostId = Number(hostIdPart);
  if (!Number.isInteger(hostId) || hostId < 1) return null;

  return { hostId, endpointId };
}

type EndpointHostLike = {
  id: number | string;
  name?: string | null;
  ip: string;
  username?: string | null;
};

/** Matches a saved endpointHost string against a host id, name, ip or user@ip. */
export function findHostByTunnelEndpoint<T extends EndpointHostLike>(
  hosts: T[],
  endpointHost?: string | null,
): T | undefined {
  const value = endpointHost?.trim();
  if (!value) return undefined;

  return hosts.find((host) => {
    const userAtIp = host.username ? `${host.username}@${host.ip}` : "";
    return (
      String(host.id) === value ||
      host.name === value ||
      host.ip === value ||
      userAtIp === value
    );
  });
}

export function isSingleHostTunnel(
  tunnelConfig: Pick<
    TunnelConfig,
    | "endpointHost"
    | "endpointIP"
    | "sourceIP"
    | "endpointSSHPort"
    | "sourceSSHPort"
    | "endpointHostId"
    | "sourceHostId"
  >,
): boolean {
  if (!tunnelConfig.endpointHost && !tunnelConfig.endpointIP) return true;
  if (
    tunnelConfig.endpointHost === "127.0.0.1" ||
    tunnelConfig.endpointHost === "localhost"
  ) {
    return true;
  }
  if (
    tunnelConfig.endpointHostId !== undefined &&
    tunnelConfig.endpointHostId === tunnelConfig.sourceHostId
  ) {
    return true;
  }
  if (
    tunnelConfig.endpointIP &&
    tunnelConfig.endpointIP === tunnelConfig.sourceIP &&
    tunnelConfig.endpointSSHPort === tunnelConfig.sourceSSHPort
  ) {
    return true;
  }
  return false;
}

/**
 * Direct tunnels ride the source connection alone. Anything else needs a
 * second SSH leg to a Termix endpoint host, reached through the source.
 */
export function shouldEstablishDirectTunnel(
  tunnelConfig: TunnelConfig,
): boolean {
  if (isSingleHostTunnel(tunnelConfig)) return true;
  const mode = getTunnelMode(tunnelConfig);
  return mode !== "remote" && tunnelConfig.endpointHostId === undefined;
}

export function resolveS2SLocalTargetHost(tunnelConfig: TunnelConfig): string {
  const targetHost = tunnelConfig.targetHost?.trim();

  if (
    !targetHost ||
    targetHost === tunnelConfig.endpointHost ||
    targetHost === tunnelConfig.hostName
  ) {
    return "127.0.0.1";
  }

  return targetHost;
}
