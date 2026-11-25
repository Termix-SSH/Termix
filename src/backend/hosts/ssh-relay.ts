/**
 * A relay to a host's SSH port, for another Termix server that manages this
 * one. It opens a WebSocket at /plugin-ws/core/ssh-relay with an API key
 * ticket, names a host, and the bytes of an SSH connection run through it.
 * This server reaches the host the way it always does, jump hosts, proxy and
 * port knocking included, so the other server never needs a route to it. The
 * SSH session itself stays between that server and the host.
 *
 * The caller needs connect access to the host, the same as for a session,
 * and connect policies must allow it.
 */

import net from "node:net";
import type { Duplex } from "node:stream";
import { createWebSocketStream, type WebSocket } from "ws";
import type { PluginWebSocketConnection } from "@termix-ssh/plugin-sdk/backend";
import { resolveHostById, resolveHostBySyncId } from "./host-resolver.js";
import { openSshTransport } from "./connect/transport.js";
import type { MutableConnectConfig, SshConnectHost } from "./connect/types.js";
import { sshLogger } from "../utils/logger.js";
import { registerCoreWsRoute } from "../plugins/ws.js";
import { trackConnection } from "./open-connections.js";

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
  // Read the socket from the start. The client speaks first (its SSH greeting)
  // and the host lookups below take a while for a host given by name, so a
  // message nobody listens for yet would be dropped. The stream keeps it.
  const pipe = createWebSocketStream(ws);
  // Errors before the pipes are set up end the socket on their own; this only
  // keeps one from being rethrown with nobody listening.
  pipe.on("error", () => {});
  const url = String((connection.request as { url?: string }).url ?? "");
  const params = new URL(url, "http://relay").searchParams;
  const hostId = Number(params.get("hostId"));
  // A linked desktop knows its hosts by sync id, not by this server's id.
  const syncId = params.get("syncId");
  const userId = connection.userId;

  if (!userId || (!syncId && (!Number.isSafeInteger(hostId) || hostId <= 0))) {
    close(ws, 1008, "A host is required");
    return;
  }
  const currentCount = open.get(userId) ?? 0;
  if (currentCount >= MAX_RELAYS_PER_USER) {
    close(ws, 1013, "Too many connections");
    return;
  }
  open.set(userId, currentCount + 1);
  let slotReleased = false;
  const releaseSlot = () => {
    if (slotReleased) return;
    slotReleased = true;
    const next = (open.get(userId) ?? 1) - 1;
    if (next <= 0) open.delete(userId);
    else open.set(userId, next);
  };

  let host: Awaited<ReturnType<typeof resolveHostById>>;
  try {
    // The relay only carries bytes and the client logs in itself, so a share
    // with no login of its own still gets through.
    const options = { allowMissingLogin: true };
    host = syncId
      ? await resolveHostBySyncId(syncId, userId, options)
      : await resolveHostById(hostId, userId, options);
    if (!host) {
      releaseSlot();
      close(ws, 1008, "Host not found or access denied");
      return;
    }

    const { assertConnectAllowed, ConnectPolicyError } =
      await import("./connect-policy.js");
    try {
      await assertConnectAllowed({
        userId,
        hostId: Number((host as { id?: unknown }).id),
        protocol: "ssh",
        purpose: "relay",
        profile: "stream",
        interactive: false,
        origin: "core",
      });
    } catch (error) {
      releaseSlot();
      if (error instanceof ConnectPolicyError) {
        close(ws, 1008, "Connection not allowed");
      } else {
        close(ws, 1011, "Could not open the connection");
      }
      return;
    }
  } catch (error) {
    releaseSlot();
    sshLogger.warn("A relay failed before opening its transport", {
      operation: "ssh_relay_setup",
      hostId: syncId ? undefined : hostId,
      syncId,
      error: error instanceof Error ? error.message : String(error),
    });
    close(ws, 1011, "Could not open the connection");
    return;
  }

  let stream: Duplex | null = null;
  let jumpEnd: (() => void) | null = null;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    releaseSlot();
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
    if (done) {
      jumpClient?.end();
      (config.sock as Duplex | undefined)?.destroy();
      return;
    }
    jumpEnd = () => jumpClient?.end();
    stream = (config.sock as Duplex | undefined) ?? null;
    if (!stream) {
      stream = net.connect({
        host: String(config.host),
        port: Number(config.port),
      });
    }
    stream.once("error", finish);
    stream.once("close", finish);
    const untrack = trackConnection((host as { id?: unknown }).id, finish);
    ws.once("close", untrack);
    pipe.once("error", finish);
    stream.pipe(pipe);
    pipe.pipe(stream);
  } catch (error) {
    sshLogger.warn("A relay could not reach its host", {
      operation: "ssh_relay_open",
      hostId: syncId ? undefined : hostId,
      syncId,
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
