import { Client, type ClientChannel } from "ssh2";
import type { WebSocket } from "ws";
import type { TunnelConfig } from "../../types/index.js";
import { createSocks5Connection } from "../utils/socks5-helper.js";
import { tunnelLogger } from "../utils/logger.js";
import { PermissionManager } from "../utils/permission-manager.js";
import {
  applyAuthOptions,
  bindForwardIn,
  connectClient,
  forwardOut,
  getManagedTunnelAlgorithms,
  unbindForwardIn,
} from "./tunnel-ssh-primitives.js";
import {
  sendC2SMessage,
  writeC2SRemoteChunk,
} from "./tunnel-c2s-relay-utils.js";
import { getTunnelMode } from "./tunnel-utils.js";

export type C2SOpenMessage = {
  type: "open" | "test";
  tunnelConfig?: Partial<TunnelConfig>;
  targetHost?: string;
  targetPort?: number;
};

const permissionManager = PermissionManager.getInstance();
let c2sRemoteStreamCounter = 0;

async function resolveC2STunnelSource(
  tunnelConfig: Partial<TunnelConfig>,
  userId: string,
): Promise<TunnelConfig> {
  if (!tunnelConfig.sourceHostId) {
    throw new Error("Endpoint SSH host is required");
  }

  const accessInfo = await permissionManager.canAccessHost(
    userId,
    tunnelConfig.sourceHostId,
    "read",
  );
  if (!accessInfo.hasAccess) {
    throw new Error("Access denied to this host");
  }

  const { resolveHostById } = await import("./host-resolver.js");
  const resolvedHost = await resolveHostById(tunnelConfig.sourceHostId, userId);
  if (!resolvedHost) {
    throw new Error("Endpoint SSH host not found");
  }

  return {
    name: tunnelConfig.name || `c2s:${tunnelConfig.sourceHostId}`,
    scope: "c2s",
    mode: tunnelConfig.mode || "local",
    tunnelType:
      tunnelConfig.tunnelType ||
      (tunnelConfig.mode === "remote" ? "remote" : "local"),
    bindHost: tunnelConfig.bindHost,
    targetHost: tunnelConfig.targetHost || "127.0.0.1",
    sourceHostId: resolvedHost.id || tunnelConfig.sourceHostId,
    tunnelIndex: tunnelConfig.tunnelIndex || 0,
    requestingUserId: userId,
    hostName:
      resolvedHost.name || `${resolvedHost.username}@${resolvedHost.ip}`,
    sourceIP: resolvedHost.ip,
    sourceSSHPort: resolvedHost.port,
    sourceUsername: resolvedHost.username,
    sourcePassword: resolvedHost.password,
    sourceAuthMethod: resolvedHost.authType,
    sourceSSHKey: resolvedHost.key,
    sourceKeyPassword: resolvedHost.keyPassword,
    sourceKeyType: resolvedHost.keyType,
    sourceCredentialId: resolvedHost.credentialId,
    sourceUserId: resolvedHost.userId,
    endpointIP: tunnelConfig.endpointIP || resolvedHost.ip,
    endpointSSHPort: tunnelConfig.endpointSSHPort || resolvedHost.port,
    endpointUsername: resolvedHost.username,
    endpointHost:
      tunnelConfig.endpointHost || resolvedHost.name || resolvedHost.ip,
    endpointAuthMethod: resolvedHost.authType,
    endpointSSHKey: resolvedHost.key,
    endpointKeyPassword: resolvedHost.keyPassword,
    endpointKeyType: resolvedHost.keyType,
    endpointCredentialId: resolvedHost.credentialId,
    endpointUserId: resolvedHost.userId,
    sourcePort: Number(tunnelConfig.sourcePort) || 0,
    endpointPort: Number(tunnelConfig.endpointPort) || 0,
    maxRetries: Number(tunnelConfig.maxRetries) || 0,
    retryInterval: Number(tunnelConfig.retryInterval) || 0,
    autoStart: Boolean(tunnelConfig.autoStart),
    isPinned: Boolean(resolvedHost.pin),
    useSocks5: Boolean(resolvedHost.useSocks5),
    socks5Host: resolvedHost.socks5Host,
    socks5Port: resolvedHost.socks5Port,
    socks5Username: resolvedHost.socks5Username,
    socks5Password: resolvedHost.socks5Password,
    socks5ProxyChain: resolvedHost.socks5ProxyChain,
    keepaliveInterval:
      typeof resolvedHost.terminalConfig?.keepaliveInterval === "number"
        ? resolvedHost.terminalConfig.keepaliveInterval * 1000
        : 60000,
    keepaliveCountMax:
      typeof resolvedHost.terminalConfig?.keepaliveCountMax === "number"
        ? resolvedHost.terminalConfig.keepaliveCountMax
        : 5,
  };
}

