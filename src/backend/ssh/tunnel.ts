import express, { type Response } from "express";
import { createServer, type IncomingMessage } from "http";
import { createCorsMiddleware } from "../utils/cors-config.js";
import cookieParser from "cookie-parser";
import { Client, type ClientChannel } from "ssh2";
import { WebSocketServer, type WebSocket } from "ws";
import { SSH_ALGORITHMS } from "../utils/ssh-algorithms.js";
import { ChildProcess } from "child_process";
import type { Duplex } from "stream";
import axios from "axios";
import { getDb } from "../database/db/index.js";
import { sshCredentials } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import type {
  SSHHost,
  TunnelConfig,
  TunnelStatus,
  VerificationData,
  ErrorType,
  AuthenticatedRequest,
} from "../../types/index.js";
import { CONNECTION_STATES } from "../../types/index.js";
import { tunnelLogger } from "../utils/logger.js";
import { SystemCrypto } from "../utils/system-crypto.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { DataCrypto } from "../utils/data-crypto.js";
import { createSocks5Connection } from "../utils/socks5-helper.js";
import { AuthManager } from "../utils/auth-manager.js";
import { PermissionManager } from "../utils/permission-manager.js";
import { withConnection } from "./ssh-connection-pool.js";

const app = express();
app.use(createCorsMiddleware(["GET", "POST", "PUT", "DELETE", "OPTIONS"]));
app.use(cookieParser());
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const authManager = AuthManager.getInstance();
const permissionManager = PermissionManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const activeTunnels = new Map<string, Client>();
const retryCounters = new Map<string, number>();
const connectionStatus = new Map<string, TunnelStatus>();
const tunnelVerifications = new Map<string, VerificationData>();
const manualDisconnects = new Set<string>();
const verificationTimers = new Map<string, NodeJS.Timeout>();
const activeRetryTimers = new Map<string, NodeJS.Timeout>();
const countdownIntervals = new Map<string, NodeJS.Timeout>();
const retryExhaustedTunnels = new Set<string>();
const cleanupInProgress = new Set<string>();
const tunnelConnecting = new Set<string>();
const lastTunnelErrors = new Map<string, string>();
const lastTunnelErrorTypes = new Map<string, ErrorType>();

const tunnelConfigs = new Map<string, TunnelConfig>();
const activeTunnelProcesses = new Map<string, ChildProcess>();
const pendingTunnelOperations = new Map<string, Promise<void>>();
const tunnelStatusClients = new Set<Response>();
let c2sRemoteStreamCounter = 0;
const C2S_WS_HIGH_WATERMARK = 1024 * 1024;
const C2S_WS_LOW_WATERMARK = 256 * 1024;
const C2S_STREAM_WRITE_LIMIT = 8 * 1024 * 1024;

type ActiveTunnelRuntime = {
  sourceClient: Client;
  endpointClient?: Client;
  bindClient?: Client;
  bindHost?: string;
  bindPort?: number;
  close: () => void;
};

const activeTunnelRuntimes = new Map<string, ActiveTunnelRuntime>();

type C2SOpenMessage = {
  type: "open" | "test";
  tunnelConfig?: Partial<TunnelConfig>;
  targetHost?: string;
  targetPort?: number;
};

function extractRequestToken(req: IncomingMessage): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)jwt=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }

  return undefined;
}

function sendC2SError(ws: WebSocket, message: string): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "error", error: message }));
  }
}

function describeC2SRelayError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("administratively prohibited") ||
    lowerMessage.includes("forwarding disabled") ||
    lowerMessage.includes("open failed")
  ) {
    return `SSH forwarding was rejected by the endpoint server: ${message}`;
  }
  if (
    lowerMessage.includes("address already in use") ||
    lowerMessage.includes("unable to bind") ||
    lowerMessage.includes("bind")
  ) {
    return `Remote port is not available on the endpoint server: ${message}`;
  }
  if (
    lowerMessage.includes("name or service not known") ||
    lowerMessage.includes("enotfound") ||
    lowerMessage.includes("econnrefused")
  ) {
    return `Tunnel target is not reachable from the endpoint host: ${message}`;
  }

  return message || "Failed to open relay";
}

function broadcastTunnelStatus(tunnelName: string, status: TunnelStatus): void {
  if (
    status.status === CONNECTION_STATES.CONNECTED &&
    activeRetryTimers.has(tunnelName)
  ) {
    return;
  }

  const nextStatus = { ...status };

  if (
    retryExhaustedTunnels.has(tunnelName) &&
    nextStatus.status === CONNECTION_STATES.FAILED
  ) {
    const previousReason = lastTunnelErrors.get(tunnelName);
    nextStatus.reason = previousReason
      ? `Max retries exhausted: ${previousReason}`
      : "Max retries exhausted";
  }

  if (nextStatus.status === CONNECTION_STATES.FAILED && nextStatus.reason) {
    lastTunnelErrors.set(tunnelName, nextStatus.reason);
    if (nextStatus.errorType) {
      lastTunnelErrorTypes.set(tunnelName, nextStatus.errorType);
    }
  } else if (
    (nextStatus.status === CONNECTION_STATES.CONNECTING ||
      nextStatus.status === CONNECTION_STATES.RETRYING ||
      nextStatus.status === CONNECTION_STATES.WAITING) &&
    !nextStatus.reason
  ) {
    nextStatus.reason = lastTunnelErrors.get(tunnelName);
    nextStatus.errorType = lastTunnelErrorTypes.get(tunnelName);
  } else if (
    nextStatus.status === CONNECTION_STATES.CONNECTED ||
    (nextStatus.status === CONNECTION_STATES.DISCONNECTED &&
      nextStatus.manualDisconnect)
  ) {
    lastTunnelErrors.delete(tunnelName);
    lastTunnelErrorTypes.delete(tunnelName);
  }

  connectionStatus.set(tunnelName, nextStatus);
  broadcastTunnelStatusSnapshot();
}

function getAllTunnelStatus(): Record<string, TunnelStatus> {
  const tunnelStatus: Record<string, TunnelStatus> = {};
  connectionStatus.forEach((status, key) => {
    tunnelStatus[key] = status;
  });
  return tunnelStatus;
}

function sendTunnelStatusSnapshot(res: Response): void {
  try {
    res.write(
      `event: statuses\ndata: ${JSON.stringify(getAllTunnelStatus())}\n\n`,
    );
  } catch {
    tunnelStatusClients.delete(res);
  }
}

function broadcastTunnelStatusSnapshot(): void {
  for (const client of tunnelStatusClients) {
    sendTunnelStatusSnapshot(client);
  }
}

function classifyError(errorMessage: string): ErrorType {
  if (!errorMessage) return "UNKNOWN";

  const message = errorMessage.toLowerCase();

  if (
    message.includes("closed by remote host") ||
    message.includes("connection reset by peer") ||
    message.includes("connection refused") ||
    message.includes("broken pipe")
  ) {
    return "NETWORK_ERROR";
  }

  if (
    message.includes("authentication failed") ||
    message.includes("permission denied") ||
    message.includes("incorrect password")
  ) {
    return "AUTHENTICATION_FAILED";
  }

  if (
    message.includes("connect etimedout") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("keepalive timeout")
  ) {
    return "TIMEOUT";
  }

  if (
    message.includes("bind: address already in use") ||
    message.includes("failed for listen port") ||
    message.includes("port forwarding failed")
  ) {
    return "CONNECTION_FAILED";
  }

  if (message.includes("permission") || message.includes("access denied")) {
    return "CONNECTION_FAILED";
  }

  return "UNKNOWN";
}

