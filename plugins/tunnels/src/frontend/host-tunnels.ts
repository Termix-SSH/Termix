import type { PluginHostRecord } from "@termix/plugin-sdk/frontend";
import type { TunnelConnectRequest, TunnelConnection } from "../shared/types";
import { serverTunnelName } from "../shared/tunnel-naming";

/** A host's tunnel settings, as the host payload's pluginSettings carries them. */
export function hostTunnelSettings(host: PluginHostRecord | null | undefined): {
  enabled: boolean;
  connections: TunnelConnection[];
} {
  const settings = (
    host?.pluginSettings as Record<string, Record<string, unknown>> | undefined
  )?.tunnels;
  return {
    enabled: settings?.enableTunnel === true,
    connections: parseConnections(settings?.tunnelConnections),
  };
}

export function parseConnections(value: unknown): TunnelConnection[] {
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

export function tunnelMode(
  tunnel: Pick<TunnelConnection, "mode" | "tunnelType">,
): "local" | "remote" | "dynamic" {
  return tunnel.mode ?? tunnel.tunnelType ?? "local";
}

/** What POST /connect takes for a host's saved tunnel. */
export function connectRequestFor(
  host: {
    id: string | number;
    name?: string | null;
    username?: string | null;
    ip: string;
  },
  index: number,
  tunnel: TunnelConnection,
): TunnelConnectRequest {
  const mode = tunnelMode(tunnel);
  return {
    name: serverTunnelName(host, index, tunnel),
    sourceHostId: Number(host.id),
    tunnelIndex: index,
    scope: tunnel.scope ?? "s2s",
    mode,
    tunnelType: mode === "remote" ? "remote" : "local",
    bindHost: tunnel.bindHost,
    targetHost: tunnel.targetHost,
    endpointHost: (tunnel.endpointHost ?? "").trim(),
    sourcePort: tunnel.sourcePort,
    endpointPort: tunnel.endpointPort ?? 0,
    maxRetries: tunnel.maxRetries,
    retryInterval: tunnel.retryInterval,
    autoStart: tunnel.autoStart,
  };
}