async function connectC2SSourceClient(
  tunnelConfig: TunnelConfig,
): Promise<Client> {
  const connOptions: Record<string, unknown> = {
    host:
      tunnelConfig.sourceIP?.replace(/^\[|\]$/g, "") || tunnelConfig.sourceIP,
    port: tunnelConfig.sourceSSHPort,
    username: tunnelConfig.sourceUsername,
    tryKeyboard: true,
    keepaliveInterval: tunnelConfig.keepaliveInterval ?? 30000,
    keepaliveCountMax: tunnelConfig.keepaliveCountMax ?? 3,
    readyTimeout: 60000,
    tcpKeepAlive: true,
    tcpKeepAliveInitialDelay: 30000,
    algorithms: getManagedTunnelAlgorithms(),
  };

  applyAuthOptions(connOptions, {
    password: tunnelConfig.sourcePassword,
    sshKey: tunnelConfig.sourceSSHKey,
    keyPassword: tunnelConfig.sourceKeyPassword,
    keyType: tunnelConfig.sourceKeyType,
    authMethod: tunnelConfig.sourceAuthMethod,
  });

  if (
    tunnelConfig.useSocks5 &&
    (tunnelConfig.socks5Host ||
      (tunnelConfig.socks5ProxyChain &&
        tunnelConfig.socks5ProxyChain.length > 0))
  ) {
    const socks5Socket = await createSocks5Connection(
      tunnelConfig.sourceIP,
      tunnelConfig.sourceSSHPort,
      {
        useSocks5: tunnelConfig.useSocks5,
        socks5Host: tunnelConfig.socks5Host,
        socks5Port: tunnelConfig.socks5Port,
        socks5Username: tunnelConfig.socks5Username,
        socks5Password: tunnelConfig.socks5Password,
        socks5ProxyChain: tunnelConfig.socks5ProxyChain,
      },
    );
    if (socks5Socket) {
      connOptions.sock = socks5Socket;
    }
  }

  return connectClient(connOptions, tunnelConfig.name, "source");
}

