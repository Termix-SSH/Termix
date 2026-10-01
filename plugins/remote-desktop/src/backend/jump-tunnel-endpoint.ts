const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function resolveJumpTunnelEndpoint(
  guacdHost: string,
  tunnelHost = process.env.GUACD_TUNNEL_HOST,
): { bindHost: string; advertisedHost: string } {
  if (LOOPBACK_HOSTS.has(guacdHost.toLowerCase())) {
    return { bindHost: "127.0.0.1", advertisedHost: "127.0.0.1" };
  }

  return {
    bindHost: "0.0.0.0",
    advertisedHost: tunnelHost?.trim() || "termix",
  };
}
