import type { ErrorType, TunnelConfig } from "../../types/index.js";
import { tunnelLogger } from "../utils/logger.js";

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