async function handleC2SRemoteRelayOpen(
  ws: WebSocket,
  tunnelConfig: TunnelConfig,
): Promise<void> {
  const tunnelName = tunnelConfig.name;
  const sourceClient = await connectC2SSourceClient(tunnelConfig);
  const bindHost = tunnelConfig.targetHost || "127.0.0.1";
  const bindPort = Number(tunnelConfig.sourcePort);
  let closed = false;

  if (!Number.isInteger(bindPort) || bindPort < 1 || bindPort > 65535) {
    throw new Error("Invalid remote port");
  }

  const actualPort = await bindForwardIn(sourceClient, bindHost, bindPort);
  const streams = new Map<string, ClientChannel>();

  const closeStream = (streamId: string): void => {
    const stream = streams.get(streamId);
    if (!stream) return;
    streams.delete(streamId);
    try {
      stream.destroy();
    } catch {
      // expected during shutdown
    }
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    for (const streamId of streams.keys()) {
      closeStream(streamId);
    }
    unbindForwardIn(sourceClient, bindHost, actualPort);
    try {
      sourceClient.end();
    } catch {
      // expected during shutdown
    }
  };

  sourceClient.on("tcp connection", (info, accept, reject) => {
    if (info.destPort !== actualPort) {
      reject();
      return;
    }

    const inbound = accept();
    const streamId = `${Date.now()}-${++c2sRemoteStreamCounter}`;
    streams.set(streamId, inbound);

    sendC2SMessage(ws, { type: "connection", streamId });

    inbound.on("data", (chunk) => {
      sendC2SMessage(
        ws,
        {
          type: "data",
          streamId,
          data: chunk.toString("base64"),
        },
        inbound,
      );
    });
    inbound.on("close", () => {
      streams.delete(streamId);
      sendC2SMessage(ws, { type: "close", streamId });
    });
    inbound.on("error", (error) => {
      streams.delete(streamId);
      sendC2SMessage(ws, {
        type: "close",
        streamId,
        error: error instanceof Error ? error.message : String(error),
      });
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

      if (message.type === "data" && message.data) {
        const stream = streams.get(message.streamId);
        if (stream) {
          writeC2SRemoteChunk(
            stream,
            Buffer.from(message.data, "base64"),
            ws,
            () => closeStream(message.streamId as string),
          );
        }
      } else if (message.type === "close") {
        closeStream(message.streamId);
      }
    } catch (error) {
      tunnelLogger.warn("Invalid C2S remote relay message", {
        operation: "c2s_remote_relay_invalid_message",
        tunnelName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  ws.on("close", close);
  ws.on("error", close);
  sourceClient.on("close", () => {
    if (ws.readyState === 1) ws.close();
  });
  sourceClient.on("error", (error) => {
    sendC2SMessage(ws, {
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    if (ws.readyState === 1) ws.close();
  });

  tunnelLogger.info("C2S remote tunnel ready", {
    operation: "c2s_remote_tunnel_ready",
    tunnelName,
    bindHost,
    bindPort: actualPort,
    endpointHost: tunnelConfig.endpointHost,
  });
  sendC2SMessage(ws, { type: "ready", bindHost, bindPort: actualPort });
}

export async function handleC2SRelayOpen(
  ws: WebSocket,
  message: C2SOpenMessage,
  userId: string,
): Promise<void> {
  const tunnelConfig = await resolveC2STunnelSource(
    message.tunnelConfig || {},
    userId,
  );
  const mode = getTunnelMode(tunnelConfig);
  if (mode === "remote") {
    await handleC2SRemoteRelayOpen(ws, tunnelConfig);
    return;
  }

  const targetHost =
    mode === "dynamic"
      ? message.targetHost
      : tunnelConfig.targetHost || "127.0.0.1";
  const targetPort =
    mode === "dynamic"
      ? Number(message.targetPort)
      : Number(tunnelConfig.endpointPort);

  if (!targetHost || !Number.isInteger(targetPort) || targetPort < 1) {
    throw new Error("Invalid client tunnel target");
  }

  const sourceClient = await connectC2SSourceClient(tunnelConfig);
  const outbound = await forwardOut(sourceClient, targetHost, targetPort);

  const close = () => {
    try {
      outbound.destroy();
    } catch {
      // expected during shutdown
    }
    try {
      sourceClient.end();
    } catch {
      // expected during shutdown
    }
  };

  outbound.on("data", (chunk) => {
    if (ws.readyState === 1) {
      ws.send(chunk);
    }
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
        : Buffer.from(data);
    outbound.write(chunk);
  });

  ws.send(JSON.stringify({ type: "ready" }));
}

export async function handleC2SRelayTest(
  ws: WebSocket,
  message: C2SOpenMessage,
  userId: string,
): Promise<void> {
  const tunnelConfig = await resolveC2STunnelSource(
    message.tunnelConfig || {},
    userId,
  );
  const mode = getTunnelMode(tunnelConfig);
  const sourceClient = await connectC2SSourceClient(tunnelConfig);

  try {
    if (mode === "remote") {
      const bindHost = tunnelConfig.targetHost || "127.0.0.1";
      const bindPort = Number(tunnelConfig.sourcePort);
      if (!Number.isInteger(bindPort) || bindPort < 1 || bindPort > 65535) {
        throw new Error("Invalid remote port");
      }

      const actualPort = await bindForwardIn(sourceClient, bindHost, bindPort);
      unbindForwardIn(sourceClient, bindHost, actualPort);
    } else if (mode === "local") {
      const targetHost = tunnelConfig.targetHost || "127.0.0.1";
      const targetPort = Number(tunnelConfig.endpointPort);
      if (!Number.isInteger(targetPort) || targetPort < 1) {
        throw new Error("Invalid remote target port");
      }

      const outbound = await forwardOut(sourceClient, targetHost, targetPort);
      outbound.destroy();
    }

    sendC2SMessage(ws, { type: "ready" });
  } finally {
    try {
      sourceClient.end();
    } catch {
      // expected during shutdown
    }
  }
}
