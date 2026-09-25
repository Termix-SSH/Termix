import type { Duplex } from "node:stream";
import type { Client, ClientChannel } from "ssh2";
import type { WebSocket } from "ws";
import type {
  PluginContext,
  PluginSshConnection,
} from "@termix/plugin-sdk/backend";
import type { TunnelMode } from "./types.js";
import {
  bindForwardIn,
  forwardOut,
  unbindForwardIn,
} from "./ssh-primitives.js";
import { getTunnelMode } from "./utils.js";

/** What the desktop app sends in the first message on the relay socket. */
export interface C2SRelayTunnel {
  name?: string;
  mode?: TunnelMode;
  tunnelType?: "local" | "remote";
  localAddress?: string;
  remoteAddress?: string;
  bindHost?: string;
  targetHost?: string;
  sourceHostId?: number;
  sourceHostSyncId?: string;
  sourcePort?: number;
  endpointPort?: number;
}

export interface C2SOpenMessage {
  type: "open" | "test";
  tunnelConfig?: C2SRelayTunnel;
  targetHost?: string;
  targetPort?: number;
}

const WS_HIGH_WATERMARK = 1024 * 1024;
const WS_LOW_WATERMARK = 256 * 1024;
const STREAM_WRITE_LIMIT = 8 * 1024 * 1024;

export function sendC2SError(ws: WebSocket, message: string): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "error", error: message }));
  }
}

export function describeC2SRelayError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("administratively prohibited") ||
    lower.includes("forwarding disabled") ||
    lower.includes("open failed")
  ) {
    return `SSH forwarding was rejected by the endpoint server: ${message}`;
  }
  if (
    lower.includes("address already in use") ||
    lower.includes("unable to bind") ||
    lower.includes("bind")
  ) {
    return `Remote port is not available on the endpoint server: ${message}`;
  }
  if (
    lower.includes("name or service not known") ||
    lower.includes("enotfound") ||
    lower.includes("econnrefused")
  ) {
    return `Tunnel target is not reachable from the endpoint host: ${message}`;
  }

  return message || "Failed to open relay";
}

function pauseForBackpressure(ws: WebSocket, source?: Duplex): void {
  if (!source || ws.bufferedAmount <= WS_HIGH_WATERMARK) return;

  source.pause();
  const resumeTimer = setInterval(() => {
    if (
      ws.readyState !== 1 ||
      source.destroyed ||
      ws.bufferedAmount <= WS_LOW_WATERMARK
    ) {
      clearInterval(resumeTimer);
      if (ws.readyState === 1 && !source.destroyed) source.resume();
    }
  }, 25);
}

function sendMessage(
  ws: WebSocket,
  message: Record<string, unknown>,
  source?: Duplex,
): void {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify(message), (error) => {
    if (error && source && !source.destroyed) source.destroy(error);
  });
  pauseForBackpressure(ws, source);
}

function writeRemoteChunk(
  target: ClientChannel,
  chunk: Buffer,
  ws: WebSocket,
  closeTarget: () => void,
): void {
  if (!target || target.destroyed) return;
  if (target.writableLength > STREAM_WRITE_LIMIT) {
    closeTarget();
    return;
  }
  if (!target.write(chunk)) {
    ws.pause();
    target.once("drain", () => {
      if (ws.readyState === 1) ws.resume();
    });
  }
}

/**
 * The host a client tunnel runs through. A desktop app synced with this
 * server knows the host by its sync id, since numeric ids differ between the
 * two databases, and must never fall back to a numeric id that could point
 * at a different machine here.
 */
export async function resolveC2SSourceHostId(
  tunnel: Pick<C2SRelayTunnel, "sourceHostId" | "sourceHostSyncId">,
  findHostIdBySyncId: (syncId: string) => Promise<number | null>,
): Promise<number> {
  const syncId = tunnel.sourceHostSyncId?.trim();
  if (syncId) {
    const hostId = await findHostIdBySyncId(syncId);
    if (!hostId) {
      throw new Error("Endpoint SSH host was not found on the remote server");
    }
    return hostId;
  }

  if (!tunnel.sourceHostId) throw new Error("Endpoint SSH host is required");
  return tunnel.sourceHostId;
}

function address(value: unknown, fallback: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || fallback;
}

