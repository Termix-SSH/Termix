/**
 * Tunnel names, shared by the backend and every frontend view so the two
 * sides can never build the same tunnel under different names.
 */

/** A host's saved server tunnel: `<hostId>::<index>::<label>::<port>::<endpoint>::<port>`. */
export function buildTunnelName(
  hostId: number | string,
  tunnelIndex: number,
  hostLabel: string,
  sourcePort: number | string,
  endpointHost: string,
  endpointPort: number | string,
): string {
  return `${hostId}::${tunnelIndex}::${hostLabel}::${sourcePort}::${endpointHost}::${endpointPort}`;
}

/** The label a server tunnel name carries for its source host. */
export function tunnelHostLabel(host: {
  name?: string | null;
  username?: string | null;
  ip: string;
}): string {
  return host.name || `${host.username ?? ""}@${host.ip}`;
}

/** A saved server tunnel's name, from its host and position in the list. */
export function serverTunnelName(
  host: {
    id: number | string;
    name?: string | null;
    username?: string | null;
    ip: string;
  },
  index: number,
  tunnel: {
    sourcePort: number | string;
    endpointHost?: string | null;
    endpointPort?: number | string | null;
  },
): string {
  return buildTunnelName(
    host.id,
    index,
    tunnelHostLabel(host),
    tunnel.sourcePort,
    (tunnel.endpointHost ?? "").trim(),
    tunnel.endpointPort ?? 0,
  );
}

/** A desktop client tunnel's name, as the Electron main process tracks it. */
export function clientTunnelName(
  tunnel: {
    sourceHostId?: number;
    mode?: string;
    tunnelType?: string;
    localAddress?: string;
    remoteAddress?: string;
    sourcePort: number;
    endpointPort?: number;
  },
  index: number,
): string {
  const address = (value?: string) => value?.trim() || "127.0.0.1";
  return [
    "c2s",
    index,
    tunnel.sourceHostId || 0,
    tunnel.mode || tunnel.tunnelType || "local",
    address(tunnel.localAddress),
    address(tunnel.remoteAddress),
    tunnel.sourcePort,
    tunnel.endpointPort || 0,
  ].join("::");
}
