import type { TunnelConnection, TunnelMode } from "@/types/index.js";

export type ClientTunnel = TunnelConnection & {
  localAddress: string;
  remoteAddress: string;
  bindHost: string;
  sourceHostId?: number;
  sourceHostName?: string;
  displayName?: string;
  lastStartedAt?: string;
  lastTestedAt?: string;
  lastError?: string;
};

export function getTunnelMode(tunnel: Partial<TunnelConnection>): TunnelMode {
  return tunnel.mode || tunnel.tunnelType || "local";
}

export function normalizeClientTunnel(
  tunnel: Partial<TunnelConnection>,
): ClientTunnel {
  const mode = getTunnelMode(tunnel);
  const metadata = tunnel as Partial<ClientTunnel>;
  const localAddress =
    tunnel.localAddress?.trim() || tunnel.bindHost?.trim() || "";
  const remoteAddress =
    tunnel.remoteAddress?.trim() || tunnel.targetHost?.trim() || "";

  return {
    ...tunnel,
    scope: "c2s",
    mode,
    tunnelType: mode === "dynamic" ? "local" : mode,
    localAddress,
    remoteAddress,
    bindHost: localAddress,
    targetHost: remoteAddress,
    sourcePort: Number(tunnel.sourcePort) || 8080,
    endpointPort: Number(tunnel.endpointPort) || 22,
    endpointHost: tunnel.endpointHost || tunnel.sourceHostName || "",
    maxRetries: Number(tunnel.maxRetries) || 3,
    retryInterval: Number(tunnel.retryInterval) || 10,
    autoStart: Boolean(tunnel.autoStart),
    displayName: metadata.displayName ?? "",
    lastStartedAt: metadata.lastStartedAt,
    lastTestedAt: metadata.lastTestedAt,
    lastError: metadata.lastError,
  };
}

export function stripClientTunnelDiagnostics(
  tunnel: ClientTunnel,
): TunnelConnection {
  const presetTunnel = normalizeClientTunnel(tunnel);
  const displayName = presetTunnel.displayName?.trim();

  if (displayName) {
    presetTunnel.displayName = displayName;
  } else {
    delete presetTunnel.displayName;
  }

  delete presetTunnel.lastStartedAt;
  delete presetTunnel.lastTestedAt;
  delete presetTunnel.lastError;

  return presetTunnel;
}
