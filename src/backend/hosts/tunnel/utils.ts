import type { ErrorType, TunnelConfig } from "../../../types/index.js";
import { tunnelLogger } from "../../utils/logger.js";

export function classifyTunnelError(errorMessage: string): ErrorType {
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

export function getTunnelMarker(tunnelName: string): string {
  return `TUNNEL_MARKER_${tunnelName.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

export function normalizeTunnelName(
  hostId: number,
  tunnelIndex: number,
  displayName: string,
  sourcePort: number,
  endpointHost: string,
  endpointPort: number,
): string {
  return `${hostId}::${tunnelIndex}::${displayName}::${sourcePort}::${endpointHost}::${endpointPort}`;
}

export function getTunnelMode(
  tunnelConfig: TunnelConfig,
): "local" | "remote" | "dynamic" {
  return tunnelConfig.mode || tunnelConfig.tunnelType || "remote";
}

export function getTunnelScope(tunnelConfig: TunnelConfig): "s2s" | "c2s" {
  return tunnelConfig.scope || "s2s";
}

export function getTunnelBindHost(tunnelConfig: TunnelConfig): string {
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

  tunnelLogger.warn(`Legacy tunnel name format: ${tunnelName}`);

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
  tunnelConfig: TunnelConfig,
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
 * Tunnel names beginning with this prefix are reserved for web endpoint
 * tunnels: they are opened on demand and never retried on disconnect (see the
 * early return in `handleDisconnect`). A user-supplied tunnel name using this
 * prefix would silently disable its own retry/reconnect behaviour, and could
 * collide with a live web endpoint forward -- so the prefix is rejected at the
 * point tunnel names are accepted from a request (the /ssh/tunnel/connect
 * route).
 */
export const RESERVED_TUNNEL_NAME_PREFIX = "web:";

export function isReservedTunnelName(tunnelName: string): boolean {
  return tunnelName.startsWith(RESERVED_TUNNEL_NAME_PREFIX);
}

/**
 * The exact inverse of `parseReservedTunnelName`. Routes that open or close a
 * web endpoint tunnel must call this rather than composing the string inline,
 * so the two can never drift apart.
 */
export function buildWebEndpointTunnelName(
  hostId: number,
  endpointId: string,
): string {
  return `${RESERVED_TUNNEL_NAME_PREFIX}${hostId}:${endpointId}`;
}

/**
 * Recovers the host id and endpoint id encoded in a web endpoint tunnel name,
 * so a route that only has the name -- /ssh/tunnel/disconnect is not told
 * which host a reserved tunnel belongs to -- can still perform an ownership
 * check.
 *
 * Returns null for anything that is not a reserved name, or whose host id
 * segment is not a positive integer. Callers must treat null as "cannot
 * verify ownership" and FAIL CLOSED, never fall through to an unchecked path.
 *
 * The endpoint id is taken verbatim as everything after the first ":"
 * following the host id, so it may itself contain colons -- endpoint ids are
 * client-supplied with no character restriction. Splitting on the first colon
 * rather than the last is safe because the host id segment is digits only.
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
