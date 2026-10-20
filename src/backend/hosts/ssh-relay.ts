/**
 * A relay to a host's SSH port, for another Termix server that manages this
 * one. It opens a WebSocket at /plugin-ws/core/ssh-relay with an API key
 * ticket, names a host, and the bytes of an SSH connection run through it.
 * This server reaches the host the way it always does, jump hosts, proxy and
 * port knocking included, so the other server never needs a route to it. The
 * SSH session itself stays between that server and the host.
 *
 * The caller needs connect access to the host, the same as for a session.
 */

import net from "node:net";
import type { Duplex } from "node:stream";
import { createWebSocketStream, type WebSocket } from "ws";
import type { PluginWebSocketConnection } from "@termix-ssh/plugin-sdk/backend";
import { resolveHostById } from "./host-resolver.js";
import { openSshTransport } from "./connect/transport.js";
import type { MutableConnectConfig, SshConnectHost } from "./connect/types.js";
import { sshLogger } from "../utils/logger.js";
import { registerCoreWsRoute } from "../plugins/ws.js";

const MAX_RELAYS_PER_USER = 100;
const open = new Map<string, number>();

function close(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // Already closed.
  }
}

async function handleRelay(
  connection: PluginWebSocketConnection,
): Promise<void> {
  const ws = connection.socket as WebSocket;
  const url = String((connection.request as { url?: string }).url ?? "");
  const hostId = Number(
    new URL(url, "http://relay").searchParams.get("hostId"),
  );
  const userId = connection.userId;

  if (!userId || !Number.isSafeInteger(hostId) || hostId <= 0) {
    close(ws, 1008, "A host is required");
    return;
  }
  if ((open.get(userId) ?? 0) >= MAX_RELAYS_PER_USER) {
    close(ws, 1013, "Too many connections");
    return;
  }

  const host = await resolveHostById(hostId, userId);
  if (!host) {
    close(ws, 1008, "Host not found or access denied");
    return;
  }

  open.set(userId, (open.get(userId) ?? 0) + 1);
  let stream: Duplex | null = null;
  let jumpEnd: (() => void) | null = null;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    open.set(userId, Math.max(0, (open.get(userId) ?? 1) - 1));
    stream?.destroy();
    jumpEnd?.();
    close(ws, 1000, "Closed");
  };
  ws.once("close", finish);

  try {
    const sshHost = host as unknown as SshConnectHost;
    const config = {
      host: sshHost.ip,
      port: sshHost.port || 22,
    } as MutableConnectConfig;
    const { jumpClient } = await openSshTransport(sshHost, config);
    jumpEnd = () => jumpClient?.end();
    stream = (config.sock as Duplex | undefined) ?? null;
    if (!stream) {
      stream = net.connect({
        host: String(config.host),
        port: Number(config.port),
      });
    }
    const pipe = createWebSocketStream(ws);
    stream.once("error", finish);
    stream.once("close", finish);
    pipe.once("error", finish);
    stream.pipe(pipe);
    pipe.pipe(stream);
  } catch (error) {
    sshLogger.warn("A relay could not reach its host", {
      operation: "ssh_relay_open",
      hostId,
      error: error instanceof Error ? error.message : String(error),
    });
    finish();
  }
}

let registered = false;

/** Mounts the relay once, for servers that other Termix servers manage. */
export function registerSshRelay(): void {
  if (registered) return;
  registered = true;
  registerCoreWsRoute("/ssh-relay", handleRelay);
}
