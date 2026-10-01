import { isReservedTunnelName, parseReservedTunnelName } from "./utils.js";

/**
 * Ownership check for an action addressed by tunnel name alone.
 *
 * On-demand (forward) tunnels are deliberately never registered as configs,
 * so a check that only ran for a registered config would never run for them.
 * Host ids are small sequential integers and endpoint ids come from the
 * client, so anyone could guess `web:{hostId}:{endpointId}` and force-close
 * another user's live tunnel. The host id is read back out of the reserved
 * name instead, and a reserved name whose host id cannot be parsed fails
 * closed rather than falling through to the unchecked path.
 */
export async function authorizeTunnelAction(
  canAccessHost: (hostId: number) => Promise<boolean>,
  tunnelName: string,
  config: { sourceHostId?: number } | undefined,
): Promise<{ allowed: boolean; hostId?: number }> {
  const hostId =
    config?.sourceHostId ?? parseReservedTunnelName(tunnelName)?.hostId;

  if (hostId === undefined) {
    // Not reserved and not registered: nothing is running under this name
    // that anyone could own, so there is nothing to protect.
    return { allowed: !isReservedTunnelName(tunnelName) };
  }

  return { allowed: await canAccessHost(hostId), hostId };
}