function getTunnelMarker(tunnelName: string) {
  return `TUNNEL_MARKER_${tunnelName.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function normalizeTunnelName(
  hostId: number,
  tunnelIndex: number,
  displayName: string,
  sourcePort: number,
  endpointHost: string,
  endpointPort: number,
): string {
  return `${hostId}::${tunnelIndex}::${displayName}::${sourcePort}::${endpointHost}::${endpointPort}`;
}

function parseTunnelName(tunnelName: string): {
  hostId?: number;
  tunnelIndex?: number;
  displayName: string;
  sourcePort: string;
  endpointHost: string;
  endpointPort: string;
  isLegacyFormat: boolean;
} {
  const parts = tunnelName.split("::");

  if (parts.length === 6) {
    return {
      hostId: parseInt(parts[0]),
      tunnelIndex: parseInt(parts[1]),
      displayName: parts[2],
      sourcePort: parts[3],
      endpointHost: parts[4],
      endpointPort: parts[5],
      isLegacyFormat: false,
    };
  }

  tunnelLogger.warn(`Legacy tunnel name format: ${tunnelName}`);

  const legacyParts = tunnelName.split("_");
  return {
    displayName: legacyParts[0] || "unknown",
    sourcePort: legacyParts[legacyParts.length - 3] || "0",
    endpointHost: legacyParts[legacyParts.length - 2] || "unknown",
    endpointPort: legacyParts[legacyParts.length - 1] || "0",
    isLegacyFormat: true,
  };
}

function validateTunnelConfig(
  tunnelName: string,
  tunnelConfig: TunnelConfig,
): boolean {
  const parsed = parseTunnelName(tunnelName);

  if (parsed.isLegacyFormat) {
    return true;
  }

  return (
    parsed.hostId === tunnelConfig.sourceHostId &&
    parsed.tunnelIndex === tunnelConfig.tunnelIndex &&
    String(parsed.sourcePort) === String(tunnelConfig.sourcePort) &&
    parsed.endpointHost === tunnelConfig.endpointHost &&
    String(parsed.endpointPort) === String(tunnelConfig.endpointPort)
  );
}

async function cleanupTunnelResources(
  tunnelName: string,
  forceCleanup = false,
): Promise<void> {
  if (cleanupInProgress.has(tunnelName)) {
    return;
  }

  if (!forceCleanup && tunnelConnecting.has(tunnelName)) {
    return;
  }

  cleanupInProgress.add(tunnelName);

  const tunnelConfig = tunnelConfigs.get(tunnelName);
  const runtime = activeTunnelRuntimes.get(tunnelName);
  if (runtime) {
    try {
      runtime.close();
    } catch (error) {
      tunnelLogger.error("Error while closing managed tunnel runtime", error, {
        operation: "managed_tunnel_cleanup",
        tunnelName,
      });
    }
    activeTunnelRuntimes.delete(tunnelName);
    cleanupInProgress.delete(tunnelName);
  } else if (tunnelConfig) {
    await new Promise<void>((resolve) => {
      killRemoteTunnelByMarker(tunnelConfig, tunnelName, (err) => {
        cleanupInProgress.delete(tunnelName);
        if (err) {
          tunnelLogger.error(
            `Failed to kill remote tunnel for '${tunnelName}': ${err.message}`,
          );
        }
        resolve();
      });
    });
  } else {
    cleanupInProgress.delete(tunnelName);
  }

  if (activeTunnelProcesses.has(tunnelName)) {
    try {
      const proc = activeTunnelProcesses.get(tunnelName);
      if (proc) {
        proc.kill("SIGTERM");
      }
    } catch (e) {
      tunnelLogger.error(
        `Error while killing local ssh process for tunnel '${tunnelName}'`,
        e,
      );
    }
    activeTunnelProcesses.delete(tunnelName);
  }

  if (activeTunnels.has(tunnelName)) {
    try {
      const conn = activeTunnels.get(tunnelName);
      if (conn) {
        conn.end();
      }
    } catch (e) {
      tunnelLogger.error(
        `Error while closing SSH2 Client for tunnel '${tunnelName}'`,
        e,
      );
    }
    activeTunnels.delete(tunnelName);
  }

  if (tunnelVerifications.has(tunnelName)) {
    const verification = tunnelVerifications.get(tunnelName);
    if (verification?.timeout) clearTimeout(verification.timeout);
    try {
      verification?.conn.end();
    } catch (error) {
      tunnelLogger.error("Error during tunnel cleanup", error, {
        operation: "tunnel_cleanup_error",
        tunnelName,
      });
    }
    tunnelVerifications.delete(tunnelName);
  }

  const timerKeys = [
    tunnelName,
    `${tunnelName}_confirm`,
    `${tunnelName}_retry`,
    `${tunnelName}_verify_retry`,
    `${tunnelName}_ping`,
  ];

  timerKeys.forEach((key) => {
    if (verificationTimers.has(key)) {
      clearTimeout(verificationTimers.get(key)!);
      verificationTimers.delete(key);
    }
  });

  if (activeRetryTimers.has(tunnelName)) {
    clearTimeout(activeRetryTimers.get(tunnelName)!);
    activeRetryTimers.delete(tunnelName);
  }

  if (countdownIntervals.has(tunnelName)) {
    clearInterval(countdownIntervals.get(tunnelName)!);
    countdownIntervals.delete(tunnelName);
  }
}

function resetRetryState(tunnelName: string): void {
  retryCounters.delete(tunnelName);
  retryExhaustedTunnels.delete(tunnelName);
  lastTunnelErrors.delete(tunnelName);
  lastTunnelErrorTypes.delete(tunnelName);
  cleanupInProgress.delete(tunnelName);
  tunnelConnecting.delete(tunnelName);

  if (activeRetryTimers.has(tunnelName)) {
    clearTimeout(activeRetryTimers.get(tunnelName)!);
    activeRetryTimers.delete(tunnelName);
  }

  if (countdownIntervals.has(tunnelName)) {
    clearInterval(countdownIntervals.get(tunnelName)!);
    countdownIntervals.delete(tunnelName);
  }

  ["", "_confirm", "_retry", "_verify_retry", "_ping"].forEach((suffix) => {
    const timerKey = `${tunnelName}${suffix}`;
    if (verificationTimers.has(timerKey)) {
      clearTimeout(verificationTimers.get(timerKey)!);
      verificationTimers.delete(timerKey);
    }
  });
}

async function handleDisconnect(
  tunnelName: string,
  tunnelConfig: TunnelConfig | null,
  shouldRetry = true,
): Promise<void> {
  if (tunnelVerifications.has(tunnelName)) {
    try {
      const verification = tunnelVerifications.get(tunnelName);
      if (verification?.timeout) clearTimeout(verification.timeout);
      verification?.conn.end();
    } catch (error) {
      tunnelLogger.error("Error during tunnel cleanup", error, {
        operation: "tunnel_cleanup_error",
        tunnelName,
      });
    }
    tunnelVerifications.delete(tunnelName);
  }

  while (cleanupInProgress.has(tunnelName)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await cleanupTunnelResources(tunnelName);

  if (manualDisconnects.has(tunnelName)) {
    resetRetryState(tunnelName);

    broadcastTunnelStatus(tunnelName, {
      connected: false,
      status: CONNECTION_STATES.DISCONNECTED,
      manualDisconnect: true,
    });
    return;
  }

  if (retryExhaustedTunnels.has(tunnelName)) {
    broadcastTunnelStatus(tunnelName, {
      connected: false,
      status: CONNECTION_STATES.FAILED,
      reason: "Max retries already exhausted",
    });
    return;
  }

  if (activeRetryTimers.has(tunnelName)) {
    return;
  }

  if (shouldRetry && tunnelConfig) {
    const maxRetries = tunnelConfig.maxRetries || 3;
    const retryInterval = tunnelConfig.retryInterval || 5000;

    let retryCount = retryCounters.get(tunnelName) || 0;
    retryCount = retryCount + 1;

    if (retryCount > maxRetries) {
      tunnelLogger.error(`All ${maxRetries} retries failed for ${tunnelName}`);

      retryExhaustedTunnels.add(tunnelName);
      activeTunnels.delete(tunnelName);
      retryCounters.delete(tunnelName);

      broadcastTunnelStatus(tunnelName, {
        connected: false,
        status: CONNECTION_STATES.FAILED,
        retryExhausted: true,
        reason: `Max retries exhausted`,
      });
      return;
    }

    retryCounters.set(tunnelName, retryCount);

    if (retryCount <= maxRetries) {
      broadcastTunnelStatus(tunnelName, {
        connected: false,
        status: CONNECTION_STATES.RETRYING,
        retryCount: retryCount,
        maxRetries: maxRetries,
        nextRetryIn: retryInterval / 1000,
      });

      if (activeRetryTimers.has(tunnelName)) {
        clearTimeout(activeRetryTimers.get(tunnelName)!);
        activeRetryTimers.delete(tunnelName);
      }

      const initialNextRetryIn = Math.ceil(retryInterval / 1000);
      let currentNextRetryIn = initialNextRetryIn;

      broadcastTunnelStatus(tunnelName, {
        connected: false,
        status: CONNECTION_STATES.WAITING,
        retryCount: retryCount,
        maxRetries: maxRetries,
        nextRetryIn: currentNextRetryIn,
      });

      const countdownInterval = setInterval(() => {
        currentNextRetryIn--;
        if (currentNextRetryIn > 0) {
          broadcastTunnelStatus(tunnelName, {
            connected: false,
            status: CONNECTION_STATES.WAITING,
            retryCount: retryCount,
            maxRetries: maxRetries,
            nextRetryIn: currentNextRetryIn,
          });
        }
      }, 1000);

      countdownIntervals.set(tunnelName, countdownInterval);

      const timer = setTimeout(() => {
        clearInterval(countdownInterval);
        countdownIntervals.delete(tunnelName);
        activeRetryTimers.delete(tunnelName);

        if (!manualDisconnects.has(tunnelName)) {
          activeTunnels.delete(tunnelName);
          connectSSHTunnel(tunnelConfig, retryCount).catch((error) => {
            tunnelLogger.error(
              `Failed to connect tunnel ${tunnelConfig.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          });
        }
      }, retryInterval);

      activeRetryTimers.set(tunnelName, timer);
    }
  } else {
    broadcastTunnelStatus(tunnelName, {
      connected: false,
      status: CONNECTION_STATES.FAILED,
    });

    activeTunnels.delete(tunnelName);
  }
}

function setupPingInterval(tunnelName: string): void {
  const pingKey = `${tunnelName}_ping`;
  if (verificationTimers.has(pingKey)) {
    clearInterval(verificationTimers.get(pingKey)!);
    verificationTimers.delete(pingKey);
  }

  const pingInterval = setInterval(() => {
    const currentStatus = connectionStatus.get(tunnelName);
    if (currentStatus?.status === CONNECTION_STATES.CONNECTED) {
      if (!activeTunnels.has(tunnelName)) {
        broadcastTunnelStatus(tunnelName, {
          connected: false,
          status: CONNECTION_STATES.DISCONNECTED,
          reason: "Tunnel connection lost",
        });
        clearInterval(pingInterval);
        verificationTimers.delete(pingKey);
      }
    } else {
      clearInterval(pingInterval);
      verificationTimers.delete(pingKey);
    }
  }, 120000);

  verificationTimers.set(pingKey, pingInterval);
}

function getTunnelMode(
  tunnelConfig: TunnelConfig,
): "local" | "remote" | "dynamic" {
  return tunnelConfig.mode || tunnelConfig.tunnelType || "remote";
}

function getTunnelScope(tunnelConfig: TunnelConfig): "s2s" | "c2s" {
  return tunnelConfig.scope || "s2s";
}

function getTunnelBindHost(tunnelConfig: TunnelConfig): string {
  return tunnelConfig.bindHost || "127.0.0.1";
}

