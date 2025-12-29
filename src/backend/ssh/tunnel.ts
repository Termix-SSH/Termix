import express, { type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { Client } from "ssh2";
import { ChildProcess } from "child_process";
import axios from "axios";
import { getDb } from "../database/db/index.js";
import { sshCredentials } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import type {
  SSHHost,
  TunnelConfig,
  TunnelStatus,
  VerificationData,
  ErrorType,
  AuthenticatedRequest,
} from "../../types/index.js";
import { CONNECTION_STATES } from "../../types/index.js";
import { tunnelLogger, sshLogger } from "../utils/logger.js";
import { SystemCrypto } from "../utils/system-crypto.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { DataCrypto } from "../utils/data-crypto.js";
import { createSocks5Connection } from "../utils/socks5-helper.js";
import { AuthManager } from "../utils/auth-manager.js";
import { PermissionManager } from "../utils/permission-manager.js";

const app = express();
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
      ];

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      if (origin.startsWith("https://")) {
        return callback(null, true);
      }

      if (origin.startsWith("http://")) {
        return callback(null, true);
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "Authorization",
      "User-Agent",
      "X-Electron-App",
    ],
  }),
);
app.use(cookieParser());
app.use(express.json());

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

const tunnelConfigs = new Map<string, TunnelConfig>();
const activeTunnelProcesses = new Map<string, ChildProcess>();
const pendingTunnelOperations = new Map<string, Promise<void>>();

function broadcastTunnelStatus(tunnelName: string, status: TunnelStatus): void {
  if (
    status.status === CONNECTION_STATES.CONNECTED &&
    activeRetryTimers.has(tunnelName)
  ) {
    return;
  }

  if (
    retryExhaustedTunnels.has(tunnelName) &&
    status.status === CONNECTION_STATES.FAILED
  ) {
    status.reason = "Max retries exhausted";
  }

  connectionStatus.set(tunnelName, status);
}

