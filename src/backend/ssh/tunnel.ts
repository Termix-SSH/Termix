import express from "express";
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
} from "../../types/index.js";
import { CONNECTION_STATES } from "../../types/index.js";
import { tunnelLogger } from "../utils/logger.js";
import { SystemCrypto } from "../utils/system-crypto.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { DataCrypto } from "../utils/data-crypto.js";

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

      if (origin.startsWith("https://")) {
        return callback(null, true);
      }

      if (origin.startsWith("http://")) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
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

function cleanupTunnelResources(
  tunnelName: string,
  forceCleanup = false,
): void {
  if (cleanupInProgress.has(tunnelName)) {
    return;
  }

  if (!forceCleanup && tunnelConnecting.has(tunnelName)) {
    return;
  }

  cleanupInProgress.add(tunnelName);

  const tunnelConfig = tunnelConfigs.get(tunnelName);
  if (tunnelConfig) {
    killRemoteTunnelByMarker(tunnelConfig, tunnelName, (err) => {
      cleanupInProgress.delete(tunnelName);
      if (err) {
        tunnelLogger.error(
          `Failed to kill remote tunnel for '${tunnelName}': ${err.message}`,
        );
      }
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
    } catch (e) {}
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
    } catch (e) {}
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

  if (tunnelConfig.sourceCredentialId && tunnelConfig.sourceUserId) {
    try {
      const userDataKey = DataCrypto.getUserDataKey(tunnelConfig.sourceUserId);
      if (userDataKey) {
        const credentials = await SimpleDBOps.select(
          getDb()
            .select()
            .from(sshCredentials)
            .where(
              and(
                eq(sshCredentials.id, tunnelConfig.sourceCredentialId),
                eq(sshCredentials.userId, tunnelConfig.sourceUserId),
              ),
            ),
          "ssh_credentials",
          tunnelConfig.sourceUserId,
        );

        if (credentials.length > 0) {
          const credential = credentials[0];
          resolvedSourceCredentials = {
            password: credential.password,
            sshKey: credential.privateKey || credential.key,
            keyPassword: credential.keyPassword,
            keyType: credential.keyType,
            authMethod: credential.authType,
          };
        } else {
        }
      } else {
      }
    } catch (error) {
      tunnelLogger.warn("Failed to resolve source credentials from database", {
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
            .where(
              and(
                eq(sshCredentials.id, tunnelConfig.endpointCredentialId),
                eq(sshCredentials.userId, tunnelConfig.endpointUserId),
              ),
            ),
          "ssh_credentials",
          tunnelConfig.endpointUserId,
        );

        if (credentials.length > 0) {
          const credential = credentials[0];
          resolvedEndpointCredentials = {
            password: credential.password,
            sshKey: credential.privateKey || credential.key,
            keyPassword: credential.keyPassword,
            keyType: credential.keyType,
            authMethod: credential.authType,
          };
        } else {
          tunnelLogger.warn("No endpoint credentials found in database", {
            operation: "tunnel_connect",
            tunnelName,
            credentialId: tunnelConfig.endpointCredentialId,
          });
        }
      } else {
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
      } catch (e) {}

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
          } catch (e) {}
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

      stream.stdout?.on("data", (data: Buffer) => {
        const output = data.toString().trim();
        if (output) {
        }
      });

      stream.on("error", (err: Error) => {});

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

  const connOptions: any = {
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
            .where(
              and(
                eq(sshCredentials.id, tunnelConfig.sourceCredentialId),
                eq(sshCredentials.userId, tunnelConfig.sourceUserId),
              ),
            ),
          "ssh_credentials",
          tunnelConfig.sourceUserId,
        );

        if (credentials.length > 0) {
          const credential = credentials[0];
          resolvedSourceCredentials = {
            password: credential.password,
            sshKey: credential.privateKey || credential.key,
            keyPassword: credential.keyPassword,
            keyType: credential.keyType,
            authMethod: credential.authType,
          };
        }
      } else {
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
  const connOptions: any = {
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

    conn.exec(checkCmd, (err, stream) => {
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
            conn.exec(checkCmd, (err, verifyStream) => {
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
            } else {
            }

            stream.on("close", (code) => {
              commandIndex++;
              executeNextKillCommand();
            });

            stream.on("data", (data) => {
              const output = data.toString().trim();
              if (output) {
              }
            });

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

  conn.connect(connOptions);
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

app.post("/ssh/tunnel/connect", (req, res) => {
  const tunnelConfig: TunnelConfig = req.body;

  if (!tunnelConfig || !tunnelConfig.name) {
    return res.status(400).json({ error: "Invalid tunnel configuration" });
  }

  const tunnelName = tunnelConfig.name;

  cleanupTunnelResources(tunnelName);

  manualDisconnects.delete(tunnelName);
  retryCounters.delete(tunnelName);
  retryExhaustedTunnels.delete(tunnelName);

  tunnelConfigs.set(tunnelName, tunnelConfig);

  connectSSHTunnel(tunnelConfig, 0).catch((error) => {
    tunnelLogger.error(
      `Failed to connect tunnel ${tunnelConfig.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  });

  res.json({ message: "Connection request received", tunnelName });
});

app.post("/ssh/tunnel/disconnect", (req, res) => {
  const { tunnelName } = req.body;

  if (!tunnelName) {
    return res.status(400).json({ error: "Tunnel name required" });
  }

  manualDisconnects.add(tunnelName);
  retryCounters.delete(tunnelName);
  retryExhaustedTunnels.delete(tunnelName);

  if (activeRetryTimers.has(tunnelName)) {
    clearTimeout(activeRetryTimers.get(tunnelName)!);
    activeRetryTimers.delete(tunnelName);
  }

  cleanupTunnelResources(tunnelName, true);

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
});

app.post("/ssh/tunnel/cancel", (req, res) => {
  const { tunnelName } = req.body;

  if (!tunnelName) {
    return res.status(400).json({ error: "Tunnel name required" });
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

  cleanupTunnelResources(tunnelName, true);

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
});

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
              const tunnelConfig: TunnelConfig = {
                name: `${host.name || `${host.username}@${host.ip}`}_${tunnelConnection.sourcePort}_${tunnelConnection.endpointPort}`,
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
              };

              const hasSourcePassword = host.autostartPassword;
              const hasSourceKey = host.autostartKey;
              const hasEndpointPassword =
                tunnelConnection.endpointPassword ||
                endpointHost.autostartPassword;
              const hasEndpointKey =
                tunnelConnection.endpointKey || endpointHost.autostartKey;

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
  } catch (error: any) {
    tunnelLogger.error(
      "Failed to initialize auto-start tunnels:",
      error.message,
    );
  }
}

const PORT = 30003;
app.listen(PORT, () => {
  setTimeout(() => {
    initializeAutoStartTunnels();
  }, 2000);
});
