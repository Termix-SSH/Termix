import net from "net";
import type { Client } from "ssh2";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { RemoteDesktopLogger } from "./log.js";

/** The tunnels plugin's service, as ctx.services.get("tunnels.access") returns it. */
interface TunnelsAccess {
  forward(
    sourceHostId: number,
    target: { targetHost: string; targetPort: number; bindHost?: string },
    options?: { name?: string; idleTimeoutMs?: number },
  ): Promise<{
    bindHost: string;
    bindPort: number;
    close: () => Promise<void>;
  }>;
}

/** The tunnels plugin keeps these names for on-demand forwards. */
const TUNNEL_NAME_PREFIX = "web:";
/** A forward nothing is using closes itself after this long. */
const FORWARD_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export interface JumpTunnel {
  port: number;
  close: () => void;
}

export interface JumpTunnelRequest {
  jumpHosts: Array<{ hostId: number }>;
  targetHost: string;
  targetPort: number;
  bindHost: string;
  /** Names the forward, so each session gets one of its own. */
  connectId: string;
}

/**
 * A local port guacd can dial that reaches the target through the host's
 * jump hosts.
 *
 * One hop is exactly what the tunnels plugin's forward does, so that is used
 * when the plugin is running and the user may use it. A chain, or no tunnels
 * plugin, goes through ctx.ssh.jumpChain with a listener of our own. Either
 * way the caller closes it when the session ends.
 */
export async function openJumpTunnel(
  ctx: PluginContext,
  log: RemoteDesktopLogger,
  request: JumpTunnelRequest,
): Promise<JumpTunnel> {
  if (request.jumpHosts.length === 1) {
    const viaTunnels = await forwardThroughTunnels(ctx, log, request);
    if (viaTunnels) return viaTunnels;
  }
  return forwardThroughChain(ctx, request);
}

async function forwardThroughTunnels(
  ctx: PluginContext,
  log: RemoteDesktopLogger,
  request: JumpTunnelRequest,
): Promise<JumpTunnel | null> {
  const tunnels = ctx.services.get<Partial<TunnelsAccess>>("tunnels.access");
  if (typeof tunnels.forward !== "function") return null;
  const hopId = request.jumpHosts[0].hostId;
  try {
    const handle = await tunnels.forward(
      hopId,
      {
        targetHost: request.targetHost,
        targetPort: request.targetPort,
        bindHost: request.bindHost,
      },
      {
        name: `${TUNNEL_NAME_PREFIX}${hopId}:rd-${request.connectId}`,
        idleTimeoutMs: FORWARD_IDLE_TIMEOUT_MS,
      },
    );
    return {
      port: handle.bindPort,
      close: () => void handle.close().catch(() => undefined),
    };
  } catch (error) {
    // A user without the tunnels permission still reaches their host.
    log.warn("Tunnels forward failed, using a jump chain instead", {
      operation: "guac_tunnels_forward",
      hopId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function forwardThroughChain(
  ctx: PluginContext,
  request: JumpTunnelRequest,
): Promise<JumpTunnel> {
  // The chain dials the first hop through that hop's own SOCKS5 settings;
  // the target host's proxy config does not apply to it.
  const { client, dispose } = await ctx.ssh.jumpChain<Client>(
    request.jumpHosts,
  );

  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    client.forwardOut(
      "127.0.0.1",
      0,
      request.targetHost,
      request.targetPort,
      (error, stream) => {
        if (error) {
          socket.destroy();
          return;
        }
        socket.pipe(stream).pipe(socket);
      },
    );
  });

  let port: number;
  try {
    port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, request.bindHost, () =>
        resolve((server.address() as net.AddressInfo).port),
      );
    });
  } catch (error) {
    await dispose();
    throw error;
  }

  return {
    port,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
      void dispose();
    },
  };
}