function getAllTunnelStatus(): Record<string, TunnelStatus> {
  const tunnelStatus: Record<string, TunnelStatus> = {};
  connectionStatus.forEach((status, key) => {
    tunnelStatus[key] = status;
  });
  return tunnelStatus;
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
  if (tunnelConfig) {
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
    } catch (error) {}
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

function handleDisconnect(
  tunnelName: string,
  tunnelConfig: TunnelConfig | null,
  shouldRetry = true,
): void {
  if (tunnelVerifications.has(tunnelName)) {
    try {
      const verification = tunnelVerifications.get(tunnelName);
      if (verification?.timeout) clearTimeout(verification.timeout);
      verification?.conn.end();
    } catch (error) {}
    tunnelVerifications.delete(tunnelName);
  }

  cleanupTunnelResources(tunnelName);

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

async function connectSSHTunnel(
  tunnelConfig: TunnelConfig,
  retryAttempt = 0,
): Promise<void> {
  const tunnelName = tunnelConfig.name;
  const tunnelMarker = getTunnelMarker(tunnelName);

  if (manualDisconnects.has(tunnelName)) {
    return;
  }

  tunnelConnecting.add(tunnelName);

  cleanupTunnelResources(tunnelName, true);

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
    tunnelLogger.error("Invalid tunnel connection details", {
      operation: "tunnel_connect",
      tunnelName,
      hasSourceIP: !!tunnelConfig?.sourceIP,
      hasSourceUsername: !!tunnelConfig?.sourceUsername,
      hasSourceSSHPort: !!tunnelConfig?.sourceSSHPort,
    });
    broadcastTunnelStatus(tunnelName, {
      connected: false,
      status: CONNECTION_STATES.FAILED,
      reason: "Missing required connection details",
    });
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

  if (tunnelConfig.sourceCredentialId && effectiveUserId) {
    try {
      if (
        tunnelConfig.requestingUserId &&
        tunnelConfig.requestingUserId !== tunnelConfig.sourceUserId
      ) {
        const { SharedCredentialManager } =
          await import("../utils/shared-credential-manager.js");
        const sharedCredManager = SharedCredentialManager.getInstance();

        if (tunnelConfig.sourceHostId) {
          const sharedCred = await sharedCredManager.getSharedCredentialForUser(
            tunnelConfig.sourceHostId,
            tunnelConfig.requestingUserId,
          );

          if (sharedCred) {
            resolvedSourceCredentials = {
              password: sharedCred.password,
              sshKey: sharedCred.key,
              keyPassword: sharedCred.keyPassword,
              keyType: sharedCred.keyType,
              authMethod: sharedCred.authType,
            };
          } else {
            const errorMessage = `Cannot connect tunnel '${tunnelName}': shared credentials not available`;
            tunnelLogger.error(errorMessage);
            broadcastTunnelStatus(tunnelName, {
              connected: false,
              status: CONNECTION_STATES.FAILED,
              reason: errorMessage,
            });
            return;
          }
        }
      } else {
        const userDataKey = DataCrypto.getUserDataKey(effectiveUserId);
        if (userDataKey) {
          const credentials = await SimpleDBOps.select(
            getDb()
              .select()
              .from(sshCredentials)
              .where(eq(sshCredentials.id, tunnelConfig.sourceCredentialId)),
            "ssh_credentials",
            effectiveUserId,
          );

          if (credentials.length > 0) {
            const credential = credentials[0];
            resolvedSourceCredentials = {
              password: credential.password as string | undefined,
              sshKey: (credential.private_key ||
                credential.privateKey ||
                credential.key) as string | undefined,
              keyPassword: (credential.key_password ||
                credential.keyPassword) as string | undefined,
              keyType: (credential.key_type || credential.keyType) as
                | string
                | undefined,
              authMethod: (credential.auth_type ||
                credential.authType) as string,
            };
          }
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

  if (
    resolvedEndpointCredentials.authMethod === "password" &&
    !resolvedEndpointCredentials.password
  ) {
    const errorMessage = `Cannot connect tunnel '${tunnelName}': endpoint host requires password authentication but no plaintext password available. Enable autostart for endpoint host or configure credentials in tunnel connection.`;
    tunnelLogger.error(errorMessage);
    broadcastTunnelStatus(tunnelName, {
      connected: false,
      status: CONNECTION_STATES.FAILED,
      reason: errorMessage,
    });
    return;
  }

  if (
    resolvedEndpointCredentials.authMethod === "key" &&
    !resolvedEndpointCredentials.sshKey
  ) {
    const errorMessage = `Cannot connect tunnel '${tunnelName}': endpoint host requires key authentication but no plaintext key available. Enable autostart for endpoint host or configure credentials in tunnel connection.`;
    tunnelLogger.error(errorMessage);
    broadcastTunnelStatus(tunnelName, {
      connected: false,
      status: CONNECTION_STATES.FAILED,
      reason: errorMessage,
    });
    return;
  }

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
            sshKey: (credential.private_key ||
              credential.privateKey ||
              credential.key) as string | undefined,
            keyPassword: (credential.key_password || credential.keyPassword) as
              | string
              | undefined,
            keyType: (credential.key_type || credential.keyType) as
              | string
              | undefined,
            authMethod: (credential.auth_type || credential.authType) as string,
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

  const conn = new Client();

  const connectionTimeout = setTimeout(() => {
    if (conn) {
      if (activeRetryTimers.has(tunnelName)) {
        return;
      }

      try {
        conn.end();
      } catch (error) {}

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
    tunnelLogger.error(`SSH error for '${tunnelName}': ${err.message}`);

    tunnelConnecting.delete(tunnelName);

    if (activeRetryTimers.has(tunnelName)) {
      return;
    }

    const errorType = classifyError(err.message);

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

  conn.on("ready", () => {
    clearTimeout(connectionTimeout);

    const isAlreadyVerifying = tunnelVerifications.has(tunnelName);
    if (isAlreadyVerifying) {
      return;
    }

    let tunnelCmd: string;
    if (
      resolvedEndpointCredentials.authMethod === "key" &&
      resolvedEndpointCredentials.sshKey
    ) {
      const keyFilePath = `/tmp/tunnel_key_${tunnelName.replace(/[^a-zA-Z0-9]/g, "_")}`;
      tunnelCmd = `echo '${resolvedEndpointCredentials.sshKey}' > ${keyFilePath} && chmod 600 ${keyFilePath} && exec -a "${tunnelMarker}" ssh -i ${keyFilePath} -N -o StrictHostKeyChecking=no -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o GatewayPorts=yes -R ${tunnelConfig.endpointPort}:localhost:${tunnelConfig.sourcePort} ${tunnelConfig.endpointUsername}@${tunnelConfig.endpointIP} && rm -f ${keyFilePath}`;
    } else {
      tunnelCmd = `exec -a "${tunnelMarker}" sshpass -p '${resolvedEndpointCredentials.password || ""}' ssh -N -o StrictHostKeyChecking=no -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o GatewayPorts=yes -R ${tunnelConfig.endpointPort}:localhost:${tunnelConfig.sourcePort} ${tunnelConfig.endpointUsername}@${tunnelConfig.endpointIP}`;
    }

    conn.exec(tunnelCmd, (err, stream) => {
      if (err) {
        tunnelLogger.error(
          `Connection error for '${tunnelName}': ${err.message}`,
        );

        conn.end();

        activeTunnels.delete(tunnelName);

        const errorType = classifyError(err.message);
        const shouldNotRetry =
          errorType === "AUTHENTICATION_FAILED" ||
          errorType === "CONNECTION_FAILED";

        handleDisconnect(tunnelName, tunnelConfig, !shouldNotRetry);
        return;
      }

      activeTunnels.set(tunnelName, conn);

      setTimeout(() => {
        if (
          !manualDisconnects.has(tunnelName) &&
          activeTunnels.has(tunnelName)
        ) {
          tunnelConnecting.delete(tunnelName);

          broadcastTunnelStatus(tunnelName, {
            connected: true,
            status: CONNECTION_STATES.CONNECTED,
          });
          setupPingInterval(tunnelName);
        }
      }, 2000);

      stream.on("close", (code: number) => {
        if (activeRetryTimers.has(tunnelName)) {
          return;
        }

        activeTunnels.delete(tunnelName);

        if (tunnelVerifications.has(tunnelName)) {
          try {
            const verification = tunnelVerifications.get(tunnelName);
            if (verification?.timeout) clearTimeout(verification.timeout);
            verification?.conn.end();
          } catch (error) {}
          tunnelVerifications.delete(tunnelName);
        }

        const isLikelyRemoteClosure = code === 255;

        if (isLikelyRemoteClosure && retryExhaustedTunnels.has(tunnelName)) {
          retryExhaustedTunnels.delete(tunnelName);
        }

        if (
          !manualDisconnects.has(tunnelName) &&
          code !== 0 &&
          code !== undefined
        ) {
          if (retryExhaustedTunnels.has(tunnelName)) {
            broadcastTunnelStatus(tunnelName, {
              connected: false,
              status: CONNECTION_STATES.FAILED,
              reason: "Max retries exhausted",
            });
          } else {
            broadcastTunnelStatus(tunnelName, {
              connected: false,
              status: CONNECTION_STATES.FAILED,
              reason: isLikelyRemoteClosure
                ? "Connection closed by remote host"
                : "Connection closed unexpectedly",
            });
          }
        }

        if (
          !activeRetryTimers.has(tunnelName) &&
          !retryExhaustedTunnels.has(tunnelName)
        ) {
          handleDisconnect(
            tunnelName,
            tunnelConfig,
            !manualDisconnects.has(tunnelName),
          );
        } else if (
          retryExhaustedTunnels.has(tunnelName) &&
          isLikelyRemoteClosure
        ) {
          retryExhaustedTunnels.delete(tunnelName);
          retryCounters.delete(tunnelName);
          handleDisconnect(tunnelName, tunnelConfig, true);
        }
      });

      stream.stdout?.on("data", () => {});

      stream.on("error", () => {});

      stream.stderr.on("data", (data) => {
        const errorMsg = data.toString().trim();
        if (errorMsg) {
          const isDebugMessage =
            errorMsg.startsWith("debug1:") ||
            errorMsg.startsWith("debug2:") ||
            errorMsg.startsWith("debug3:") ||
            errorMsg.includes("Reading configuration data") ||
            errorMsg.includes("include /etc/ssh/ssh_config.d") ||
            errorMsg.includes("matched no files") ||
            errorMsg.includes("Applying options for");

          if (!isDebugMessage) {
            tunnelLogger.error(`SSH stderr for '${tunnelName}': ${errorMsg}`);
          }

          if (
            errorMsg.includes("sshpass: command not found") ||
            errorMsg.includes("sshpass not found")
          ) {
            broadcastTunnelStatus(tunnelName, {
              connected: false,
              status: CONNECTION_STATES.FAILED,
              reason:
                "sshpass tool not found on source host. Please install sshpass or use SSH key authentication.",
            });
          }

          if (
            errorMsg.includes("remote port forwarding failed") ||
            errorMsg.includes("Error: remote port forwarding failed")
          ) {
            const portMatch = errorMsg.match(/listen port (\d+)/);
            const port = portMatch ? portMatch[1] : tunnelConfig.endpointPort;

            tunnelLogger.error(
              `Port forwarding failed for tunnel '${tunnelName}' on port ${port}. This prevents tunnel establishment.`,
            );

            if (activeTunnels.has(tunnelName)) {
              const conn = activeTunnels.get(tunnelName);
              if (conn) {
                conn.end();
              }
              activeTunnels.delete(tunnelName);
            }

            broadcastTunnelStatus(tunnelName, {
              connected: false,
              status: CONNECTION_STATES.FAILED,
              reason: `Remote port forwarding failed for port ${port}. Port may be in use, requires root privileges, or SSH server doesn't allow port forwarding. Try a different port.`,
            });
          }
        }
      });
    });
  });

  const connOptions: Record<string, unknown> = {
    host: tunnelConfig.sourceIP,
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
      cipher: [
        "chacha20-poly1305@openssh.com",
        "aes256-gcm@openssh.com",
        "aes128-gcm@openssh.com",
        "aes256-ctr",
        "aes192-ctr",
        "aes128-ctr",
        "aes256-cbc",
        "aes192-cbc",
        "aes128-cbc",
        "3des-cbc",
      ],
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
      );
      broadcastTunnelStatus(tunnelName, {
        connected: false,
        status: CONNECTION_STATES.FAILED,
        reason: "Invalid SSH key format",
      });
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
    );
    broadcastTunnelStatus(tunnelName, {
      connected: false,
      status: CONNECTION_STATES.FAILED,
      reason: "SSH key authentication requested but no key provided",
    });
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
        operation: "socks5_connect",
        tunnelName,
        proxyHost: tunnelConfig.socks5Host,
        proxyPort: tunnelConfig.socks5Port || 1080,
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

  let resolvedSourceCredentials = {
    password: tunnelConfig.sourcePassword,
    sshKey: tunnelConfig.sourceSSHKey,
    keyPassword: tunnelConfig.sourceKeyPassword,
    keyType: tunnelConfig.sourceKeyType,
    authMethod: tunnelConfig.sourceAuthMethod,
  };

  if (tunnelConfig.sourceCredentialId && tunnelConfig.sourceUserId) {
    try {
      const userDataKey = DataCrypto.getUserDataKey(tunnelConfig.sourceUserId);
      if (userDataKey) {
        const credentials = await SimpleDBOps.select(
          getDb()
            .select()
            .from(sshCredentials)
            .where(eq(sshCredentials.id, tunnelConfig.sourceCredentialId)),
          "ssh_credentials",
          tunnelConfig.sourceUserId,
        );

        if (credentials.length > 0) {
          const credential = credentials[0];
          resolvedSourceCredentials = {
            password: credential.password as string | undefined,
            sshKey: (credential.private_key ||
              credential.privateKey ||
              credential.key) as string | undefined,
            keyPassword: (credential.key_password || credential.keyPassword) as
              | string
              | undefined,
            keyType: (credential.key_type || credential.keyType) as
              | string
              | undefined,
            authMethod: (credential.auth_type || credential.authType) as string,
          };
        }
      }
    } catch (error) {
      tunnelLogger.warn("Failed to resolve source credentials for cleanup", {
        tunnelName,
        credentialId: tunnelConfig.sourceCredentialId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const conn = new Client();
  const connOptions: Record<string, unknown> = {
    host: tunnelConfig.sourceIP,
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
    if (
      !resolvedSourceCredentials.sshKey.includes("-----BEGIN") ||
      !resolvedSourceCredentials.sshKey.includes("-----END")
    ) {
      callback(new Error("Invalid SSH key format"));
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
  } else {
    connOptions.password = resolvedSourceCredentials.password;
  }

  conn.on("ready", () => {
    const checkCmd = `ps aux | grep -E '(${tunnelMarker}|ssh.*-R.*${tunnelConfig.endpointPort}:localhost:${tunnelConfig.sourcePort}.*${tunnelConfig.endpointUsername}@${tunnelConfig.endpointIP}|sshpass.*ssh.*-R.*${tunnelConfig.endpointPort})' | grep -v grep`;

    conn.exec(checkCmd, (_err, stream) => {
      let foundProcesses = false;

      stream.on("data", (data) => {
        const output = data.toString().trim();
        if (output) {
          foundProcesses = true;
        }
      });

      stream.on("close", () => {
        if (!foundProcesses) {
          conn.end();
          callback();
          return;
        }

        const killCmds = [
          `pkill -TERM -f '${tunnelMarker}'`,
          `sleep 1 && pkill -f 'ssh.*-R.*${tunnelConfig.endpointPort}:localhost:${tunnelConfig.sourcePort}.*${tunnelConfig.endpointUsername}@${tunnelConfig.endpointIP}'`,
          `sleep 1 && pkill -f 'sshpass.*ssh.*-R.*${tunnelConfig.endpointPort}'`,
          `sleep 2 && pkill -9 -f '${tunnelMarker}'`,
        ];

        let commandIndex = 0;

        function executeNextKillCommand() {
          if (commandIndex >= killCmds.length) {
            conn.exec(checkCmd, (_err, verifyStream) => {
              let stillRunning = false;

              verifyStream.on("data", (data) => {
                const output = data.toString().trim();
                if (output) {
                  stillRunning = true;
                  tunnelLogger.warn(
                    `Processes still running after cleanup for '${tunnelName}': ${output}`,
                  );
                }
              });

              verifyStream.on("close", () => {
                if (stillRunning) {
                  tunnelLogger.warn(
                    `Some tunnel processes may still be running for '${tunnelName}'`,
                  );
                }
                conn.end();
                callback();
              });
            });
            return;
          }

          const killCmd = killCmds[commandIndex];

          conn.exec(killCmd, (err, stream) => {
            if (err) {
              tunnelLogger.warn(
                `Kill command ${commandIndex + 1} failed for '${tunnelName}': ${err.message}`,
              );
            }

            stream.on("close", () => {
              commandIndex++;
              executeNextKillCommand();
            });

            stream.on("data", () => {});

            stream.stderr.on("data", (data) => {
              const output = data.toString().trim();
              if (output && !output.includes("debug1")) {
                tunnelLogger.warn(
                  `Kill command ${commandIndex + 1} stderr for '${tunnelName}': ${output}`,
                );
              }
            });
          });
        }

        executeNextKillCommand();
      });
    });
  });

  conn.on("error", (err) => {
    tunnelLogger.error(
      `Failed to connect to source host for killing tunnel '${tunnelName}': ${err.message}`,
    );
    callback(err);
  });

  if (
    tunnelConfig.useSocks5 &&
    (tunnelConfig.socks5Host ||
      (tunnelConfig.socks5ProxyChain &&
        tunnelConfig.socks5ProxyChain.length > 0))
  ) {
    (async () => {
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
        } else {
          callback(new Error("Failed to create SOCKS5 connection"));
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
        callback(
          new Error(
            "SOCKS5 proxy connection failed: " +
              (socks5Error instanceof Error
                ? socks5Error.message
                : "Unknown error"),
          ),
        );
      }
    })();
  } else {
    conn.connect(connOptions);
  }
}

app.get("/ssh/tunnel/status", (req, res) => {
  res.json(getAllTunnelStatus());
});

app.get("/ssh/tunnel/status/:tunnelName", (req, res) => {
  const { tunnelName } = req.params;
  const status = connectionStatus.get(tunnelName);

  if (!status) {
    return res.status(404).json({ error: "Tunnel not found" });
  }

  res.json({ name: tunnelName, status });
});

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
        } catch (error) {
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
              "http://localhost:30001/ssh/db/host/internal/all",
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
            tunnelConfig.endpointPassword = endpointHost.password;
            tunnelConfig.endpointAuthMethod = endpointHost.authType;
            tunnelConfig.endpointSSHKey = endpointHost.key;
            tunnelConfig.endpointKeyPassword = endpointHost.keyPassword;
            tunnelConfig.endpointKeyType = endpointHost.keyType;
            tunnelConfig.endpointCredentialId = endpointHost.credentialId;
            tunnelConfig.endpointUserId = endpointHost.userId;
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

      manualDisconnects.add(tunnelName);
      retryCounters.delete(tunnelName);
      retryExhaustedTunnels.delete(tunnelName);

      if (activeRetryTimers.has(tunnelName)) {
        clearTimeout(activeRetryTimers.get(tunnelName)!);
        activeRetryTimers.delete(tunnelName);
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
      "http://localhost:30001/ssh/db/host/internal",
      {
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Auth-Token": internalAuthToken,
        },
      },
    );

    const allHostsResponse = await axios.get(
      "http://localhost:30001/ssh/db/host/internal/all",
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
                sourceHostId: host.id,
                tunnelIndex: tunnelIndex,
                hostName: host.name || `${host.username}@${host.ip}`,
                sourceIP: host.ip,
                sourceSSHPort: host.port,
                sourceUsername: host.username,
                sourcePassword: host.autostartPassword || host.password,
                sourceAuthMethod: host.authType,
                sourceSSHKey: host.autostartKey || host.key,
                sourceKeyPassword:
                  host.autostartKeyPassword || host.keyPassword,
                sourceKeyType: host.keyType,
                sourceCredentialId: host.credentialId,
                sourceUserId: host.userId,
                endpointIP: endpointHost.ip,
                endpointSSHPort: endpointHost.port,
                endpointUsername: endpointHost.username,
                endpointHost: tunnelConnection.endpointHost,
                endpointPassword:
                  tunnelConnection.endpointPassword ||
                  endpointHost.autostartPassword ||
                  endpointHost.password,
                endpointAuthMethod:
                  tunnelConnection.endpointAuthType || endpointHost.authType,
                endpointSSHKey:
                  tunnelConnection.endpointKey ||
                  endpointHost.autostartKey ||
                  endpointHost.key,
                endpointKeyPassword:
                  tunnelConnection.endpointKeyPassword ||
                  endpointHost.autostartKeyPassword ||
                  endpointHost.keyPassword,
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
app.listen(PORT, () => {
  setTimeout(() => {
    initializeAutoStartTunnels();
  }, 2000);
});