function getManagedTunnelAlgorithms() {
  return {
    kex: [
      "curve25519-sha256",
      "curve25519-sha256@libssh.org",
      "ecdh-sha2-nistp521",
      "ecdh-sha2-nistp384",
      "ecdh-sha2-nistp256",
      "diffie-hellman-group-exchange-sha256",
      "diffie-hellman-group14-sha256",
      "diffie-hellman-group14-sha1",
      "diffie-hellman-group-exchange-sha1",
      "diffie-hellman-group1-sha1",
    ],
    serverHostKey: [
      "ssh-ed25519",
      "ecdsa-sha2-nistp521",
      "ecdsa-sha2-nistp384",
      "ecdsa-sha2-nistp256",
      "rsa-sha2-512",
      "rsa-sha2-256",
      "ssh-rsa",
      "ssh-dss",
    ],
    cipher: SSH_ALGORITHMS.cipher,
    hmac: [
      "hmac-sha2-512-etm@openssh.com",
      "hmac-sha2-256-etm@openssh.com",
      "hmac-sha2-512",
      "hmac-sha2-256",
      "hmac-sha1",
      "hmac-md5",
    ],
    compress: ["none", "zlib@openssh.com", "zlib"],
  };
}

function applyAuthOptions(
  connOptions: Record<string, unknown>,
  credentials: {
    password?: string;
    sshKey?: string;
    keyPassword?: string;
    keyType?: string;
    authMethod?: string;
  },
): void {
  if (credentials.authMethod === "key" && credentials.sshKey) {
    const cleanKey = credentials.sshKey
      .trim()
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    connOptions.privateKey = Buffer.from(cleanKey, "utf8");
    if (credentials.keyPassword) {
      connOptions.passphrase = credentials.keyPassword;
    }
    if (credentials.keyType && credentials.keyType !== "auto") {
      connOptions.privateKeyType = credentials.keyType;
    }
  } else {
    connOptions.password = credentials.password;
  }
}

function connectClient(
  connOptions: Record<string, unknown>,
  tunnelName: string,
  role: "source" | "endpoint",
): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    client.once("ready", () => {
      settled = true;
      resolve(client);
    });
    client.once("error", (error) => {
      if (!settled) {
        reject(error);
        return;
      }
      tunnelLogger.error("Managed tunnel SSH client error", error, {
        operation: "managed_tunnel_client_error",
        tunnelName,
        role,
      });
    });
    client.connect(connOptions);
  });
}

function forwardOut(
  client: Client,
  targetHost: string,
  targetPort: number,
  tunnelName?: string,
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.forwardOut("127.0.0.1", 0, targetHost, targetPort, (err, stream) => {
      if (err) {
        if (tunnelName) {
          tunnelLogger.error("Managed tunnel forwardOut failed", err, {
            operation: "managed_tunnel_forward_out_failed",
            tunnelName,
            targetHost,
            targetPort,
          });
        }
        reject(err);
        return;
      }
      resolve(stream);
    });
  });
}

function bindForwardIn(
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

function unbindForwardIn(
  client: Client,
  bindHost: string,
  bindPort: number,
): void {
  try {
    client.unforwardIn(bindHost, bindPort, (err) => {
      if (err) {
        tunnelLogger.warn("Failed to unbind managed tunnel listener", {
          operation: "managed_tunnel_unforward_failed",
          bindHost,
          bindPort,
          error: err.message,
        });
      }
    });
  } catch {
    // The connection may already be gone.
  }
}

function pipeTunnelStreams(
  inbound: Duplex,
  outboundPromise: Promise<Duplex>,
  tunnelName: string,
): void {
  outboundPromise
    .then((outbound) => {
      inbound.pipe(outbound).pipe(inbound);
      inbound.on("error", () => outbound.destroy());
      outbound.on("error", () => inbound.destroy());
    })
    .catch((error) => {
      tunnelLogger.error(
        "Failed to open managed tunnel outbound stream",
        error,
        {
          operation: "managed_tunnel_outbound_failed",
          tunnelName,
        },
      );
      inbound.destroy();
    });
}

function parseSocksAddress(buffer: Buffer): {
  address: string;
  port: number;
  bytesRead: number;
} | null {
  if (buffer.length < 7 || buffer[0] !== 0x05 || buffer[1] !== 0x01) {
    return null;
  }

  const addressType = buffer[3];
  let offset = 4;
  let address: string;

  if (addressType === 0x01) {
    if (buffer.length < offset + 4 + 2) return null;
    address = Array.from(buffer.subarray(offset, offset + 4)).join(".");
    offset += 4;
  } else if (addressType === 0x03) {
    const len = buffer[offset];
    offset += 1;
    if (buffer.length < offset + len + 2) return null;
    address = buffer.subarray(offset, offset + len).toString("utf8");
    offset += len;
  } else if (addressType === 0x04) {
    if (buffer.length < offset + 16 + 2) return null;
    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(buffer.readUInt16BE(offset + i).toString(16));
    }
    address = parts.join(":");
    offset += 16;
  } else {
    return null;
  }

  const port = buffer.readUInt16BE(offset);
  return { address, port, bytesRead: offset + 2 };
}

function handleSocks5Connect(
  inbound: Duplex,
  openOutbound: (host: string, port: number) => Promise<Duplex>,
  tunnelName: string,
): void {
  let buffer = Buffer.alloc(0);
  let stage: "greeting" | "connect" | "piping" = "greeting";

  const fail = (code = 0x01) => {
    if (!inbound.destroyed) {
      inbound.write(Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      inbound.destroy();
    }
  };

  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    if (stage === "greeting") {
      if (buffer.length < 2) return;
      if (buffer[0] !== 0x05) {
        fail(0x01);
        return;
      }
      const methodsLength = buffer[1];
      if (buffer.length < 2 + methodsLength) return;
      inbound.write(Buffer.from([0x05, 0x00]));
      buffer = buffer.subarray(2 + methodsLength);
      stage = "connect";
    }

    if (stage === "connect") {
      const parsed = parseSocksAddress(buffer);
      if (!parsed) return;
      stage = "piping";
      inbound.off("data", onData);
      const remainder = buffer.subarray(parsed.bytesRead);
      openOutbound(parsed.address, parsed.port)
        .then((outbound) => {
          inbound.write(
            Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
          );
          if (remainder.length > 0) {
            outbound.write(remainder);
          }
          inbound.pipe(outbound).pipe(inbound);
          inbound.on("error", () => outbound.destroy());
          outbound.on("error", () => inbound.destroy());
        })
        .catch((error) => {
          tunnelLogger.error("SOCKS5 tunnel connect failed", error, {
            operation: "managed_tunnel_socks_connect_failed",
            tunnelName,
            targetHost: parsed.address,
            targetPort: parsed.port,
          });
          fail(0x05);
        });
    }
  };

  inbound.on("data", onData);
  inbound.on("error", () => inbound.destroy());
}

async function connectEndpointThroughSource(
  sourceClient: Client,
  tunnelConfig: TunnelConfig,
  endpointCredentials: {
    password?: string;
    sshKey?: string;
    keyPassword?: string;
    keyType?: string;
    authMethod?: string;
  },
): Promise<Client> {
  const endpointSock = await forwardOut(
    sourceClient,
    tunnelConfig.endpointIP,
    tunnelConfig.endpointSSHPort,
    tunnelConfig.name,
  );
  const endpointOptions: Record<string, unknown> = {
    sock: endpointSock,
    username: tunnelConfig.endpointUsername,
    tryKeyboard: true,
    keepaliveInterval: 30000,
    keepaliveCountMax: 3,
    readyTimeout: 60000,
    tcpKeepAlive: true,
    tcpKeepAliveInitialDelay: 30000,
    algorithms: getManagedTunnelAlgorithms(),
  };

  applyAuthOptions(endpointOptions, endpointCredentials);
  return connectClient(endpointOptions, tunnelConfig.name, "endpoint");
}

function resolveS2SLocalTargetHost(tunnelConfig: TunnelConfig): string {
  const targetHost = tunnelConfig.targetHost?.trim();

  if (
    !targetHost ||
    targetHost === tunnelConfig.endpointHost ||
    targetHost === tunnelConfig.hostName
  ) {
    return "127.0.0.1";
  }

  return targetHost;
}

async function establishManagedS2STunnel(
  sourceClient: Client,
  tunnelConfig: TunnelConfig,
  endpointCredentials: {
    password?: string;
    sshKey?: string;
    keyPassword?: string;
    keyType?: string;
    authMethod?: string;
  },
): Promise<void> {
  const tunnelName = tunnelConfig.name;
  const mode = getTunnelMode(tunnelConfig);
  const bindHost = getTunnelBindHost(tunnelConfig);
  const endpointClient = await connectEndpointThroughSource(
    sourceClient,
    tunnelConfig,
    endpointCredentials,
  );

  const bindClient = mode === "remote" ? endpointClient : sourceClient;
  const outboundClient = mode === "remote" ? sourceClient : endpointClient;
  const bindPort =
    mode === "remote" ? tunnelConfig.endpointPort : tunnelConfig.sourcePort;
  const staticTargetHost =
    mode === "remote"
      ? tunnelConfig.targetHost || "127.0.0.1"
      : resolveS2SLocalTargetHost(tunnelConfig);
  const staticTargetPort =
    mode === "remote" ? tunnelConfig.sourcePort : tunnelConfig.endpointPort;

  tunnelLogger.info("Managed S2S tunnel route resolved", {
    operation: "managed_tunnel_route_resolved",
    tunnelName,
    mode,
    bindHost,
    bindPort,
    targetHost: staticTargetHost,
    targetPort: staticTargetPort,
    endpointHost: tunnelConfig.endpointHost,
    endpointIP: tunnelConfig.endpointIP,
  });

  const actualPort = await bindForwardIn(bindClient, bindHost, bindPort);

  const tcpHandler = (
    info: {
      destIP: string;
      destPort: number;
      srcIP: string;
      srcPort: number;
    },
    accept: () => ClientChannel,
    reject: () => void,
  ) => {
    if (info.destPort !== actualPort) {
      reject();
      return;
    }

    const inbound = accept();
    if (mode === "dynamic") {
      handleSocks5Connect(
        inbound,
        (host, port) => forwardOut(outboundClient, host, port),
        tunnelName,
      );
      return;
    }

    pipeTunnelStreams(
      inbound,
      forwardOut(
        outboundClient,
        staticTargetHost,
        staticTargetPort,
        tunnelName,
      ),
      tunnelName,
    );
  };

  bindClient.on("tcp connection", tcpHandler);

  const close = () => {
    bindClient.off("tcp connection", tcpHandler);
    unbindForwardIn(bindClient, bindHost, actualPort);
    try {
      endpointClient.end();
    } catch {
      // expected during shutdown
    }
    try {
      sourceClient.end();
    } catch {
      // expected during shutdown
    }
  };

  activeTunnelRuntimes.set(tunnelName, {
    sourceClient,
    endpointClient,
    bindClient,
    bindHost,
    bindPort: actualPort,
    close,
  });

  activeTunnels.set(tunnelName, sourceClient);
}

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
    keepaliveInterval: 30000,
    keepaliveCountMax: 3,
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