interface ResolvedRelay {
  name: string;
  hostId: number;
  mode: TunnelMode;
  remoteAddress: string;
  sourcePort: number;
  endpointPort: number;
}

/**
 * The client tunnel relay: the desktop app listens locally and streams each
 * connection over this socket, and the server forwards it through one of the
 * user's hosts. Runs as the socket's user for every host lookup and connect.
 */
export function createC2SRelay(ctx: PluginContext) {
  let streamCounter = 0;

  async function findHostIdBySyncId(syncId: string): Promise<number | null> {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { hosts } = await ctx.db.refs<{ hosts: any }>();
    const drizzle = await ctx.db.client<any>();
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const { eq } = await import("drizzle-orm");
    const rows = await drizzle
      .select({ id: hosts.id })
      .from(hosts)
      .where(eq(hosts.syncId, syncId))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async function resolve(tunnel: C2SRelayTunnel): Promise<ResolvedRelay> {
    const hostId = await resolveC2SSourceHostId(tunnel, findHostIdBySyncId);
    const access = await ctx.hosts.checkAccess(hostId, "connect");
    if (!access.hasAccess) throw new Error("Access denied to this host");

    return {
      name: tunnel.name || `c2s:${hostId}`,
      hostId,
      mode: getTunnelMode({
        mode: tunnel.mode,
        tunnelType: tunnel.tunnelType,
      }),
      remoteAddress: address(
        tunnel.remoteAddress,
        address(tunnel.targetHost, "127.0.0.1"),
      ),
      sourcePort: Number(tunnel.sourcePort) || 0,
      endpointPort: Number(tunnel.endpointPort) || 0,
    };
  }

  function connectSource(hostId: number): Promise<PluginSshConnection<Client>> {
    return ctx.ssh.connect<Client>(hostId, {
      purpose: "tunnel",
      profile: "forward",
      timeoutMs: 60_000,
    });
  }

  async function openRemote(ws: WebSocket, relay: ResolvedRelay) {
    const bindHost = relay.remoteAddress;
    const bindPort = relay.sourcePort;
    if (!Number.isInteger(bindPort) || bindPort < 1 || bindPort > 65535) {
      throw new Error("Invalid remote port");
    }

    const source = await connectSource(relay.hostId);
    const sourceClient = source.client;
    let actualPort: number;
    try {
      actualPort = await bindForwardIn(sourceClient, bindHost, bindPort);
    } catch (error) {
      source.dispose();
      throw error;
    }

    const streams = new Map<string, ClientChannel>();
    let closed = false;

    const closeStream = (streamId: string) => {
      const stream = streams.get(streamId);
      if (!stream) return;
      streams.delete(streamId);
      try {
        stream.destroy();
      } catch {
        // Already gone.
      }
    };

    const close = () => {
      if (closed) return;
      closed = true;
      for (const streamId of [...streams.keys()]) closeStream(streamId);
      unbindForwardIn(sourceClient, bindHost, actualPort, ctx.log);
      source.dispose();
    };

    sourceClient.on("tcp connection", (info, accept, reject) => {
      if (info.destPort !== actualPort) {
        reject();
        return;
      }
      const inbound = accept();
      const streamId = `${Date.now()}-${++streamCounter}`;
      streams.set(streamId, inbound);
      sendMessage(ws, { type: "connection", streamId });

      inbound.on("data", (chunk: Buffer) => {
        sendMessage(
          ws,
          { type: "data", streamId, data: chunk.toString("base64") },
          inbound,
        );
      });
      inbound.on("close", () => {
        streams.delete(streamId);
        sendMessage(ws, { type: "close", streamId });
      });
      inbound.on("error", (error: Error) => {
        streams.delete(streamId);
        sendMessage(ws, { type: "close", streamId, error: error.message });
      });
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      try {
        const message = JSON.parse(data.toString()) as {
          type?: string;
          streamId?: string;
          data?: string;
        };
        if (!message.streamId) return;
        const streamId = message.streamId;
        if (message.type === "data" && message.data) {
          const stream = streams.get(streamId);
          if (stream) {
            writeRemoteChunk(
              stream,
              Buffer.from(message.data, "base64"),
              ws,
              () => closeStream(streamId),
            );
          }
        } else if (message.type === "close") {
          closeStream(streamId);
        }
      } catch (error) {
        ctx.log.warn(
          `Invalid client tunnel relay message for ${relay.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });

    ws.on("close", close);
    ws.on("error", close);
    sourceClient.on("close", () => {
      if (ws.readyState === 1) ws.close();
    });
    sourceClient.on("error", (error: Error) => {
      sendMessage(ws, { type: "error", error: error.message });
      if (ws.readyState === 1) ws.close();
    });

    ctx.log.info(
      `Client tunnel ${relay.name} bound ${bindHost}:${actualPort} on host ${relay.hostId}`,
    );
    sendMessage(ws, { type: "ready", bindHost, bindPort: actualPort });
  }

  async function open(ws: WebSocket, message: C2SOpenMessage): Promise<void> {
    const relay = await resolve(message.tunnelConfig ?? {});
    if (relay.mode === "remote") {
      await openRemote(ws, relay);
      return;
    }

    const targetHost =
      relay.mode === "dynamic" ? message.targetHost : relay.remoteAddress;
    const targetPort =
      relay.mode === "dynamic"
        ? Number(message.targetPort)
        : relay.endpointPort;
    if (!targetHost || !Number.isInteger(targetPort) || targetPort < 1) {
      throw new Error("Invalid client tunnel target");
    }

    const source = await connectSource(relay.hostId);
    let outbound: ClientChannel;
    try {
      outbound = await forwardOut(source.client, targetHost, targetPort);
    } catch (error) {
      source.dispose();
      throw error;
    }

    const close = () => {
      try {
        outbound.destroy();
      } catch {
        // Already gone.
      }
      source.dispose();
    };

    outbound.on("data", (chunk: Buffer) => {
      if (ws.readyState === 1) ws.send(chunk);
    });
    outbound.on("close", () => {
      if (ws.readyState === 1) ws.close();
    });
    outbound.on("error", () => {
      if (ws.readyState === 1) ws.close();
    });
    ws.on("close", close);
    ws.on("error", close);
    ws.on("message", (data, isBinary) => {
      if (!isBinary) return;
      const chunk = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data as ArrayBuffer);
      outbound.write(chunk);
    });

    ws.send(JSON.stringify({ type: "ready" }));
  }

  async function test(ws: WebSocket, message: C2SOpenMessage): Promise<void> {
    const relay = await resolve(message.tunnelConfig ?? {});
    const source = await connectSource(relay.hostId);
    try {
      if (relay.mode === "remote") {
        const bindPort = relay.sourcePort;
        if (!Number.isInteger(bindPort) || bindPort < 1 || bindPort > 65535) {
          throw new Error("Invalid remote port");
        }
        const actualPort = await bindForwardIn(
          source.client,
          relay.remoteAddress,
          bindPort,
        );
        unbindForwardIn(source.client, relay.remoteAddress, actualPort);
      } else if (relay.mode === "local") {
        if (!Number.isInteger(relay.endpointPort) || relay.endpointPort < 1) {
          throw new Error("Invalid remote target port");
        }
        const outbound = await forwardOut(
          source.client,
          relay.remoteAddress,
          relay.endpointPort,
        );
        outbound.destroy();
      }
      sendMessage(ws, { type: "ready" });
    } finally {
      source.dispose();
    }
  }

  /** The ctx.ws.route handler. Core has already authenticated the socket. */
  return function handleConnection(ws: WebSocket, userId: string): void {
    let opened = false;

    ws.on("error", (error: Error) => {
      ctx.log.warn(`Client tunnel relay socket error: ${error.message}`);
    });

    ws.once("message", (raw) => {
      void ctx
        .asUser(userId, async () => {
          if (!(await ctx.rbac.has("use"))) {
            throw new Error("Access denied");
          }
          const message = JSON.parse(raw.toString()) as C2SOpenMessage;
          if (message.type !== "open" && message.type !== "test") {
            throw new Error("Invalid client tunnel relay request");
          }
          opened = true;
          if (message.type === "test") await test(ws, message);
          else await open(ws, message);
        })
        .catch((error: unknown) => {
          const message = describeC2SRelayError(error);
          ctx.log.warn(`Failed to open client tunnel relay: ${message}`);
          sendC2SError(ws, message);
          ws.close();
        });
    });

    ws.on("close", () => {
      if (!opened) ctx.log.debug("Client tunnel relay closed before opening");
    });
  };
}
