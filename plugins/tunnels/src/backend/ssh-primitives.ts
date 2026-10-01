import type { Client, ClientChannel } from "ssh2";
import type { Duplex } from "node:stream";
import type { PluginLogger } from "@termix/plugin-sdk/backend";

// Plain ssh2 channel operations on a client that already came from ctx.ssh.

export function forwardOut(
  client: Client,
  targetHost: string,
  targetPort: number,
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.forwardOut("127.0.0.1", 0, targetHost, targetPort, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stream);
    });
  });
}

export function bindForwardIn(
  client: Client,
  bindHost: string,
  bindPort: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    client.forwardIn(bindHost, bindPort, (err, actualPort) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(actualPort || bindPort);
    });
  });
}

export function unbindForwardIn(
  client: Client,
  bindHost: string,
  bindPort: number,
  log?: PluginLogger,
): void {
  try {
    client.unforwardIn(bindHost, bindPort, (err) => {
      if (err) {
        log?.warn(
          `Failed to unbind tunnel listener ${bindHost}:${bindPort}: ${err.message}`,
        );
      }
    });
  } catch {
    // The connection may already be gone.
  }
}

export function pipeTunnelStreams(
  inbound: Duplex,
  outboundPromise: Promise<Duplex>,
  tunnelName: string,
  log?: PluginLogger,
): void {
  outboundPromise
    .then((outbound) => {
      inbound.pipe(outbound).pipe(inbound);
      inbound.on("error", () => outbound.destroy());
      outbound.on("error", () => inbound.destroy());
    })
    .catch((error: unknown) => {
      log?.warn(
        `Tunnel ${tunnelName} could not open its outbound stream: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      inbound.destroy();
    });
}
