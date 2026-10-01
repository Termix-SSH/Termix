import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { TunnelManager } from "./manager.js";
import { errorMessage } from "./manager.js";
import {
  buildTunnelConfig,
  connectionToRequest,
  readTunnelConnections,
  resolveEndpoint,
} from "./config.js";

export interface HostOwner {
  id: number;
  userId: string;
}

/** Every host and its owner, straight from ssh_data. */
export async function listHostOwners(ctx: PluginContext): Promise<HostOwner[]> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { hosts } = await ctx.db.refs<{ hosts: any }>();
  const drizzle = await ctx.db.client<any>();
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const rows = (await drizzle
    .select({ id: hosts.id, userId: hosts.userId })
    .from(hosts)) as HostOwner[];
  return rows.filter((row) => Number.isInteger(row.id) && !!row.userId);
}

/**
 * Starts every saved tunnel marked autoStart, across every user.
 *
 * ctx.hosts only sees the acting user's hosts, so the owners come from
 * ssh_data first and each host is then resolved and connected as its owner.
 */
export async function startAutoStartTunnels(
  ctx: PluginContext,
  manager: TunnelManager,
  listOwners: () => Promise<HostOwner[]> = () => listHostOwners(ctx),
): Promise<number> {
  let started = 0;
  let owners: HostOwner[];
  try {
    owners = await listOwners();
  } catch (error) {
    ctx.log.warn(
      `Could not list hosts for tunnel autostart: ${errorMessage(error)}`,
    );
    return 0;
  }

  for (const owner of owners) {
    try {
      if (!(await ctx.settings.getHost<boolean>(owner.id, "enableTunnel"))) {
        continue;
      }
      const connections = readTunnelConnections(
        await ctx.settings.getHost(owner.id, "tunnelConnections"),
      );
      if (!connections.some((connection) => connection.autoStart)) continue;

      started += await ctx.asUser(owner.userId, async () => {
        const host = await ctx.hosts.get(owner.id);
        if (!host) return 0;
        let count = 0;
        for (const [index, connection] of connections.entries()) {
          if (!connection.autoStart) continue;
          try {
            const config = await resolveEndpoint(
              ctx,
              buildTunnelConfig(
                host,
                connectionToRequest(host, index, connection),
                owner.userId,
              ),
            );
            await manager.start(config);
            count++;
          } catch (error) {
            ctx.log.warn(
              `Autostart tunnel ${index + 1} on host ${owner.id} skipped: ${errorMessage(error)}`,
            );
          }
        }
        return count;
      });
    } catch (error) {
      ctx.log.warn(
        `Autostart failed for host ${owner.id}: ${errorMessage(error)}`,
      );
    }
  }

  if (started > 0) ctx.log.info(`Started ${started} autostart tunnel(s)`);
  return started;
}