function pauseSourceForC2SWebSocket(ws: WebSocket, source?: Duplex): void {
  if (!source) return;
  if (ws.bufferedAmount <= C2S_WS_HIGH_WATERMARK) return;

  source.pause();
  const resumeTimer = setInterval(() => {
    if (
      ws.readyState !== 1 ||
      source.destroyed ||
      ws.bufferedAmount <= C2S_WS_LOW_WATERMARK
    ) {
      clearInterval(resumeTimer);
      if (ws.readyState === 1 && !source.destroyed) {
        source.resume();
      }
    }
  }, 25);
}

function sendC2SMessage(
  ws: WebSocket,
  message: Record<string, unknown>,
  source?: Duplex,
): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message), (error) => {
      if (error && source && !source.destroyed) {
        source.destroy(error);
      }
    });
    pauseSourceForC2SWebSocket(ws, source);
  }
}

function writeC2SRemoteChunk(
  target: ClientChannel,
  chunk: Buffer,
  ws: WebSocket,
  closeTarget: () => void,
): void {
  if (!target || target.destroyed) return;

  if (target.writableLength > C2S_STREAM_WRITE_LIMIT) {
    closeTarget();
    return;
  }

  const canContinue = target.write(chunk);
  if (!canContinue) {
    ws.pause();
    target.once("drain", () => {
      if (ws.readyState === 1) {
        ws.resume();
      }
    });
  }
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

async function handleC2SRelayOpen(
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

async function handleC2SRelayTest(
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

async function connectSSHTunnel(
  tunnelConfig: TunnelConfig,
  retryAttempt = 0,
): Promise<void> {
  const tunnelName = tunnelConfig.name;
  tunnelLogger.info("Tunnel creation request received", {
    operation: "tunnel_create_request",
    userId: tunnelConfig.sourceUserId,
    hostId: tunnelConfig.sourceHostId,
    tunnelName,
    tunnelType: tunnelConfig.tunnelType || "remote",
    sourcePort: tunnelConfig.sourcePort,
    endpointHost: tunnelConfig.endpointHost,
    endpointPort: tunnelConfig.endpointPort,
  });

  if (manualDisconnects.has(tunnelName)) {
    return;
  }

  tunnelConnecting.add(tunnelName);

  await cleanupTunnelResources(tunnelName, true);

  if (retryAttempt === 0) {
    retryExhaustedTunnels.delete(tunnelName);
    retryCounters.delete(tunnelName);
  }

  const currentStatus = connectionStatus.get(tunnelName);
  if (!currentStatus || currentStatus.status !== CONNECTION_STATES.WAITING) {
    broadcastTunnelStatus(tunnelName, {
      connected: false,
      status: CONNECTION_STATES.CONNECTING,
      retryCount: retryAttempt > 0 ? retryAttempt : undefined,
    });
  }

  if (
    !tunnelConfig ||
    !tunnelConfig.sourceIP ||
    !tunnelConfig.sourceUsername ||
    !tunnelConfig.sourceSSHPort
  ) {
    const missingFields = [];
    if (!tunnelConfig) missingFields.push("tunnelConfig");
    if (!tunnelConfig?.sourceIP) missingFields.push("sourceIP");
    if (!tunnelConfig?.sourceUsername) missingFields.push("sourceUsername");
    if (!tunnelConfig?.sourceSSHPort) missingFields.push("sourceSSHPort");

    tunnelLogger.error("Invalid tunnel connection details", undefined, {
      operation: "tunnel_connect_validation_failed",
      tunnelName,
      missingFields: missingFields.join(", "),
      hasSourceIP: !!tunnelConfig?.sourceIP,
      hasSourceUsername: !!tunnelConfig?.sourceUsername,
      hasSourceSSHPort: !!tunnelConfig?.sourceSSHPort,
    });
    broadcastTunnelStatus(tunnelName, {
      connected: false,
      status: CONNECTION_STATES.FAILED,
      reason: "Missing required connection details",
    });
    tunnelConnecting.delete(tunnelName);
    return;
  }

  let resolvedSourceCredentials = {
    password: tunnelConfig.sourcePassword,
    sshKey: tunnelConfig.sourceSSHKey,
    keyPassword: tunnelConfig.sourceKeyPassword,
    keyType: tunnelConfig.sourceKeyType,
    authMethod: tunnelConfig.sourceAuthMethod,
  };

  const effectiveUserId =
    tunnelConfig.requestingUserId || tunnelConfig.sourceUserId;

  // Resolve source credentials server-side when not provided by frontend
  if (
    tunnelConfig.sourceHostId &&
    effectiveUserId &&
    !tunnelConfig.sourcePassword &&
    !tunnelConfig.sourceSSHKey
  ) {
    try {
      const { resolveHostById } = await import("./host-resolver.js");
      const resolvedHost = await resolveHostById(
        tunnelConfig.sourceHostId,
        effectiveUserId,
      );
      if (resolvedHost) {
        resolvedSourceCredentials = {
          password: resolvedHost.password,
          sshKey: resolvedHost.key,
          keyPassword: resolvedHost.keyPassword,
          keyType: resolvedHost.keyType,
          authMethod: resolvedHost.authType,
        };
      }
    } catch (error) {
      tunnelLogger.warn("Failed to resolve source host credentials", {
        operation: "tunnel_connect",
        tunnelName,
        sourceHostId: tunnelConfig.sourceHostId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  } else if (tunnelConfig.sourceCredentialId && effectiveUserId) {
    // Legacy: credential resolution from credentialId
    try {
      if (tunnelConfig.sourceHostId) {
        const { resolveHostById } = await import("./host-resolver.js");
        const resolvedHost = await resolveHostById(
          tunnelConfig.sourceHostId,
          effectiveUserId,
        );
        if (resolvedHost) {
          resolvedSourceCredentials = {
            password: resolvedHost.password,
            sshKey: resolvedHost.key,
            keyPassword: resolvedHost.keyPassword,
            keyType: resolvedHost.keyType,
            authMethod: resolvedHost.authType,
          };
        }
      }
    } catch (error) {
      tunnelLogger.warn("Failed to resolve source credentials", {
        operation: "tunnel_connect",
        tunnelName,
        credentialId: tunnelConfig.sourceCredentialId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  let resolvedEndpointCredentials = {
    password: tunnelConfig.endpointPassword,
    sshKey: tunnelConfig.endpointSSHKey,
    keyPassword: tunnelConfig.endpointKeyPassword,
    keyType: tunnelConfig.endpointKeyType,
    authMethod: tunnelConfig.endpointAuthMethod,
  };

  if (tunnelConfig.endpointCredentialId && tunnelConfig.endpointUserId) {
    try {
      const userDataKey = DataCrypto.getUserDataKey(
        tunnelConfig.endpointUserId,
      );
      if (userDataKey) {
        const credentials = await SimpleDBOps.select(
          getDb()
            .select()
            .from(sshCredentials)
            .where(eq(sshCredentials.id, tunnelConfig.endpointCredentialId)),
          "ssh_credentials",
          tunnelConfig.endpointUserId,
        );

        if (credentials.length > 0) {
          const credential = credentials[0];
          resolvedEndpointCredentials = {
            password: credential.password as string | undefined,
            sshKey: credential.privateKey as string | undefined,
            keyPassword: credential.keyPassword as string | undefined,
            keyType: credential.keyType as string | undefined,
            authMethod: credential.authType as string,
          };
        } else {
          tunnelLogger.warn("No endpoint credentials found in database", {
            operation: "tunnel_connect",
            tunnelName,
            credentialId: tunnelConfig.endpointCredentialId,
          });
        }
      }
    } catch (error) {
      tunnelLogger.warn(
        `Failed to resolve endpoint credentials for tunnel ${tunnelName}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  } else if (tunnelConfig.endpointCredentialId) {
    tunnelLogger.warn("Missing userId for endpoint credential resolution", {
      operation: "tunnel_connect",
      tunnelName,
      credentialId: tunnelConfig.endpointCredentialId,
      hasUserId: !!tunnelConfig.endpointUserId,
    });
  }

  if (
    resolvedEndpointCredentials.authMethod === "password" &&
    !resolvedEndpointCredentials.password
  ) {
    const errorMessage = `Cannot connect tunnel '${tunnelName}': endpoint host requires password authentication but no plaintext password available. Enable autostart for endpoint host or configure credentials in tunnel connection.`;
    tunnelLogger.error(errorMessage, undefined, {
      operation: "tunnel_endpoint_password_unavailable",
      tunnelName,
      endpointHost: `${tunnelConfig.endpointUsername}@${tunnelConfig.endpointIP}:${tunnelConfig.endpointPort}`,
      endpointAuthMethod: resolvedEndpointCredentials.authMethod,
    });
    broadcastTunnelStatus(tunnelName, {
      connected: false,
      status: CONNECTION_STATES.FAILED,
      reason: errorMessage,
    });
    tunnelConnecting.delete(tunnelName);
    return;
  }

  if (
    resolvedEndpointCredentials.authMethod === "key" &&
    !resolvedEndpointCredentials.sshKey
  ) {
    const errorMessage = `Cannot connect tunnel '${tunnelName}': endpoint host requires key authentication but no plaintext key available. Enable autostart for endpoint host or configure credentials in tunnel connection.`;
    tunnelLogger.error(errorMessage, undefined, {
      operation: "tunnel_endpoint_key_unavailable",
      tunnelName,
      endpointHost: `${tunnelConfig.endpointUsername}@${tunnelConfig.endpointIP}:${tunnelConfig.endpointPort}`,
      endpointAuthMethod: resolvedEndpointCredentials.authMethod,
    });
    broadcastTunnelStatus(tunnelName, {
      connected: false,
      status: CONNECTION_STATES.FAILED,
      reason: errorMessage,
    });
    tunnelConnecting.delete(tunnelName);
    return;
  }

  const conn = new Client();

  const connectionTimeout = setTimeout(() => {
    if (conn) {
      if (activeRetryTimers.has(tunnelName)) {
        return;
      }

      tunnelLogger.error(
        `Tunnel connection timeout after 60 seconds for '${tunnelName}'`,
        undefined,
        {
          operation: "tunnel_connection_timeout",
          tunnelName,
          sourceHost: `${tunnelConfig.sourceUsername}@${tunnelConfig.sourceIP}:${tunnelConfig.sourceSSHPort}`,
          endpointHost: `${tunnelConfig.endpointUsername}@${tunnelConfig.endpointIP}:${tunnelConfig.endpointPort}`,
          retryAttempt,
          usingSocks5: tunnelConfig.useSocks5 || false,
        },
      );

      try {
        conn.end();
      } catch {
        // expected
      }

      activeTunnels.delete(tunnelName);

      if (!activeRetryTimers.has(tunnelName)) {
        handleDisconnect(
          tunnelName,
          tunnelConfig,
          !manualDisconnects.has(tunnelName),
        );
      }
    }
  }, 60000);

  conn.on("error", (err) => {
    clearTimeout(connectionTimeout);

    const errorType = classifyError(err.message);

    tunnelLogger.error(`Tunnel connection failed for '${tunnelName}'`, err, {
      operation: "tunnel_connect_error",
      tunnelName,
      errorType,
      errorMessage: err.message,
      sourceHost: `${tunnelConfig.sourceUsername}@${tunnelConfig.sourceIP}:${tunnelConfig.sourceSSHPort}`,
      endpointHost: `${tunnelConfig.endpointUsername}@${tunnelConfig.endpointIP}:${tunnelConfig.endpointPort}`,
      tunnelType: tunnelConfig.tunnelType || "remote",
      sourcePort: tunnelConfig.sourcePort,
      retryAttempt,
      usingSocks5: tunnelConfig.useSocks5 || false,
      authMethod: tunnelConfig.sourceAuthMethod,
    });

    tunnelConnecting.delete(tunnelName);

    if (activeRetryTimers.has(tunnelName)) {
      return;
    }

    if (!manualDisconnects.has(tunnelName)) {
      broadcastTunnelStatus(tunnelName, {
        connected: false,
        status: CONNECTION_STATES.FAILED,
        errorType: errorType,
        reason: err.message,
      });
    }

    activeTunnels.delete(tunnelName);

    const shouldNotRetry =
      errorType === "AUTHENTICATION_FAILED" ||
      errorType === "CONNECTION_FAILED" ||
      manualDisconnects.has(tunnelName);

    handleDisconnect(tunnelName, tunnelConfig, !shouldNotRetry);
  });

  conn.on("close", () => {
    clearTimeout(connectionTimeout);

    tunnelConnecting.delete(tunnelName);

    if (activeRetryTimers.has(tunnelName)) {
      return;
    }

    if (!manualDisconnects.has(tunnelName)) {
      const currentStatus = connectionStatus.get(tunnelName);
      if (!currentStatus || currentStatus.status !== CONNECTION_STATES.FAILED) {
        broadcastTunnelStatus(tunnelName, {
          connected: false,
          status: CONNECTION_STATES.DISCONNECTED,
        });
      }

      if (!activeRetryTimers.has(tunnelName)) {
        handleDisconnect(
          tunnelName,
          tunnelConfig,
          !manualDisconnects.has(tunnelName),
        );
      }
    }
  });

  conn.on("ready", async () => {
    clearTimeout(connectionTimeout);
    tunnelLogger.info("Creating managed SSH tunnel", {
      operation: "managed_tunnel_connection_create",
      userId: tunnelConfig.sourceUserId,
      hostId: tunnelConfig.sourceHostId,
      tunnelName,
      scope: getTunnelScope(tunnelConfig),
      mode: getTunnelMode(tunnelConfig),
    });

    const isAlreadyVerifying = tunnelVerifications.has(tunnelName);
    if (isAlreadyVerifying) {
      return;
    }

    try {
      if (getTunnelScope(tunnelConfig) !== "s2s") {
        throw new Error(
          "C2S tunnels must be started from the desktop client local configuration",
        );
      }

      await establishManagedS2STunnel(
        conn,
        tunnelConfig,
        resolvedEndpointCredentials,
      );

      tunnelConnecting.delete(tunnelName);
      tunnelLogger.success("Managed tunnel creation complete", {
        operation: "managed_tunnel_create_complete",
        userId: tunnelConfig.sourceUserId,
        hostId: tunnelConfig.sourceHostId,
        tunnelName,
        mode: getTunnelMode(tunnelConfig),
        sourcePort: tunnelConfig.sourcePort,
        endpointPort: tunnelConfig.endpointPort,
      });

      broadcastTunnelStatus(tunnelName, {
        connected: true,
        status: CONNECTION_STATES.CONNECTED,
      });
      setupPingInterval(tunnelName);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create tunnel";
      const errorType = classifyError(message);
      tunnelLogger.error("Failed to create managed tunnel", error, {
        operation: "managed_tunnel_create_failed",
        tunnelName,
        errorType,
        retryAttempt,
      });
      tunnelConnecting.delete(tunnelName);
      activeTunnels.delete(tunnelName);
      activeTunnelRuntimes.delete(tunnelName);
      try {
        conn.end();
      } catch {
        // expected
      }
      broadcastTunnelStatus(tunnelName, {
        connected: false,
        status: CONNECTION_STATES.FAILED,
        errorType,
        reason: message,
      });
      const shouldNotRetry =
        errorType === "AUTHENTICATION_FAILED" ||
        errorType === "CONNECTION_FAILED";
      handleDisconnect(tunnelName, tunnelConfig, !shouldNotRetry);
    }
  });

  const connOptions: Record<string, unknown> = {
    host:
      tunnelConfig.sourceIP?.replace(/^\[|\]$/g, "") || tunnelConfig.sourceIP,
    port: tunnelConfig.sourceSSHPort,
    username: tunnelConfig.sourceUsername,
    tryKeyboard: true,
    keepaliveInterval: 30000,
    keepaliveCountMax: 3,
    readyTimeout: 60000,
    tcpKeepAlive: true,
    tcpKeepAliveInitialDelay: 30000,
    env: {
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      LC_CTYPE: "en_US.UTF-8",
      LC_MESSAGES: "en_US.UTF-8",
      LC_MONETARY: "en_US.UTF-8",
      LC_NUMERIC: "en_US.UTF-8",
      LC_TIME: "en_US.UTF-8",
      LC_COLLATE: "en_US.UTF-8",
      COLORTERM: "truecolor",
    },
    algorithms: {
      kex: [
        "curve25519-sha256",
        "curve25519-sha256@libssh.org",
        "ecdh-sha2-nistp521",
        "ecdh-sha2-nistp384",
        "ecdh-sha2-nistp256",
        "diffie-hellman-group-exchange-sha256",
        "diffie-hellman-group14-sha256",
        "diffie-hellman-group14-sha1",
        "diffie-hellman-group-exchange-sha1",
        "diffie-hellman-group1-sha1",
      ],
      serverHostKey: [
        "ssh-ed25519",
        "ecdsa-sha2-nistp521",
        "ecdsa-sha2-nistp384",
        "ecdsa-sha2-nistp256",
        "rsa-sha2-512",
        "rsa-sha2-256",
        "ssh-rsa",
        "ssh-dss",
      ],
      cipher: SSH_ALGORITHMS.cipher,
      hmac: [
        "hmac-sha2-512-etm@openssh.com",
        "hmac-sha2-256-etm@openssh.com",
        "hmac-sha2-512",
        "hmac-sha2-256",
        "hmac-sha1",
        "hmac-md5",
      ],
      compress: ["none", "zlib@openssh.com", "zlib"],
    },
  };

  if (
    resolvedSourceCredentials.authMethod === "key" &&
    resolvedSourceCredentials.sshKey
  ) {
    if (
      !resolvedSourceCredentials.sshKey.includes("-----BEGIN") ||
      !resolvedSourceCredentials.sshKey.includes("-----END")
    ) {
      tunnelLogger.error(
        `Invalid SSH key format for tunnel '${tunnelName}'. Key should contain both BEGIN and END markers`,
        undefined,
        {
          operation: "tunnel_invalid_ssh_key_format",
          tunnelName,
          sourceHost: `${tunnelConfig.sourceUsername}@${tunnelConfig.sourceIP}:${tunnelConfig.sourceSSHPort}`,
          keyType: resolvedSourceCredentials.keyType,
          hasBeginMarker:
            resolvedSourceCredentials.sshKey.includes("-----BEGIN"),
          hasEndMarker: resolvedSourceCredentials.sshKey.includes("-----END"),
        },
      );
      broadcastTunnelStatus(tunnelName, {
        connected: false,
        status: CONNECTION_STATES.FAILED,
        reason: "Invalid SSH key format",
      });
      tunnelConnecting.delete(tunnelName);
      return;
    }

    const cleanKey = resolvedSourceCredentials.sshKey
      .trim()
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    connOptions.privateKey = Buffer.from(cleanKey, "utf8");
    if (resolvedSourceCredentials.keyPassword) {
      connOptions.passphrase = resolvedSourceCredentials.keyPassword;
    }
    if (
      resolvedSourceCredentials.keyType &&
      resolvedSourceCredentials.keyType !== "auto"
    ) {
      connOptions.privateKeyType = resolvedSourceCredentials.keyType;
    }
  } else if (resolvedSourceCredentials.authMethod === "key") {
    tunnelLogger.error(
      `SSH key authentication requested but no key provided for tunnel '${tunnelName}'`,
      undefined,
      {
        operation: "tunnel_ssh_key_missing",
        tunnelName,
        sourceHost: `${tunnelConfig.sourceUsername}@${tunnelConfig.sourceIP}:${tunnelConfig.sourceSSHPort}`,
        authMethod: resolvedSourceCredentials.authMethod,
      },
    );
    broadcastTunnelStatus(tunnelName, {
      connected: false,
      status: CONNECTION_STATES.FAILED,
      reason: "SSH key authentication requested but no key provided",
    });
    tunnelConnecting.delete(tunnelName);
    return;
  } else {
    connOptions.password = resolvedSourceCredentials.password;
  }

  const finalStatus = connectionStatus.get(tunnelName);
  if (!finalStatus || finalStatus.status !== CONNECTION_STATES.WAITING) {
    broadcastTunnelStatus(tunnelName, {
      connected: false,
      status: CONNECTION_STATES.CONNECTING,
      retryCount: retryAttempt > 0 ? retryAttempt : undefined,
    });
  }

  if (
    tunnelConfig.useSocks5 &&
    (tunnelConfig.socks5Host ||
      (tunnelConfig.socks5ProxyChain &&
        tunnelConfig.socks5ProxyChain.length > 0))
  ) {
    try {
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
        conn.connect(connOptions);
        return;
      }
    } catch (socks5Error) {
      tunnelLogger.error("SOCKS5 connection failed for tunnel", socks5Error, {
        operation: "tunnel_socks5_connection_failed",
        tunnelName,
        sourceHost: `${tunnelConfig.sourceIP}:${tunnelConfig.sourceSSHPort}`,
        proxyHost: tunnelConfig.socks5Host,
        proxyPort: tunnelConfig.socks5Port || 1080,
        hasProxyAuth: !!(
          tunnelConfig.socks5Username && tunnelConfig.socks5Password
        ),
        errorMessage:
          socks5Error instanceof Error ? socks5Error.message : "Unknown error",
      });
      broadcastTunnelStatus(tunnelName, {
        connected: false,
        status: CONNECTION_STATES.FAILED,
        reason:
          "SOCKS5 proxy connection failed: " +
          (socks5Error instanceof Error
            ? socks5Error.message
            : "Unknown error"),
      });
      tunnelConnecting.delete(tunnelName);
      return;
    }
  }

  conn.connect(connOptions);
}

async function killRemoteTunnelByMarker(
  tunnelConfig: TunnelConfig,
  tunnelName: string,
  callback: (err?: Error) => void,
) {
  const tunnelMarker = getTunnelMarker(tunnelName);
  tunnelLogger.info("Killing remote tunnel process", {
    operation: "tunnel_remote_kill",
    userId: tunnelConfig.sourceUserId,
    hostId: tunnelConfig.sourceHostId,
    tunnelName,
    marker: tunnelMarker,
  });

  let resolvedSourceCredentials = {
    password: tunnelConfig.sourcePassword,
    sshKey: tunnelConfig.sourceSSHKey,
    keyPassword: tunnelConfig.sourceKeyPassword,
    keyType: tunnelConfig.sourceKeyType,
    authMethod: tunnelConfig.sourceAuthMethod,
  };

  if (
    tunnelConfig.sourceHostId &&
    tunnelConfig.sourceUserId &&
    !tunnelConfig.sourcePassword &&
    !tunnelConfig.sourceSSHKey
  ) {
    try {
      const { resolveHostById } = await import("./host-resolver.js");
      const resolvedHost = await resolveHostById(
        tunnelConfig.sourceHostId,
        tunnelConfig.sourceUserId,
      );
      if (resolvedHost) {
        resolvedSourceCredentials = {
          password: resolvedHost.password,
          sshKey: resolvedHost.key,
          keyPassword: resolvedHost.keyPassword,
          keyType: resolvedHost.keyType,
          authMethod: resolvedHost.authType,
        };
      }
    } catch (error) {
      tunnelLogger.warn("Failed to resolve source credentials for cleanup", {
        tunnelName,
        sourceHostId: tunnelConfig.sourceHostId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  if (
    resolvedSourceCredentials.authMethod === "key" &&
    resolvedSourceCredentials.sshKey
  ) {
    if (
      !resolvedSourceCredentials.sshKey.includes("-----BEGIN") ||
      !resolvedSourceCredentials.sshKey.includes("-----END")
    ) {
      callback(new Error("Invalid SSH key format"));
      return;
    }
  }

  const poolKey = `tunnel:${tunnelConfig.sourceUserId}:${tunnelConfig.sourceIP}:${tunnelConfig.sourceSSHPort}:${tunnelConfig.sourceUsername}`;

  const factory = async (): Promise<Client> => {
    const connOptions: Record<string, unknown> = {
      host:
        tunnelConfig.sourceIP?.replace(/^\[|\]$/g, "") || tunnelConfig.sourceIP,
      port: tunnelConfig.sourceSSHPort,
      username: tunnelConfig.sourceUsername,
      keepaliveInterval: 30000,
      keepaliveCountMax: 3,
      readyTimeout: 60000,
      tcpKeepAlive: true,
      tcpKeepAliveInitialDelay: 15000,
      algorithms: {
        kex: [
          "diffie-hellman-group14-sha256",
          "diffie-hellman-group14-sha1",
          "diffie-hellman-group1-sha1",
          "diffie-hellman-group-exchange-sha256",
          "diffie-hellman-group-exchange-sha1",
          "ecdh-sha2-nistp256",
          "ecdh-sha2-nistp384",
          "ecdh-sha2-nistp521",
        ],
        cipher: [
          "aes128-ctr",
          "aes192-ctr",
          "aes256-ctr",
          "aes128-gcm@openssh.com",
          "aes256-gcm@openssh.com",
          "aes128-cbc",
          "aes192-cbc",
          "aes256-cbc",
          "3des-cbc",
        ],
        hmac: [
          "hmac-sha2-256-etm@openssh.com",
          "hmac-sha2-512-etm@openssh.com",
          "hmac-sha2-256",
          "hmac-sha2-512",
          "hmac-sha1",
          "hmac-md5",
        ],
        compress: ["none", "zlib@openssh.com", "zlib"],
      },
    };

    if (
      resolvedSourceCredentials.authMethod === "key" &&
      resolvedSourceCredentials.sshKey
    ) {
      const cleanKey = resolvedSourceCredentials.sshKey
        .trim()
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
      connOptions.privateKey = Buffer.from(cleanKey, "utf8");
      if (resolvedSourceCredentials.keyPassword) {
        connOptions.passphrase = resolvedSourceCredentials.keyPassword;
      }
      if (
        resolvedSourceCredentials.keyType &&
        resolvedSourceCredentials.keyType !== "auto"
      ) {
        connOptions.privateKeyType = resolvedSourceCredentials.keyType;
      }
    } else {
      connOptions.password = resolvedSourceCredentials.password;
    }

    if (
      tunnelConfig.useSocks5 &&
      (tunnelConfig.socks5Host ||
        (tunnelConfig.socks5ProxyChain &&
          tunnelConfig.socks5ProxyChain.length > 0))
    ) {
      try {
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
        } else {
          throw new Error("Failed to create SOCKS5 connection");
        }
      } catch (socks5Error) {
        tunnelLogger.error(
          "SOCKS5 connection failed for killing tunnel",
          socks5Error,
          {
            operation: "socks5_connect_kill",
            tunnelName,
            proxyHost: tunnelConfig.socks5Host,
            proxyPort: tunnelConfig.socks5Port || 1080,
          },
        );
        throw new Error(
          "SOCKS5 proxy connection failed: " +
            (socks5Error instanceof Error
              ? socks5Error.message
              : "Unknown error"),
          { cause: socks5Error },
        );
      }
    }

    return new Promise<Client>((resolve, reject) => {
      const conn = new Client();
      conn.on("ready", () => resolve(conn));
      conn.on("error", (err) => reject(err));
      conn.connect(connOptions);
    });
  };

  const execCommand = (client: Client, cmd: string): Promise<string> =>
    new Promise((resolve, reject) => {
      client.exec(cmd, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        let output = "";
        stream.on("data", (data: Buffer) => {
          output += data.toString();
        });
        stream.stderr.on("data", (data: Buffer) => {
          const stderr = data.toString().trim();
          if (stderr && !stderr.includes("debug1")) {
            tunnelLogger.warn(
              `Kill command stderr for '${tunnelName}': ${stderr}`,
            );
          }
        });
        stream.on("close", () => resolve(output.trim()));
      });
    });

  try {
    await withConnection(poolKey, factory, async (client) => {
      const tunnelType = tunnelConfig.tunnelType || "remote";
      const tunnelFlag = tunnelType === "local" ? "-L" : "-R";
      const checkCmd = `ps aux | grep -E '(${tunnelMarker}|ssh.*${tunnelFlag}.*${tunnelConfig.endpointPort}:.*:${tunnelConfig.sourcePort}.*${tunnelConfig.endpointUsername}@${tunnelConfig.endpointIP}|sshpass.*ssh.*${tunnelFlag})' | grep -v grep`;

      const checkOutput = await execCommand(client, checkCmd);
      if (!checkOutput) {
        tunnelLogger.warn("Remote tunnel process not found", {
          operation: "tunnel_remote_not_found",
          userId: tunnelConfig.sourceUserId,
          hostId: tunnelConfig.sourceHostId,
          tunnelName,
          marker: tunnelMarker,
        });
        return;
      }

      tunnelLogger.info("Remote tunnel process found, proceeding to kill", {
        operation: "tunnel_remote_found",
        userId: tunnelConfig.sourceUserId,
        hostId: tunnelConfig.sourceHostId,
        tunnelName,
        marker: tunnelMarker,
      });

      const killCmds = [
        `pkill -TERM -f '${tunnelMarker}'`,
        `sleep 1 && pkill -f 'ssh.*${tunnelFlag}.*${tunnelConfig.endpointPort}:.*:${tunnelConfig.sourcePort}.*${tunnelConfig.endpointUsername}@${tunnelConfig.endpointIP}'`,
        `sleep 1 && pkill -f 'sshpass.*ssh.*${tunnelFlag}.*${tunnelConfig.endpointPort}'`,
        `sleep 2 && pkill -9 -f '${tunnelMarker}'`,
      ];

      for (const killCmd of killCmds) {
        try {
          await execCommand(client, killCmd);
        } catch (err) {
          tunnelLogger.warn(
            `Kill command failed for '${tunnelName}': ${(err as Error).message}`,
          );
        }
      }

      const verifyOutput = await execCommand(client, checkCmd);
      if (verifyOutput) {
        tunnelLogger.warn(
          `Some tunnel processes may still be running for '${tunnelName}'`,
        );
      } else {
        tunnelLogger.success("Remote tunnel process killed", {
          operation: "tunnel_remote_killed",
          userId: tunnelConfig.sourceUserId,
          hostId: tunnelConfig.sourceHostId,
          tunnelName,
        });
      }
    });
    callback();
  } catch (err) {
    tunnelLogger.error(
      `Failed to connect to source host for killing tunnel '${tunnelName}': ${(err as Error).message}`,
    );
    callback(err as Error);
  }
}

/**
 * @openapi
 * /ssh/tunnel/status:
 *   get:
 *     summary: Get all tunnel statuses
 *     description: Retrieves the status of all SSH tunnels.
 *     tags:
 *       - SSH Tunnels
 *     responses:
 *       200:
 *         description: A list of all tunnel statuses.
 */
app.get(
  "/ssh/tunnel/status",
  authenticateJWT,
  (req: AuthenticatedRequest, res: Response) => {
    if (!req.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    res.json(getAllTunnelStatus());
  },
);

app.get(
  "/ssh/tunnel/status/stream",
  authenticateJWT,
  (req: AuthenticatedRequest, res: Response) => {
    if (!req.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    tunnelStatusClients.add(res);
    sendTunnelStatusSnapshot(res);

    const heartbeat = setInterval(() => {
      try {
        res.write(": keepalive\n\n");
      } catch {
        closeStream();
      }
    }, 30000);

    const closeStream = () => {
      clearInterval(heartbeat);
      tunnelStatusClients.delete(res);
    };

    req.on("close", closeStream);
  },
);

/**
 * @openapi
 * /ssh/tunnel/status/{tunnelName}:
 *   get:
 *     summary: Get tunnel status by name
 *     description: Retrieves the status of a specific SSH tunnel by its name.
 *     tags:
 *       - SSH Tunnels
 *     parameters:
 *       - in: path
 *         name: tunnelName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Tunnel status.
 *       404:
 *         description: Tunnel not found.
 */
app.get(
  "/ssh/tunnel/status/:tunnelName",
  authenticateJWT,
  (req: AuthenticatedRequest, res: Response) => {
    if (!req.userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const tunnelNameParam = req.params.tunnelName;
    const tunnelName = Array.isArray(tunnelNameParam)
      ? tunnelNameParam[0]
      : tunnelNameParam;
    const status = connectionStatus.get(tunnelName);

    if (!status) {
      return res.status(404).json({ error: "Tunnel not found" });
    }

    res.json({ name: tunnelName, status });
  },
);

/**
 * @openapi
 * /ssh/tunnel/connect:
 *   post:
 *     summary: Connect SSH tunnel
 *     description: Establishes an SSH tunnel connection with the specified configuration.
 *     tags:
 *       - SSH Tunnels
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               sourceHostId:
 *                 type: integer
 *               tunnelIndex:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Connection request received.
 *       400:
 *         description: Invalid tunnel configuration.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Access denied to this host.
 *       500:
 *         description: Failed to connect tunnel.
 */
app.post(
  "/ssh/tunnel/connect",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const tunnelConfig: TunnelConfig = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!tunnelConfig || !tunnelConfig.name) {
      return res.status(400).json({ error: "Invalid tunnel configuration" });
    }

    const tunnelName = tunnelConfig.name;

    try {
      if (!validateTunnelConfig(tunnelName, tunnelConfig)) {
        tunnelLogger.error(`Tunnel config validation failed`, {
          operation: "tunnel_connect",
          tunnelName,
          configHostId: tunnelConfig.sourceHostId,
          configTunnelIndex: tunnelConfig.tunnelIndex,
        });
        return res.status(400).json({
          error: "Tunnel configuration does not match tunnel name",
        });
      }

      if (tunnelConfig.sourceHostId) {
        const accessInfo = await permissionManager.canAccessHost(
          userId,
          tunnelConfig.sourceHostId,
          "read",
        );

        if (!accessInfo.hasAccess) {
          tunnelLogger.warn("User attempted tunnel connect without access", {
            operation: "tunnel_connect_unauthorized",
            userId,
            hostId: tunnelConfig.sourceHostId,
            tunnelName,
          });
          return res.status(403).json({ error: "Access denied to this host" });
        }

        if (accessInfo.isShared && !accessInfo.isOwner) {
          tunnelConfig.requestingUserId = userId;
        }
      }

      if (pendingTunnelOperations.has(tunnelName)) {
        try {
          await pendingTunnelOperations.get(tunnelName);
        } catch {
          tunnelLogger.warn(`Previous tunnel operation failed`, { tunnelName });
        }
      }

      const operation = (async () => {
        manualDisconnects.delete(tunnelName);
        retryCounters.delete(tunnelName);
        retryExhaustedTunnels.delete(tunnelName);

        await cleanupTunnelResources(tunnelName);

        if (tunnelConfigs.has(tunnelName)) {
          const existingConfig = tunnelConfigs.get(tunnelName);
          if (
            existingConfig &&
            (existingConfig.sourceHostId !== tunnelConfig.sourceHostId ||
              existingConfig.tunnelIndex !== tunnelConfig.tunnelIndex)
          ) {
            throw new Error(`Tunnel name collision detected: ${tunnelName}`);
          }
        }

        if (!tunnelConfig.endpointIP || !tunnelConfig.endpointUsername) {
          try {
            const systemCrypto = SystemCrypto.getInstance();
            const internalAuthToken = await systemCrypto.getInternalAuthToken();

            const allHostsResponse = await axios.get(
              "http://localhost:30001/host/db/host/internal/all",
              {
                headers: {
                  "Content-Type": "application/json",
                  "X-Internal-Auth-Token": internalAuthToken,
                },
              },
            );

            const allHosts: SSHHost[] = allHostsResponse.data || [];
            const endpointHost = allHosts.find(
              (h) =>
                h.name === tunnelConfig.endpointHost ||
                `${h.username}@${h.ip}` === tunnelConfig.endpointHost,
            );

            if (!endpointHost) {
              throw new Error(
                `Endpoint host '${tunnelConfig.endpointHost}' not found in database`,
              );
            }

            tunnelConfig.endpointIP = endpointHost.ip;
            tunnelConfig.endpointSSHPort = endpointHost.port;
            tunnelConfig.endpointUsername = endpointHost.username;
            tunnelConfig.endpointAuthMethod = endpointHost.authType;
            tunnelConfig.endpointKeyType = endpointHost.keyType;
            tunnelConfig.endpointCredentialId = endpointHost.credentialId;
            tunnelConfig.endpointUserId = endpointHost.userId;

            // Resolve credentials server-side instead of from HTTP response
            if (endpointHost.id && endpointHost.userId) {
              try {
                const { resolveHostById } = await import("./host-resolver.js");
                const resolved = await resolveHostById(
                  endpointHost.id,
                  endpointHost.userId,
                );
                if (resolved) {
                  tunnelConfig.endpointPassword = resolved.password;
                  tunnelConfig.endpointSSHKey = resolved.key;
                  tunnelConfig.endpointKeyPassword = resolved.keyPassword;
                }
              } catch (credError) {
                tunnelLogger.warn(
                  "Failed to resolve endpoint credentials from DB",
                  {
                    operation: "tunnel_endpoint_credential_resolve",
                    endpointHostId: endpointHost.id,
                    error:
                      credError instanceof Error
                        ? credError.message
                        : "Unknown",
                  },
                );
              }
            }
          } catch (resolveError) {
            tunnelLogger.error(
              "Failed to resolve endpoint host",
              resolveError,
              {
                operation: "tunnel_connect_resolve_endpoint_failed",
                tunnelName,
                endpointHost: tunnelConfig.endpointHost,
              },
            );
            throw new Error(
              `Failed to resolve endpoint host: ${resolveError instanceof Error ? resolveError.message : "Unknown error"}`,
              { cause: resolveError },
            );
          }
        }

        tunnelConfigs.set(tunnelName, tunnelConfig);
        await connectSSHTunnel(tunnelConfig, 0);
      })();

      pendingTunnelOperations.set(tunnelName, operation);

      res.json({ message: "Connection request received", tunnelName });

      operation.finally(() => {
        pendingTunnelOperations.delete(tunnelName);
      });
    } catch (error) {
      tunnelLogger.error("Failed to process tunnel connect", error, {
        operation: "tunnel_connect",
        tunnelName,
        userId,
      });
      res.status(500).json({ error: "Failed to connect tunnel" });
    }
  },
);

/**
 * @openapi
 * /ssh/tunnel/disconnect:
 *   post:
 *     summary: Disconnect SSH tunnel
 *     description: Disconnects an active SSH tunnel.
 *     tags:
 *       - SSH Tunnels
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tunnelName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Disconnect request received.
 *       400:
 *         description: Tunnel name required.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Access denied.
 *       500:
 *         description: Failed to disconnect tunnel.
 */
app.post(
  "/ssh/tunnel/disconnect",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const { tunnelName } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!tunnelName) {
      return res.status(400).json({ error: "Tunnel name required" });
    }

    try {
      const config = tunnelConfigs.get(tunnelName);
      if (config && config.sourceHostId) {
        const accessInfo = await permissionManager.canAccessHost(
          userId,
          config.sourceHostId,
          "read",
        );
        if (!accessInfo.hasAccess) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      tunnelLogger.info("Tunnel stop request received", {
        operation: "tunnel_stop_request",
        userId,
        hostId: config?.sourceHostId,
        tunnelName,
      });
      manualDisconnects.add(tunnelName);
      retryCounters.delete(tunnelName);
      retryExhaustedTunnels.delete(tunnelName);

      if (activeRetryTimers.has(tunnelName)) {
        clearTimeout(activeRetryTimers.get(tunnelName)!);
        activeRetryTimers.delete(tunnelName);
      }

      await cleanupTunnelResources(tunnelName, true);
      tunnelLogger.info("Tunnel cleanup completed", {
        operation: "tunnel_cleanup_complete",
        userId,
        hostId: config?.sourceHostId,
        tunnelName,
      });

      broadcastTunnelStatus(tunnelName, {
        connected: false,
        status: CONNECTION_STATES.DISCONNECTED,
        manualDisconnect: true,
      });

      const tunnelConfig = tunnelConfigs.get(tunnelName) || null;
      handleDisconnect(tunnelName, tunnelConfig, false);

      setTimeout(() => {
        manualDisconnects.delete(tunnelName);
      }, 5000);

      res.json({ message: "Disconnect request received", tunnelName });
    } catch (error) {
      tunnelLogger.error("Failed to disconnect tunnel", error, {
        operation: "tunnel_disconnect",
        tunnelName,
        userId,
      });
      res.status(500).json({ error: "Failed to disconnect tunnel" });
    }
  },
);

/**
 * @openapi
 * /ssh/tunnel/cancel:
 *   post:
 *     summary: Cancel tunnel retry
 *     description: Cancels the retry mechanism for a failed SSH tunnel connection.
 *     tags:
 *       - SSH Tunnels
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               tunnelName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cancel request received.
 *       400:
 *         description: Tunnel name required.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Access denied.
 *       500:
 *         description: Failed to cancel tunnel retry.
 */
app.post(
  "/ssh/tunnel/cancel",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    const { tunnelName } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!tunnelName) {
      return res.status(400).json({ error: "Tunnel name required" });
    }

    try {
      const config = tunnelConfigs.get(tunnelName);
      if (config && config.sourceHostId) {
        const accessInfo = await permissionManager.canAccessHost(
          userId,
          config.sourceHostId,
          "read",
        );
        if (!accessInfo.hasAccess) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      retryCounters.delete(tunnelName);
      retryExhaustedTunnels.delete(tunnelName);

      if (activeRetryTimers.has(tunnelName)) {
        clearTimeout(activeRetryTimers.get(tunnelName)!);
        activeRetryTimers.delete(tunnelName);
      }

      if (countdownIntervals.has(tunnelName)) {
        clearInterval(countdownIntervals.get(tunnelName)!);
        countdownIntervals.delete(tunnelName);
      }

      await cleanupTunnelResources(tunnelName, true);

      broadcastTunnelStatus(tunnelName, {
        connected: false,
        status: CONNECTION_STATES.DISCONNECTED,
        manualDisconnect: true,
      });

      const tunnelConfig = tunnelConfigs.get(tunnelName) || null;
      handleDisconnect(tunnelName, tunnelConfig, false);

      setTimeout(() => {
        manualDisconnects.delete(tunnelName);
      }, 5000);

      res.json({ message: "Cancel request received", tunnelName });
    } catch (error) {
      tunnelLogger.error("Failed to cancel tunnel retry", error, {
        operation: "tunnel_cancel",
        tunnelName,
        userId,
      });
      res.status(500).json({ error: "Failed to cancel tunnel retry" });
    }
  },
);

async function initializeAutoStartTunnels(): Promise<void> {
  try {
    const systemCrypto = SystemCrypto.getInstance();
    const internalAuthToken = await systemCrypto.getInternalAuthToken();

    const autostartResponse = await axios.get(
      "http://localhost:30001/host/db/host/internal",
      {
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Auth-Token": internalAuthToken,
        },
      },
    );

    const allHostsResponse = await axios.get(
      "http://localhost:30001/host/db/host/internal/all",
      {
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Auth-Token": internalAuthToken,
        },
      },
    );

    const autostartHosts: SSHHost[] = autostartResponse.data || [];
    const allHosts: SSHHost[] = allHostsResponse.data || [];
    const autoStartTunnels: TunnelConfig[] = [];
    tunnelLogger.info(
      `Found ${autostartHosts.length} autostart hosts and ${allHosts.length} total hosts for endpointHost resolution`,
    );

    for (const host of autostartHosts) {
      if (host.enableTunnel && host.tunnelConnections) {
        for (const tunnelConnection of host.tunnelConnections) {
          if (tunnelConnection.autoStart) {
            const endpointHost = allHosts.find(
              (h) =>
                h.name === tunnelConnection.endpointHost ||
                `${h.username}@${h.ip}` === tunnelConnection.endpointHost,
            );

            if (endpointHost) {
              const tunnelIndex =
                host.tunnelConnections.indexOf(tunnelConnection);
              const tunnelConfig: TunnelConfig = {
                name: normalizeTunnelName(
                  host.id,
                  tunnelIndex,
                  host.name || `${host.username}@${host.ip}`,
                  tunnelConnection.sourcePort,
                  tunnelConnection.endpointHost,
                  tunnelConnection.endpointPort,
                ),
                scope: tunnelConnection.scope || "s2s",
                mode:
                  tunnelConnection.mode ||
                  tunnelConnection.tunnelType ||
                  "remote",
                bindHost: tunnelConnection.bindHost,
                targetHost: tunnelConnection.targetHost,
                tunnelType: tunnelConnection.tunnelType || "remote",
                sourceHostId: host.id,
                tunnelIndex: tunnelIndex,
                hostName: host.name || `${host.username}@${host.ip}`,
                sourceIP: host.ip,
                sourceSSHPort: host.port,
                sourceUsername: host.username,
                sourceAuthMethod: host.authType,
                sourceKeyType: host.keyType,
                sourceCredentialId: host.credentialId,
                sourceUserId: host.userId,
                endpointIP: endpointHost.ip,
                endpointSSHPort: endpointHost.port,
                endpointUsername: endpointHost.username,
                endpointHost: tunnelConnection.endpointHost,
                endpointAuthMethod:
                  tunnelConnection.endpointAuthType || endpointHost.authType,
                endpointKeyType:
                  tunnelConnection.endpointKeyType || endpointHost.keyType,
                endpointCredentialId: endpointHost.credentialId,
                endpointUserId: endpointHost.userId,
                sourcePort: tunnelConnection.sourcePort,
                endpointPort: tunnelConnection.endpointPort,
                maxRetries: tunnelConnection.maxRetries,
                retryInterval: tunnelConnection.retryInterval * 1000,
                autoStart: tunnelConnection.autoStart,
                isPinned: host.pin,
                useSocks5: host.useSocks5,
                socks5Host: host.socks5Host,
                socks5Port: host.socks5Port,
                socks5Username: host.socks5Username,
                socks5Password: host.socks5Password,
              };

              autoStartTunnels.push(tunnelConfig);
            } else {
              tunnelLogger.error(
                `Failed to find endpointHost '${tunnelConnection.endpointHost}' for tunnel from ${host.name || `${host.username}@${host.ip}`}. Available hosts: ${allHosts.map((h) => h.name || `${h.username}@${h.ip}`).join(", ")}`,
              );
            }
          }
        }
      }
    }

    for (const tunnelConfig of autoStartTunnels) {
      tunnelConfigs.set(tunnelConfig.name, tunnelConfig);

      setTimeout(() => {
        connectSSHTunnel(tunnelConfig, 0).catch((error) => {
          tunnelLogger.error(
            `Failed to connect tunnel ${tunnelConfig.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        });
      }, 1000);
    }
  } catch (error) {
    tunnelLogger.error(
      "Failed to initialize auto-start tunnels:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

const PORT = 30003;
const server = createServer(app);
const c2sRelayWss = new WebSocketServer({
  server,
  path: "/ssh/tunnel/c2s/stream",
});

c2sRelayWss.on("connection", (ws, req) => {
  let opened = false;

  ws.once("message", async (raw) => {
    try {
      const token = extractRequestToken(req);
      const payload = token ? await authManager.verifyJWTToken(token) : null;
      if (!payload?.userId || payload.pendingTOTP) {
        sendC2SError(ws, "Authentication required");
        ws.close();
        return;
      }

      const message = JSON.parse(raw.toString()) as C2SOpenMessage;
      if (message.type !== "open" && message.type !== "test") {
        throw new Error("Invalid client tunnel relay request");
      }

      opened = true;
      if (message.type === "test") {
        await handleC2SRelayTest(ws, message, payload.userId);
      } else {
        await handleC2SRelayOpen(ws, message, payload.userId);
      }
    } catch (error) {
      const message = describeC2SRelayError(error);
      tunnelLogger.error("Failed to open C2S relay", error, {
        operation: "c2s_relay_open_failed",
      });
      sendC2SError(ws, message);
      ws.close();
    }
  });

  ws.on("close", () => {
    if (!opened) {
      tunnelLogger.info("C2S relay closed before opening", {
        operation: "c2s_relay_closed_before_open",
      });
    }
  });
});

server.listen(PORT, () => {
  setTimeout(() => {
    initializeAutoStartTunnels();
  }, 2000);
});
