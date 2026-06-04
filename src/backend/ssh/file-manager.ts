import express from "express";
import { createCorsMiddleware } from "../utils/cors-config.js";
import cookieParser from "cookie-parser";
import axios from "axios";
import { Client as SSHClient } from "ssh2";
import { SSH_ALGORITHMS } from "../utils/ssh-algorithms.js";
import { getDb } from "../database/db/index.js";
import { hosts } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { fileLogger } from "../utils/logger.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { AuthManager } from "../utils/auth-manager.js";
import type { AuthenticatedRequest, ProxyNode } from "../../types/index.js";
import {
  createSocks5Connection,
  type SOCKS5Config,
} from "../utils/socks5-helper.js";
import type { LogEntry, ConnectionStage } from "../../types/connection-log.js";
import { SSHHostKeyVerifier } from "./host-key-verifier.js";
import { resolveHostById } from "./host-resolver.js";
import type { SSHHost } from "../../types/index.js";
import {
  startHostTransfer,
  getTransferStatus,
  listActiveTransfers,
  probeHungStreamTransfers,
  requestTransferCancel,
  cleanupCancelledTransfer,
  retryHostTransfer,
  previewArchiveTransferMethod,
  type HostTransferDeps,
} from "./host-transfer.js";
import { registerFileContentRoutes } from "./file-manager-content-routes.js";
import { createConnectionLog } from "./file-manager-log.js";
import { createJumpHostChain } from "./jump-host-chain.js";
import {
  ChannelOpenSerializer,
  execChannel,
  getSessionSftp,
  type PendingTOTPSession,
  type SSHSession,
} from "./file-manager-session.js";
import { registerFileListingRoutes } from "./file-manager-list-routes.js";
import { registerFileOperationRoutes } from "./file-manager-operation-routes.js";
import { registerFileDownloadRoutes } from "./file-manager-download-routes.js";
import { registerFileActionRoutes } from "./file-manager-action-routes.js";

const app = express();

app.use(createCorsMiddleware(["GET", "POST", "PUT", "DELETE", "OPTIONS"]));
app.use(cookieParser());
app.use(express.json({ limit: "1gb" }));
app.use(express.urlencoded({ limit: "1gb", extended: true }));
app.use(express.raw({ limit: "5gb", type: "application/octet-stream" }));
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const authManager = AuthManager.getInstance();
app.use(authManager.createAuthMiddleware());

const sshSessions: Record<string, SSHSession> = {};
const pendingTOTPSessions: Record<string, PendingTOTPSession> = {};
// Keyed by "sessionId:path" to prevent concurrent requests for the same path
const activeListRequests: Record<string, boolean> = {};

function cleanupSession(sessionId: string) {
  const session = sshSessions[sessionId];
  if (session) {
    if (session.activeOperations > 0) {
      fileLogger.warn(
        `Deferring session cleanup for ${sessionId} - ${session.activeOperations} active operations`,
        {
          operation: "cleanup_deferred",
          sessionId,
          activeOperations: session.activeOperations,
        },
      );
      scheduleSessionCleanup(sessionId);
      return;
    }

    try {
      if (session.sftp) {
        session.sftp.end();
        session.sftp = undefined;
      }
    } catch {
      // expected
    }
    try {
      session.client.end();
    } catch {
      // expected
    }
    clearTimeout(session.timeout);
    delete sshSessions[sessionId];
  }
}

function scheduleSessionCleanup(sessionId: string) {
  const session = sshSessions[sessionId];
  if (session) {
    if (session.timeout) clearTimeout(session.timeout);

    session.timeout = setTimeout(
      () => {
        cleanupSession(sessionId);
      },
      30 * 60 * 1000,
    );
  }
}

function verifySessionOwnership(session: SSHSession, userId: string): boolean {
  return !session.userId || session.userId === userId;
}

function resolveBrowseHostId(
  browseSessionId: string,
  browseSession: SSHSession,
): number | undefined {
  if (browseSession.hostId) return browseSession.hostId;
  const parsed = Number.parseInt(browseSessionId, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function buildDedicatedTransferConnectConfig(
  host: SSHHost,
  userId: string,
  client: SSHClient,
): Promise<Record<string, unknown>> {
  const { ip, port, username } = host;
  const config: Record<string, unknown> = {
    host: ip?.replace(/^\[|\]$/g, "") || ip,
    port,
    username,
    tryKeyboard: true,
    keepaliveInterval: 30000,
    keepaliveCountMax: 120,
    readyTimeout: 60000,
    tcpKeepAlive: true,
    tcpKeepAliveInitialDelay: 5000,
    hostVerifier: await SSHHostKeyVerifier.createHostVerifier(
      host.id,
      ip,
      port,
      null,
      userId,
      false,
    ),
    env: {
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
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

  const authType = host.authType;

  if (authType === "key" && host.key?.trim()) {
    const cleanKey = host.key
      .trim()
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    config.privateKey = Buffer.from(cleanKey, "utf8");
    if (host.keyPassword) config.passphrase = host.keyPassword;
  } else if (authType === "password") {
    if (!host.password) {
      throw new Error("Password required for transfer connection");
    }
    config.password = host.password;
  } else if (authType === "opkssh") {
    const { getOPKSSHToken } = await import("./opkssh-auth.js");
    const token = await getOPKSSHToken(userId, host.id);
    if (!token) {
      throw new Error(
        "OPKSSH authentication required. Open a Terminal connection to this host first.",
      );
    }
    const { setupOPKSSHCertAuth } = await import("./opkssh-cert-auth.js");
    await setupOPKSSHCertAuth(
      config as import("ssh2").ConnectConfig,
      client,
      token,
      username,
    );
  } else if (authType !== "none") {
    throw new Error(`Unsupported auth type for transfer: ${authType}`);
  }

  return config;
}

function attachDedicatedKeyboardInteractive(
  client: SSHClient,
  host: SSHHost,
): void {
  client.on(
    "keyboard-interactive",
    (
      _name: string,
      _instructions: string,
      _instructionsLang: string,
      prompts: Array<{ prompt: string; echo: boolean }>,
      finish: (responses: string[]) => void,
    ) => {
      const responses = prompts.map((p) => {
        if (/password/i.test(p.prompt) && host.password) {
          return host.password;
        }
        return "";
      });
      finish(responses);
    },
  );
}

async function startDedicatedTransferConnect(
  client: SSHClient,
  config: Record<string, unknown>,
  host: SSHHost,
  userId: string,
): Promise<void> {
  const proxyConfig: SOCKS5Config | null =
    host.useSocks5 &&
    (host.socks5Host ||
      (host.socks5ProxyChain && host.socks5ProxyChain.length > 0))
      ? {
          useSocks5: host.useSocks5,
          socks5Host: host.socks5Host,
          socks5Port: host.socks5Port,
          socks5Username: host.socks5Username,
          socks5Password: host.socks5Password,
          socks5ProxyChain: host.socks5ProxyChain,
        }
      : null;

  const jumpHosts = host.jumpHosts;
  const hasJumpHosts = jumpHosts && jumpHosts.length > 0;

  if (hasJumpHosts) {
    const jumpClient = await createJumpHostChain(
      jumpHosts,
      userId,
      proxyConfig,
    );
    if (!jumpClient) {
      throw new Error("Failed to connect through jump hosts for transfer");
    }

    await new Promise<void>((resolve, reject) => {
      jumpClient.forwardOut(
        "127.0.0.1",
        0,
        host.ip,
        host.port,
        (err, stream) => {
          if (err) {
            jumpClient.end();
            reject(
              new Error(
                `Failed to forward through jump host for transfer: ${err.message}`,
              ),
            );
            return;
          }
          config.sock = stream;
          client.connect(config);
          resolve();
        },
      );
    });
    return;
  }

  if (proxyConfig) {
    const proxySocket = await createSocks5Connection(
      host.ip,
      host.port,
      proxyConfig,
    );
    if (proxySocket) {
      config.sock = proxySocket;
    }
  }

  client.connect(config);
}

async function openDedicatedTransferSession(
  browseSessionId: string,
  dedicatedSessionId: string,
  userId: string,
  transferId: string,
  options?: { allowBrowseDisconnected?: boolean },
): Promise<SSHSession> {
  const browseSession = sshSessions[browseSessionId];
  if (!options?.allowBrowseDisconnected && !browseSession?.isConnected) {
    throw new Error("Browse SSH session not connected");
  }
  if (browseSession && !verifySessionOwnership(browseSession, userId)) {
    throw new Error("Session access denied");
  }

  const hostId = browseSession
    ? resolveBrowseHostId(browseSessionId, browseSession)
    : (() => {
        const parsed = Number.parseInt(browseSessionId, 10);
        return Number.isFinite(parsed) ? parsed : undefined;
      })();
  if (!hostId) {
    throw new Error("Cannot open transfer connection: unknown host");
  }

  const host = await resolveHostById(hostId, userId);
  if (!host) {
    throw new Error("Host not found for transfer connection");
  }

  if (sshSessions[dedicatedSessionId]?.isConnected) {
    closeDedicatedTransferSession(dedicatedSessionId);
  }

  const client = new SSHClient();
  attachDedicatedKeyboardInteractive(client, host);
  const config = await buildDedicatedTransferConnectConfig(
    host,
    userId,
    client,
  );

  fileLogger.info("Opening dedicated transfer SSH session", {
    operation: "transfer_ssh_connect",
    transferId,
    browseSessionId,
    dedicatedSessionId,
    hostId,
    ip: host.ip,
    port: host.port,
    username: host.username,
  });

  await new Promise<void>((resolve, reject) => {
    const connectTimeout = setTimeout(() => {
      client.end();
      reject(new Error("Transfer SSH connection timed out"));
    }, 60000);

    const fail = (err: Error) => {
      clearTimeout(connectTimeout);
      reject(err);
    };

    client.once("ready", () => {
      clearTimeout(connectTimeout);
      resolve();
    });
    client.once("error", fail);

    void startDedicatedTransferConnect(client, config, host, userId).catch(
      fail,
    );
  });

  const session: SSHSession = {
    client,
    isConnected: true,
    lastActive: Date.now(),
    activeOperations: 0,
    channelOpener: new ChannelOpenSerializer(),
    userId,
    ip: host.ip,
    port: host.port,
    hostId: host.id,
    username: host.username,
    transferDedicated: true,
    transferId,
    browseSessionId,
  };

  client.on("close", () => {
    fileLogger.info("Dedicated transfer SSH connection closed", {
      operation: "transfer_ssh_disconnected",
      transferId,
      dedicatedSessionId,
      browseSessionId,
      hostId,
    });
    const existing = sshSessions[dedicatedSessionId];
    if (existing) {
      existing.isConnected = false;
      closeDedicatedTransferSession(dedicatedSessionId);
    }
  });

  sshSessions[dedicatedSessionId] = session;
  return session;
}

function closeDedicatedTransferSession(sessionId: string): void {
  const session = sshSessions[sessionId];
  if (!session?.transferDedicated) return;

  fileLogger.info("Closing dedicated transfer SSH session", {
    operation: "transfer_ssh_close",
    sessionId,
    transferId: session.transferId,
    browseSessionId: session.browseSessionId,
  });

  try {
    if (session.sftp) {
      session.sftp.end();
      session.sftp = undefined;
    }
  } catch {
    // expected
  }
  session.sftpPending = undefined;

  try {
    session.client.end();
  } catch {
    // expected
  }

  clearTimeout(session.timeout);
  delete sshSessions[sessionId];
}

app.use("/ssh/file_manager/ssh", (req, res, next) => {
  if (
    req.path === "/connect" ||
    req.path === "/connect-totp" ||
    req.path === "/connect-warpgate"
  ) {
    return next();
  }
  const sessionId = (req.query.sessionId as string) || req.body?.sessionId;
  if (!sessionId) return next();
  const session = sshSessions[sessionId];
  if (!session) return next();
  const userId = (req as AuthenticatedRequest).userId;
  if (!verifySessionOwnership(session, userId)) {
    return res.status(403).json({ error: "Session access denied" });
  }
  next();
});

/**
 * @openapi
 * /ssh/file_manager/ssh/connect:
 *   post:
 *     summary: Connect to SSH for file management
 *     description: Establishes an SSH/SFTP connection for file manager operations. Supports password, key-based, and keyboard-interactive authentication, as well as jump hosts and SOCKS5 proxies.
 *     tags:
 *       - File Manager
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *               - ip
 *               - port
 *               - username
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: Unique session identifier
 *               hostId:
 *                 type: number
 *                 description: Host ID from database
 *               ip:
 *                 type: string
 *                 description: SSH server IP address
 *               port:
 *                 type: number
 *                 description: SSH server port
 *               username:
 *                 type: string
 *                 description: SSH username
 *               password:
 *                 type: string
 *                 description: SSH password (for password auth)
 *               sshKey:
 *                 type: string
 *                 description: SSH private key (for key-based auth)
 *               keyPassword:
 *                 type: string
 *                 description: Private key passphrase
 *               authType:
 *                 type: string
 *                 enum: [password, key, none]
 *                 description: Authentication method
 *               credentialId:
 *                 type: number
 *                 description: Credential ID to use from database
 *               userProvidedPassword:
 *                 type: string
 *                 description: User-provided password for keyboard-interactive auth
 *               forceKeyboardInteractive:
 *                 type: boolean
 *                 description: Force keyboard-interactive authentication
 *               jumpHosts:
 *                 type: array
 *                 description: Jump host configuration
 *                 items:
 *                   type: object
 *                   properties:
 *                     hostId:
 *                       type: number
 *               useSocks5:
 *                 type: boolean
 *                 description: Use SOCKS5 proxy
 *               socks5Host:
 *                 type: string
 *                 description: SOCKS5 proxy host
 *               socks5Port:
 *                 type: number
 *                 description: SOCKS5 proxy port
 *               socks5Username:
 *                 type: string
 *                 description: SOCKS5 proxy username
 *               socks5Password:
 *                 type: string
 *                 description: SOCKS5 proxy password
 *               socks5ProxyChain:
 *                 type: array
 *                 description: Chain of SOCKS5 proxies
 *     responses:
 *       200:
 *         description: SSH connection established successfully, or requires TOTP/Warpgate authentication.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: success
 *                     message:
 *                       type: string
 *                     connectionLogs:
 *                       type: array
 *                 - type: object
 *                   properties:
 *                     requires_totp:
 *                       type: boolean
 *                     sessionId:
 *                       type: string
 *                     prompt:
 *                       type: string
 *                     connectionLogs:
 *                       type: array
 *                 - type: object
 *                   properties:
 *                     requires_warpgate:
 *                       type: boolean
 *                     sessionId:
 *                       type: string
 *                     url:
 *                       type: string
 *                     securityKey:
 *                       type: string
 *                     connectionLogs:
 *                       type: array
 *                 - type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: auth_required
 *                     reason:
 *                       type: string
 *                     connectionLogs:
 *                       type: array
 *       400:
 *         description: Missing required parameters or invalid SSH key format.
 *       401:
 *         description: Authentication required.
 *       500:
 *         description: SSH connection failed.
 */
app.post("/ssh/file_manager/ssh/connect", async (req, res) => {
  const {
    sessionId,
    hostId,
    ip,
    port,
    username,
    password,
    sshKey,
    keyPassword,
    authType,
    credentialId,
    jumpHosts,
    useSocks5,
    socks5Host,
    socks5Port,
    socks5Username,
    socks5Password,
    socks5ProxyChain,
  } = req.body;

  const userId = (req as AuthenticatedRequest).userId;
  const connectionLogs: Array<Omit<LogEntry, "id" | "timestamp">> = [];

  connectionLogs.push(
    createConnectionLog(
      "info",
      "sftp_connecting",
      `Initiating SFTP connection to ${username}@${ip}:${port}`,
    ),
  );

  if (!userId) {
    fileLogger.error("SSH connection rejected: no authenticated user", {
      operation: "file_connect_auth",
      sessionId,
    });
    connectionLogs.push(
      createConnectionLog(
        "error",
        "sftp_auth",
        "Authentication required - no user session",
      ),
    );
    return res
      .status(401)
      .json({ error: "Authentication required", connectionLogs });
  }

  if (!sessionId || !ip || !username || !port) {
    fileLogger.warn("Missing SSH connection parameters for file manager", {
      operation: "file_connect",
      sessionId,
      hasIp: !!ip,
      hasUsername: !!username,
      hasPort: !!port,
    });
    connectionLogs.push(
      createConnectionLog(
        "error",
        "sftp_connecting",
        "Missing required connection parameters",
      ),
    );
    return res
      .status(400)
      .json({ error: "Missing SSH connection parameters", connectionLogs });
  }

  if (sshSessions[sessionId]?.isConnected) {
    cleanupSession(sessionId);
  }

  if (pendingTOTPSessions[sessionId]) {
    try {
      pendingTOTPSessions[sessionId].client.end();
    } catch {
      // expected
    }
    delete pendingTOTPSessions[sessionId];
  }

  const client = new SSHClient();

  connectionLogs.push(
    createConnectionLog(
      "info",
      "sftp_auth",
      "Resolving authentication credentials",
    ),
  );

  // Resolve credentials server-side when frontend doesn't provide them
  let resolvedCredentials = {
    password,
    sshKey,
    keyPassword,
    authType,
    sudoPassword: undefined as string | undefined,
  };
  let hostKeepaliveInterval: number | undefined;
  let hostKeepaliveCountMax: number | undefined;
  let resolvedIp = ip;
  let resolvedPort = port;
  let resolvedUsername = username;
  if (hostId && userId && !password && !sshKey) {
    try {
      const { resolveHostById } = await import("./host-resolver.js");
      const resolvedHost = await resolveHostById(hostId, userId);
      if (resolvedHost) {
        resolvedIp = resolvedHost.ip;
        resolvedPort = resolvedHost.port;
        resolvedUsername = resolvedHost.username;
        resolvedCredentials = {
          password: resolvedHost.password,
          sshKey: resolvedHost.key,
          keyPassword: resolvedHost.keyPassword,
          authType: resolvedHost.authType,
          sudoPassword: resolvedHost.sudoPassword as string | undefined,
        };
        hostKeepaliveInterval = resolvedHost.terminalConfig?.keepaliveInterval;
        hostKeepaliveCountMax = resolvedHost.terminalConfig?.keepaliveCountMax;
        connectionLogs.push(
          createConnectionLog(
            "info",
            "sftp_auth",
            "Credentials resolved from server-side host data",
          ),
        );
      }
    } catch (error) {
      fileLogger.warn(`Failed to resolve host credentials for ${hostId}`, {
        operation: "ssh_credentials",
        hostId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  } else if (credentialId && hostId && userId) {
    // Legacy: credential resolution from credentialId
    try {
      const { resolveHostById } = await import("./host-resolver.js");
      const resolvedHost = await resolveHostById(hostId, userId);
      if (resolvedHost) {
        resolvedIp = resolvedHost.ip;
        resolvedPort = resolvedHost.port;
        resolvedUsername = resolvedHost.username;
        resolvedCredentials = {
          password: resolvedHost.password,
          sshKey: resolvedHost.key,
          keyPassword: resolvedHost.keyPassword,
          authType: resolvedHost.authType,
          sudoPassword: resolvedHost.sudoPassword as string | undefined,
        };
        hostKeepaliveInterval = resolvedHost.terminalConfig?.keepaliveInterval;
        hostKeepaliveCountMax = resolvedHost.terminalConfig?.keepaliveCountMax;
        connectionLogs.push(
          createConnectionLog(
            "info",
            "sftp_auth",
            "Credentials resolved from credential store",
          ),
        );
      }
    } catch (error) {
      fileLogger.warn(`Failed to resolve credentials for host ${hostId}`, {
        operation: "ssh_credentials",
        hostId,
        credentialId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const config: Record<string, unknown> = {
    host: resolvedIp?.replace(/^\[|\]$/g, "") || resolvedIp,
    port: resolvedPort,
    username: resolvedUsername,
    tryKeyboard: true,
    keepaliveInterval:
      typeof hostKeepaliveInterval === "number"
        ? hostKeepaliveInterval * 1000
        : 60000,
    keepaliveCountMax:
      typeof hostKeepaliveCountMax === "number" ? hostKeepaliveCountMax : 5,
    readyTimeout: 60000,
    tcpKeepAlive: true,
    tcpKeepAliveInitialDelay: 30000,
    hostVerifier: await SSHHostKeyVerifier.createHostVerifier(
      hostId,
      resolvedIp,
      resolvedPort,
      null,
      userId,
      false,
    ),
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
    resolvedCredentials.authType === "key" &&
    resolvedCredentials.sshKey &&
    resolvedCredentials.sshKey.trim()
  ) {
    try {
      if (
        !resolvedCredentials.sshKey.includes("-----BEGIN") ||
        !resolvedCredentials.sshKey.includes("-----END")
      ) {
        throw new Error("Invalid private key format");
      }

      const cleanKey = resolvedCredentials.sshKey
        .trim()
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");

      config.privateKey = Buffer.from(cleanKey, "utf8");

      if (resolvedCredentials.keyPassword)
        config.passphrase = resolvedCredentials.keyPassword;
      connectionLogs.push(
        createConnectionLog(
          "info",
          "sftp_auth",
          "Using SSH key authentication",
        ),
      );
    } catch (keyError) {
      fileLogger.error("SSH key format error for file manager", {
        operation: "file_connect",
        sessionId,
        hostId,
        error: keyError.message,
      });
      connectionLogs.push(
        createConnectionLog(
          "error",
          "sftp_auth",
          `Invalid SSH key format: ${keyError.message}`,
        ),
      );
      return res
        .status(400)
        .json({ error: "Invalid SSH key format", connectionLogs });
    }
  } else if (resolvedCredentials.authType === "password") {
    if (!resolvedCredentials.password) {
      connectionLogs.push(
        createConnectionLog(
          "error",
          "sftp_auth",
          "Password required for password authentication",
        ),
      );
      return res.status(400).json({
        error: "Password required for password authentication",
        connectionLogs,
      });
    }

    config.password = resolvedCredentials.password;
    connectionLogs.push(
      createConnectionLog("info", "sftp_auth", "Using password authentication"),
    );
  } else if (resolvedCredentials.authType === "opkssh") {
    try {
      const { getOPKSSHToken } = await import("./opkssh-auth.js");
      const token = await getOPKSSHToken(userId, hostId);

      if (!token) {
        connectionLogs.push(
          createConnectionLog(
            "error",
            "sftp_auth",
            "OPKSSH authentication required. Please open a Terminal connection to this host first to complete browser-based authentication. Your session will be cached for 24 hours.",
          ),
        );
        return res.status(401).json({
          error:
            "OPKSSH authentication required. Please open a Terminal connection to this host first to complete browser-based authentication. Your session will be cached for 24 hours.",
          requiresOPKSSHAuth: true,
          connectionLogs,
        });
      }

      const { setupOPKSSHCertAuth } = await import("./opkssh-cert-auth.js");
      await setupOPKSSHCertAuth(
        config as import("ssh2").ConnectConfig,
        client,
        token,
        username,
      );
      connectionLogs.push(
        createConnectionLog(
          "info",
          "sftp_auth",
          "Using OPKSSH certificate authentication",
        ),
      );
    } catch (opksshError) {
      fileLogger.error("OPKSSH authentication error for file manager", {
        operation: "file_connect",
        sessionId,
        hostId,
        error:
          opksshError instanceof Error ? opksshError.message : "Unknown error",
      });
      connectionLogs.push(
        createConnectionLog(
          "error",
          "sftp_auth",
          `OPKSSH authentication failed: ${opksshError instanceof Error ? opksshError.message : "Unknown error"}`,
        ),
      );
      return res.status(500).json({
        error: "OPKSSH authentication failed",
        connectionLogs,
      });
    }
  } else if (resolvedCredentials.authType === "none") {
    connectionLogs.push(
      createConnectionLog(
        "info",
        "sftp_auth",
        "Using keyboard-interactive authentication",
      ),
    );
  } else {
    fileLogger.warn(
      "No valid authentication method provided for file manager",
      {
        operation: "file_connect",
        sessionId,
        hostId,
        authType: resolvedCredentials.authType,
        hasPassword: !!resolvedCredentials.password,
        hasKey: !!resolvedCredentials.sshKey,
      },
    );
    connectionLogs.push(
      createConnectionLog(
        "error",
        "sftp_auth",
        "No valid authentication method provided",
      ),
    );
    return res.status(400).json({
      error: "Either password or SSH key must be provided",
      connectionLogs,
    });
  }

  let responseSent = false;

  connectionLogs.push(
    createConnectionLog("info", "dns", `Resolving DNS for ${ip}`),
  );

  connectionLogs.push(
    createConnectionLog("info", "tcp", `Connecting to ${ip}:${port}`),
  );

  connectionLogs.push(
    createConnectionLog("info", "handshake", "Initiating SSH handshake"),
  );

  connectionLogs.push(
    createConnectionLog(
      "info",
      "sftp_connecting",
      "Establishing SSH connection...",
    ),
  );

  client.on("ready", () => {
    if (responseSent) return;
    responseSent = true;
    fileLogger.info("File manager SSH connection established", {
      operation: "file_ssh_connected",
      sessionId,
      userId,
      hostId,
      ip,
      port,
      username,
    });
    connectionLogs.push(
      createConnectionLog(
        "success",
        "connected",
        "SSH connection established successfully",
      ),
    );
    connectionLogs.push(
      createConnectionLog(
        "success",
        "sftp_connected",
        "SFTP session established successfully",
      ),
    );
    sshSessions[sessionId] = {
      client,
      isConnected: true,
      lastActive: Date.now(),
      activeOperations: 0,
      channelOpener: new ChannelOpenSerializer(),
      userId,
      ip,
      port,
      hostId,
      username,
      sudoPassword: resolvedCredentials.sudoPassword,
    };
    scheduleSessionCleanup(sessionId);
    res.json({
      status: "success",
      message: "SSH connection established",
      connectionLogs,
    });

    if (hostId && userId) {
      (async () => {
        try {
          const hostResults = await SimpleDBOps.select(
            getDb()
              .select()
              .from(hosts)
              .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId))),
            "ssh_data",
            userId,
          );

          const hostName =
            hostResults.length > 0 && hostResults[0].name
              ? hostResults[0].name
              : `${username}@${ip}:${port}`;

          const authManager = AuthManager.getInstance();
          await axios.post(
            "http://localhost:30006/activity/log",
            {
              type: "file_manager",
              hostId,
              hostName,
            },
            {
              headers: {
                Authorization: `Bearer ${await authManager.generateJWTToken(userId)}`,
              },
            },
          );
        } catch (error) {
          fileLogger.warn("Failed to log file manager activity", {
            operation: "activity_log_error",
            userId,
            hostId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      })();
    }
  });

  client.on("error", (err) => {
    if (responseSent) return;
    responseSent = true;
    fileLogger.error("SSH connection failed for file manager", {
      operation: "file_connect",
      sessionId,
      hostId,
      ip,
      port,
      username,
      error: err.message,
    });

    let errorStage: ConnectionStage;
    if (
      err.message.includes("ENOTFOUND") ||
      err.message.includes("getaddrinfo")
    ) {
      errorStage = "dns";
      connectionLogs.push(
        createConnectionLog(
          "error",
          errorStage,
          `DNS resolution failed: ${err.message}`,
          {
            errorCode: (err as unknown as Record<string, unknown>).code,
            errorLevel: (err as unknown as Record<string, unknown>).level,
          },
        ),
      );
    } else if (
      err.message.includes("ECONNREFUSED") ||
      err.message.includes("ETIMEDOUT")
    ) {
      errorStage = "tcp";
      connectionLogs.push(
        createConnectionLog(
          "error",
          errorStage,
          `TCP connection failed: ${err.message}`,
          {
            errorCode: (err as unknown as Record<string, unknown>).code,
            errorLevel: (err as unknown as Record<string, unknown>).level,
          },
        ),
      );
    } else if (
      err.message.includes("handshake") ||
      err.message.includes("key exchange")
    ) {
      errorStage = "handshake";
      connectionLogs.push(
        createConnectionLog(
          "error",
          errorStage,
          `SSH handshake failed: ${err.message}`,
          {
            errorCode: (err as unknown as Record<string, unknown>).code,
            errorLevel: (err as unknown as Record<string, unknown>).level,
          },
        ),
      );
    } else if (
      err.message.includes("authentication") ||
      err.message.includes("Authentication")
    ) {
      errorStage = "auth";
      connectionLogs.push(
        createConnectionLog(
          "error",
          errorStage,
          `Authentication failed: ${err.message}`,
          {
            errorCode: (err as unknown as Record<string, unknown>).code,
            errorLevel: (err as unknown as Record<string, unknown>).level,
          },
        ),
      );
    } else if (err.message.includes("verification failed")) {
      errorStage = "handshake";
      connectionLogs.push(
        createConnectionLog(
          "error",
          errorStage,
          `SSH host key has changed. For security, please open a Terminal connection to this host first to verify and accept the new key fingerprint.`,
          {
            errorCode: (err as unknown as Record<string, unknown>).code,
            errorLevel: (err as unknown as Record<string, unknown>).level,
          },
        ),
      );
    } else {
      connectionLogs.push(
        createConnectionLog(
          "error",
          "error",
          `SSH connection failed: ${err.message}`,
          {
            errorCode: (err as unknown as Record<string, unknown>).code,
            errorLevel: (err as unknown as Record<string, unknown>).level,
          },
        ),
      );
    }

    if (
      resolvedCredentials.authType === "none" &&
      (err.message.includes("authentication") ||
        err.message.includes("All configured authentication methods failed"))
    ) {
      res.json({
        status: "auth_required",
        reason: "no_keyboard",
        connectionLogs,
      });
    } else {
      res
        .status(500)
        .json({ status: "error", message: err.message, connectionLogs });
    }
  });

  client.on("close", () => {
    fileLogger.info("File manager SSH connection closed", {
      operation: "file_ssh_disconnected",
      sessionId,
      userId,
      hostId,
    });
    if (sshSessions[sessionId]) sshSessions[sessionId].isConnected = false;
    cleanupSession(sessionId);
  });

  client.on(
    "keyboard-interactive",
    (
      name: string,
      instructions: string,
      instructionsLang: string,
      prompts: Array<{ prompt: string; echo: boolean }>,
      finish: (responses: string[]) => void,
    ) => {
      const promptTexts = prompts.map((p) => p.prompt);

      const warpgatePattern = /warpgate\s+authentication/i;
      const isWarpgate =
        warpgatePattern.test(name) ||
        warpgatePattern.test(instructions) ||
        promptTexts.some((p) => warpgatePattern.test(p));

      if (isWarpgate) {
        const fullText = `${name}\n${instructions}\n${promptTexts.join("\n")}`;
        const urlMatch = fullText.match(/https?:\/\/[^\s\n]+/i);
        const keyMatch = fullText.match(
          /security key[:\s]+([a-z0-9](?:\s+[a-z0-9]){3}|[a-z0-9]{4})/i,
        );

        if (urlMatch) {
          if (responseSent) return;
          responseSent = true;

          connectionLogs.push(
            createConnectionLog(
              "info",
              "sftp_auth",
              "Warpgate authentication required",
              { url: urlMatch[0] },
            ),
          );

          pendingTOTPSessions[sessionId] = {
            client,
            finish,
            config,
            createdAt: Date.now(),
            sessionId,
            hostId,
            ip,
            port,
            username,
            userId,
            prompts,
            totpPromptIndex: -1,
            resolvedPassword: resolvedCredentials.password,
            totpAttempts: 0,
            isWarpgate: true,
          };

          res.json({
            requires_warpgate: true,
            sessionId,
            url: urlMatch[0],
            securityKey: keyMatch ? keyMatch[1] : "N/A",
            connectionLogs,
          });
          return;
        }
      }

      const totpPromptIndex = prompts.findIndex((p) =>
        /verification code|verification_code|token|otp|2fa|authenticator|google.*auth/i.test(
          p.prompt,
        ),
      );

      if (totpPromptIndex !== -1) {
        if (responseSent) {
          const responses = prompts.map((p) => {
            if (/password/i.test(p.prompt) && resolvedCredentials.password) {
              return resolvedCredentials.password;
            }
            return "";
          });
          finish(responses);
          return;
        }
        responseSent = true;

        if (pendingTOTPSessions[sessionId]) {
          const responses = prompts.map((p) => {
            if (/password/i.test(p.prompt) && resolvedCredentials.password) {
              return resolvedCredentials.password;
            }
            return "";
          });
          finish(responses);
          return;
        }

        connectionLogs.push(
          createConnectionLog(
            "info",
            "sftp_auth",
            "TOTP verification required",
            { prompt: prompts[totpPromptIndex].prompt },
          ),
        );

        pendingTOTPSessions[sessionId] = {
          client,
          finish,
          config,
          createdAt: Date.now(),
          sessionId,
          hostId,
          ip,
          port,
          username,
          userId,
          prompts,
          totpPromptIndex,
          resolvedPassword: resolvedCredentials.password,
          totpAttempts: 0,
        };

        res.json({
          requires_totp: true,
          sessionId,
          prompt: prompts[totpPromptIndex].prompt,
          connectionLogs,
        });
      } else {
        const hasStoredPassword =
          resolvedCredentials.password &&
          resolvedCredentials.authType !== "none";

        const passwordPromptIndex = prompts.findIndex((p) =>
          /password/i.test(p.prompt),
        );

        if (
          resolvedCredentials.authType === "none" &&
          passwordPromptIndex !== -1
        ) {
          if (responseSent) return;
          responseSent = true;

          client.end();

          res.json({
            status: "auth_required",
            reason: "no_keyboard",
          });
          return;
        }

        if (!hasStoredPassword && passwordPromptIndex !== -1) {
          if (responseSent) {
            const responses = prompts.map((p) => {
              if (/password/i.test(p.prompt) && resolvedCredentials.password) {
                return resolvedCredentials.password;
              }
              return "";
            });
            finish(responses);
            return;
          }
          responseSent = true;

          if (pendingTOTPSessions[sessionId]) {
            const responses = prompts.map((p) => {
              if (/password/i.test(p.prompt) && resolvedCredentials.password) {
                return resolvedCredentials.password;
              }
              return "";
            });
            finish(responses);
            return;
          }

          pendingTOTPSessions[sessionId] = {
            client,
            finish,
            config,
            createdAt: Date.now(),
            sessionId,
            hostId,
            ip,
            port,
            username,
            userId,
            prompts,
            totpPromptIndex: passwordPromptIndex,
            resolvedPassword: resolvedCredentials.password,
            totpAttempts: 0,
          };

          res.json({
            requires_totp: true,
            sessionId,
            prompt: prompts[passwordPromptIndex].prompt,
            isPassword: true,
          });
          return;
        }

        const responses = prompts.map((p) => {
          if (/password/i.test(p.prompt) && resolvedCredentials.password) {
            return resolvedCredentials.password;
          }
          return "";
        });

        finish(responses);
      }
    },
  );

  const proxyConfig: SOCKS5Config | null =
    useSocks5 &&
    (socks5Host ||
      (socks5ProxyChain && (socks5ProxyChain as ProxyNode[]).length > 0))
      ? {
          useSocks5,
          socks5Host,
          socks5Port,
          socks5Username,
          socks5Password,
          socks5ProxyChain: socks5ProxyChain as ProxyNode[],
        }
      : null;

  const hasJumpHosts = jumpHosts && jumpHosts.length > 0 && userId;

  if (hasJumpHosts) {
    try {
      if (proxyConfig) {
        connectionLogs.push(
          createConnectionLog(
            "info",
            "proxy",
            "Connecting via proxy + jump hosts",
          ),
        );
      }
      connectionLogs.push(
        createConnectionLog(
          "info",
          "jump",
          `Connecting via ${jumpHosts.length} jump host(s)`,
        ),
      );
      const jumpClient = await createJumpHostChain(
        jumpHosts,
        userId,
        proxyConfig,
      );

      if (!jumpClient) {
        fileLogger.error("Failed to establish jump host chain", {
          operation: "file_jump_chain",
          sessionId,
          hostId,
        });
        connectionLogs.push(
          createConnectionLog(
            "error",
            "jump",
            "Failed to establish jump host chain",
          ),
        );
        return res.status(500).json({
          error: "Failed to connect through jump hosts",
          connectionLogs,
        });
      }

      jumpClient.forwardOut("127.0.0.1", 0, ip, port, (err, stream) => {
        if (err) {
          fileLogger.error("Failed to forward through jump host", err, {
            operation: "file_jump_forward",
            sessionId,
            hostId,
            ip,
            port,
          });
          connectionLogs.push(
            createConnectionLog(
              "error",
              "jump",
              `Failed to forward through jump host: ${err.message}`,
            ),
          );
          jumpClient.end();
          return res.status(500).json({
            error: "Failed to forward through jump host: " + err.message,
            connectionLogs,
          });
        }

        config.sock = stream;
        client.connect(config);
      });
    } catch (error) {
      fileLogger.error("Jump host error", error, {
        operation: "file_jump_host",
        sessionId,
        hostId,
      });
      connectionLogs.push(
        createConnectionLog(
          "error",
          "jump",
          `Jump host error: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
      return res.status(500).json({
        error: "Failed to connect through jump hosts",
        connectionLogs,
      });
    }
  } else if (proxyConfig) {
    connectionLogs.push(
      createConnectionLog("info", "proxy", "Connecting via proxy", {
        proxyHost: socks5Host,
        proxyPort: socks5Port || 1080,
      }),
    );
    try {
      const proxySocket = await createSocks5Connection(ip, port, proxyConfig);
      if (proxySocket) {
        connectionLogs.push(
          createConnectionLog(
            "success",
            "proxy",
            "Proxy connected successfully",
          ),
        );
        config.sock = proxySocket;
      }
      client.connect(config);
    } catch (proxyError) {
      fileLogger.error("Proxy connection failed", proxyError, {
        operation: "proxy_connect",
        sessionId,
        hostId,
        proxyHost: socks5Host,
        proxyPort: socks5Port || 1080,
      });
      connectionLogs.push(
        createConnectionLog(
          "error",
          "proxy",
          `Proxy connection failed: ${proxyError instanceof Error ? proxyError.message : "Unknown error"}`,
        ),
      );
      return res.status(500).json({
        error:
          "Proxy connection failed: " +
          (proxyError instanceof Error ? proxyError.message : "Unknown error"),
        connectionLogs,
      });
    }
  } else {
    client.connect(config);
  }
});

/**
 * @openapi
 * /ssh/file_manager/ssh/connect-totp:
 *   post:
 *     summary: Verify TOTP and complete connection
 *     description: Verifies the TOTP code and completes the SSH connection for file manager.
 *     tags:
 *       - File Manager
 *     responses:
 *       200:
 *         description: TOTP verified, SSH connection established.
 *       400:
 *         description: Session ID and TOTP code required.
 *       401:
 *         description: Invalid TOTP code or authentication required.
 *       404:
 *         description: TOTP session expired.
 *       408:
 *         description: TOTP session timeout.
 */
app.post("/ssh/file_manager/ssh/connect-totp", async (req, res) => {
  const { sessionId, totpCode } = req.body;

  const userId = (req as AuthenticatedRequest).userId;

  if (!userId) {
    fileLogger.error("TOTP verification rejected: no authenticated user", {
      operation: "file_totp_auth",
      sessionId,
    });
    return res.status(401).json({ error: "Authentication required" });
  }

  if (!sessionId || !totpCode) {
    return res.status(400).json({ error: "Session ID and TOTP code required" });
  }

  const session = pendingTOTPSessions[sessionId];

  if (!session) {
    fileLogger.warn("TOTP session not found or expired", {
      operation: "file_totp_verify",
      sessionId,
      userId,
      availableSessions: Object.keys(pendingTOTPSessions),
    });
    return res
      .status(404)
      .json({ error: "TOTP session expired. Please reconnect." });
  }

  if (Date.now() - session.createdAt > 180000) {
    delete pendingTOTPSessions[sessionId];
    try {
      session.client.end();
    } catch {
      // expected
    }
    fileLogger.warn("TOTP session timeout before code submission", {
      operation: "file_totp_verify",
      sessionId,
      userId,
      age: Date.now() - session.createdAt,
    });
    return res
      .status(408)
      .json({ error: "TOTP session timeout. Please reconnect." });
  }

  const responses = (session.prompts || []).map((p, index) => {
    if (index === session.totpPromptIndex) {
      return totpCode;
    }
    if (/password/i.test(p.prompt) && session.resolvedPassword) {
      return session.resolvedPassword;
    }
    return "";
  });

  let responseSent = false;

  session.client.once("ready", () => {
    if (responseSent) return;
    responseSent = true;
    clearTimeout(responseTimeout);

    delete pendingTOTPSessions[sessionId];

    setTimeout(() => {
      sshSessions[sessionId] = {
        client: session.client,
        isConnected: true,
        lastActive: Date.now(),
        activeOperations: 0,
        channelOpener: new ChannelOpenSerializer(),
        userId,
        ip: session.ip,
        port: session.port,
        hostId: session.hostId,
        username: session.username,
      };
      scheduleSessionCleanup(sessionId);

      res.json({
        status: "success",
        message: "TOTP verified, SSH connection established",
      });

      if (session.hostId && session.userId) {
        (async () => {
          try {
            const hostResults = await SimpleDBOps.select(
              getDb()
                .select()
                .from(hosts)
                .where(
                  and(
                    eq(hosts.id, session.hostId!),
                    eq(hosts.userId, session.userId!),
                  ),
                ),
              "ssh_data",
              session.userId!,
            );

            const hostName =
              hostResults.length > 0 && hostResults[0].name
                ? hostResults[0].name
                : `${session.username}@${session.ip}:${session.port}`;

            const authManager = AuthManager.getInstance();
            await axios.post(
              "http://localhost:30006/activity/log",
              {
                type: "file_manager",
                hostId: session.hostId,
                hostName,
              },
              {
                headers: {
                  Authorization: `Bearer ${await authManager.generateJWTToken(session.userId!)}`,
                },
              },
            );
          } catch (error) {
            fileLogger.warn("Failed to log file manager activity (TOTP)", {
              operation: "activity_log_error",
              userId: session.userId,
              hostId: session.hostId,
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        })();
      }
    }, 200);
  });

  session.client.once("error", (err) => {
    if (responseSent) return;
    responseSent = true;
    clearTimeout(responseTimeout);

    delete pendingTOTPSessions[sessionId];

    fileLogger.error("TOTP verification failed", {
      operation: "file_totp_verify",
      sessionId,
      userId,
      error: err.message,
    });

    res.status(401).json({ status: "error", message: "Invalid TOTP code" });
  });

  const responseTimeout = setTimeout(() => {
    if (!responseSent) {
      responseSent = true;
      delete pendingTOTPSessions[sessionId];
      fileLogger.warn("TOTP verification timeout", {
        operation: "file_totp_verify",
        sessionId,
        userId,
      });
      res.status(408).json({ error: "TOTP verification timeout" });
    }
  }, 60000);

  session.finish(responses);
});

/**
 * @openapi
 * /ssh/file_manager/ssh/connect-warpgate:
 *   post:
 *     summary: Complete Warpgate authentication
 *     description: Submits empty response to complete Warpgate authentication after user completes browser auth.
 *     tags:
 *       - File Manager
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: Session ID from initial connection attempt
 *     responses:
 *       200:
 *         description: Warpgate authentication completed successfully.
 *       401:
 *         description: Authentication failed or unauthorized.
 *       404:
 *         description: Warpgate session expired.
 *       408:
 *         description: Warpgate session timeout.
 */
app.post("/ssh/file_manager/ssh/connect-warpgate", async (req, res) => {
  const { sessionId } = req.body;

  const userId = (req as AuthenticatedRequest).userId;

  if (!userId) {
    fileLogger.error("Warpgate verification rejected: no authenticated user", {
      operation: "file_warpgate_auth",
      sessionId,
    });
    return res.status(401).json({ error: "Authentication required" });
  }

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID required" });
  }

  const session = pendingTOTPSessions[sessionId];

  if (!session) {
    fileLogger.warn("Warpgate session not found or expired", {
      operation: "file_warpgate_verify",
      sessionId,
      userId,
      availableSessions: Object.keys(pendingTOTPSessions),
    });
    return res
      .status(404)
      .json({ error: "Warpgate session expired. Please reconnect." });
  }

  if (!session.isWarpgate) {
    return res.status(400).json({ error: "Session is not a Warpgate session" });
  }

  if (Date.now() - session.createdAt > 300000) {
    delete pendingTOTPSessions[sessionId];
    try {
      session.client.end();
    } catch {
      // expected
    }
    fileLogger.warn("Warpgate session timeout before completion", {
      operation: "file_warpgate_verify",
      sessionId,
      userId,
      age: Date.now() - session.createdAt,
    });
    return res
      .status(408)
      .json({ error: "Warpgate session timeout. Please reconnect." });
  }

  let responseSent = false;

  const responseTimeout = setTimeout(() => {
    if (!responseSent) {
      responseSent = true;
      delete pendingTOTPSessions[sessionId];
      fileLogger.warn("Warpgate verification timeout", {
        operation: "file_warpgate_verify",
        sessionId,
        userId,
      });
      res.status(408).json({ error: "Warpgate verification timeout" });
    }
  }, 60000);

  session.client.once("ready", () => {
    if (responseSent) return;
    responseSent = true;
    clearTimeout(responseTimeout);

    delete pendingTOTPSessions[sessionId];

    setTimeout(() => {
      sshSessions[sessionId] = {
        client: session.client,
        isConnected: true,
        lastActive: Date.now(),
        activeOperations: 0,
        channelOpener: new ChannelOpenSerializer(),
        userId,
        ip: session.ip,
        port: session.port,
        hostId: session.hostId,
        username: session.username,
      };
      scheduleSessionCleanup(sessionId);

      res.json({
        status: "success",
        message: "Warpgate verified, SSH connection established",
      });

      if (session.hostId && session.userId) {
        (async () => {
          try {
            const hostResults = await SimpleDBOps.select(
              getDb()
                .select()
                .from(hosts)
                .where(
                  and(
                    eq(hosts.id, session.hostId!),
                    eq(hosts.userId, session.userId!),
                  ),
                ),
              "ssh_data",
              session.userId!,
            );

            const hostName =
              hostResults.length > 0 && hostResults[0].name
                ? hostResults[0].name
                : `${session.username}@${session.ip}:${session.port}`;

            await axios.post(
              "http://localhost:30006/activity/log",
              {
                type: "file_manager",
                hostId: session.hostId,
                hostName,
              },
              {
                headers: {
                  Authorization: `Bearer ${await authManager.generateJWTToken(session.userId!)}`,
                },
              },
            );
          } catch (error) {
            fileLogger.warn("Failed to log file manager activity", {
              operation: "activity_log_error",
              userId: session.userId,
              hostId: session.hostId,
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        })();
      }
    }, 200);
  });

  session.client.once("error", (err) => {
    if (responseSent) return;
    responseSent = true;
    clearTimeout(responseTimeout);

    delete pendingTOTPSessions[sessionId];

    fileLogger.error("Warpgate verification failed", {
      operation: "file_warpgate_verify",
      sessionId,
      userId,
      error: err.message,
    });

    res
      .status(401)
      .json({ status: "error", message: "Warpgate authentication failed" });
  });

  session.finish([""]);
});

/**
 * @openapi
 * /ssh/file_manager/ssh/disconnect:
 *   post:
 *     summary: Disconnect from SSH
 *     description: Closes an active SSH connection for file manager.
 *     tags:
 *       - File Manager
 *     responses:
 *       200:
 *         description: SSH connection disconnected.
 */
app.post("/ssh/file_manager/ssh/disconnect", (req, res) => {
  const { sessionId } = req.body;
  const userId = (req as AuthenticatedRequest).userId;
  const session = sshSessions[sessionId];
  if (session && !verifySessionOwnership(session, userId)) {
    return res.status(403).json({ error: "Session access denied" });
  }
  fileLogger.info("File manager disconnection requested", {
    operation: "file_disconnect_request",
    sessionId,
    userId,
  });
  cleanupSession(sessionId);
  res.json({ status: "success", message: "SSH connection disconnected" });
});

/**
 * @openapi
 * /ssh/file_manager/sudo-password:
 *   post:
 *     summary: Set sudo password for session
 *     description: Stores sudo password temporarily in session for elevated operations.
 *     tags:
 *       - File Manager
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sessionId:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Sudo password set successfully.
 *       400:
 *         description: Invalid session.
 */
app.post("/ssh/file_manager/sudo-password", (req, res) => {
  const { sessionId, password } = req.body;
  const userId = (req as AuthenticatedRequest).userId;
  const session = sshSessions[sessionId];
  if (!session || !session.isConnected) {
    return res.status(400).json({ error: "Invalid or disconnected session" });
  }
  if (!verifySessionOwnership(session, userId)) {
    return res.status(403).json({ error: "Session access denied" });
  }
  session.sudoPassword = password;
  session.lastActive = Date.now();
  res.json({ status: "success", message: "Sudo password set" });
});

/**
 * @openapi
 * /ssh/file_manager/ssh/status:
 *   get:
 *     summary: Get SSH connection status
 *     description: Checks the status of an SSH connection for file manager.
 *     tags:
 *       - File Manager
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: SSH connection status.
 */
app.get("/ssh/file_manager/ssh/status", (req, res) => {
  const sessionId = req.query.sessionId as string;
  const userId = (req as AuthenticatedRequest).userId;
  const session = sshSessions[sessionId];
  if (session && !verifySessionOwnership(session, userId)) {
    return res.status(403).json({ error: "Session access denied" });
  }
  const isConnected = !!session?.isConnected;
  res.json({ status: "success", connected: isConnected });
});

/**
 * @openapi
 * /ssh/file_manager/ssh/keepalive:
 *   post:
 *     summary: Keep SSH session alive
 *     description: Keeps an active SSH session for file manager alive.
 *     tags:
 *       - File Manager
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sessionId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Session keepalive successful.
 *       400:
 *         description: Session ID is required or session not found.
 */
app.post("/ssh/file_manager/ssh/keepalive", async (req, res) => {
  const { sessionId } = req.body;
  const userId = (req as AuthenticatedRequest).userId;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  const session = sshSessions[sessionId];

  if (!session || !session.isConnected) {
    return res.status(400).json({
      error: "SSH session not found or not connected",
      connected: false,
    });
  }

  if (!verifySessionOwnership(session, userId)) {
    return res.status(403).json({ error: "Session access denied" });
  }

  session.lastActive = Date.now();
  scheduleSessionCleanup(sessionId);

  // Probe the cached SFTP channel. If stale, clear it so the next operation
  // opens a fresh one via the serialized getSessionSftp.
  if (session.sftp && !session.sftpPending) {
    try {
      await new Promise<void>((resolve, reject) => {
        session.sftp!.stat("/", (err) => (err ? reject(err) : resolve()));
      });
    } catch {
      session.sftp = undefined;
    }
  }

  res.json({
    status: "success",
    connected: true,
    message: "Session keepalive successful",
    lastActive: session.lastActive,
  });
});

registerFileListingRoutes(app, {
  sshSessions,
  activeListRequests,
  verifySessionOwnership,
});

registerFileContentRoutes(app, {
  sshSessions,
  verifySessionOwnership,
});

registerFileOperationRoutes(app, {
  sshSessions,
  verifySessionOwnership,
});

registerFileDownloadRoutes(app, {
  sshSessions,
  scheduleSessionCleanup,
  verifySessionOwnership,
});

registerFileActionRoutes(app, {
  sshSessions,
  scheduleSessionCleanup,
  verifySessionOwnership,
});

/**
 * @openapi
 * /ssh/file_manager/ssh/extractArchive:
 *   post:
 *     summary: Extract archive file
 *     description: Extracts an archive file (.tar, .tar.gz, .tgz, .zip, .tar.bz2, .tbz2, .tar.xz, .txz) to a specified or default location on the remote host.
 *     tags:
 *       - File Manager
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sessionId
 *               - archivePath
 *             properties:
 *               sessionId:
 *                 type: string
 *                 description: SSH session ID
 *               archivePath:
 *                 type: string
 *                 description: Path to the archive file on remote host
 *               extractPath:
 *                 type: string
 *                 description: Optional custom extraction path (defaults to same directory as archive)
 *     responses:
 *       200:
 *         description: Archive extracted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: success
 *                 message:
 *                   type: string
 *                 extractPath:
 *                   type: string
 *       400:
 *         description: Missing required parameters, SSH connection not established, or unsupported archive format.
 *       403:
 *         description: Permission denied.
 *       500:
 *         description: Failed to extract archive.
 */
app.post("/ssh/file_manager/ssh/extractArchive", async (req, res) => {
  const { sessionId, archivePath, extractPath } = req.body;
  const userId = (req as AuthenticatedRequest).userId;

  if (!sessionId || !archivePath) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  const session = sshSessions[sessionId];
  if (!session || !session.isConnected) {
    return res.status(400).json({ error: "SSH session not connected" });
  }

  if (!verifySessionOwnership(session, userId)) {
    return res.status(403).json({ error: "Session access denied" });
  }

  session.lastActive = Date.now();
  scheduleSessionCleanup(sessionId);

  const fileName = archivePath.split("/").pop() || "";
  const fileExt = fileName.toLowerCase();

  let extractCommand: string;
  const targetPath =
    extractPath || archivePath.substring(0, archivePath.lastIndexOf("/"));

  const escapedArchive = archivePath.replace(/'/g, "'\"'\"'");
  const escapedTarget = targetPath.replace(/'/g, "'\"'\"'");
  const escapedDecompressed = archivePath
    .replace(/\.gz$/, "")
    .replace(/'/g, "'\"'\"'");

  if (fileExt.endsWith(".tar.gz") || fileExt.endsWith(".tgz")) {
    extractCommand = `tar -xzf '${escapedArchive}' -C '${escapedTarget}'`;
  } else if (fileExt.endsWith(".tar.bz2") || fileExt.endsWith(".tbz2")) {
    extractCommand = `tar -xjf '${escapedArchive}' -C '${escapedTarget}'`;
  } else if (fileExt.endsWith(".tar.xz")) {
    extractCommand = `tar -xJf '${escapedArchive}' -C '${escapedTarget}'`;
  } else if (fileExt.endsWith(".tar")) {
    extractCommand = `tar -xf '${escapedArchive}' -C '${escapedTarget}'`;
  } else if (fileExt.endsWith(".zip")) {
    extractCommand = `unzip -o '${escapedArchive}' -d '${escapedTarget}'`;
  } else if (fileExt.endsWith(".gz") && !fileExt.endsWith(".tar.gz")) {
    extractCommand = `gunzip -c '${escapedArchive}' > '${escapedDecompressed}'`;
  } else if (fileExt.endsWith(".bz2") && !fileExt.endsWith(".tar.bz2")) {
    extractCommand = `bunzip2 -k '${escapedArchive}'`;
  } else if (fileExt.endsWith(".xz") && !fileExt.endsWith(".tar.xz")) {
    extractCommand = `unxz -k '${escapedArchive}'`;
  } else if (fileExt.endsWith(".7z")) {
    extractCommand = `7z x '${escapedArchive}' -o'${escapedTarget}'`;
  } else if (fileExt.endsWith(".rar")) {
    extractCommand = `unrar x '${escapedArchive}' '${escapedTarget}/'`;
  } else {
    return res.status(400).json({ error: "Unsupported archive format" });
  }

  fileLogger.info("Extracting archive", {
    operation: "extract_archive",
    sessionId,
    archivePath,
    extractPath: targetPath,
    command: extractCommand,
  });

  execChannel(session, extractCommand, (err, stream) => {
    if (err) {
      fileLogger.error("SSH exec error during extract:", err, {
        operation: "extract_archive",
        sessionId,
        archivePath,
      });
      return res
        .status(500)
        .json({ error: "Failed to execute extract command" });
    }

    let errorOutput = "";

    stream.on("data", () => {
      /* consume stdout */
    });

    stream.stderr.on("data", (data: Buffer) => {
      errorOutput += data.toString();
    });

    stream.on("close", (code: number) => {
      if (code !== 0) {
        fileLogger.error("Extract command failed", {
          operation: "extract_archive",
          sessionId,
          archivePath,
          exitCode: code,
          error: errorOutput,
        });

        let friendlyError = errorOutput || "Failed to extract archive";
        if (
          errorOutput.includes("command not found") ||
          errorOutput.includes("not found")
        ) {
          let missingCmd = "";
          let installHint = "";

          if (fileExt.endsWith(".zip")) {
            missingCmd = "unzip";
            installHint =
              "apt install unzip / yum install unzip / brew install unzip";
          } else if (
            fileExt.endsWith(".tar.gz") ||
            fileExt.endsWith(".tgz") ||
            fileExt.endsWith(".tar.bz2") ||
            fileExt.endsWith(".tbz2") ||
            fileExt.endsWith(".tar.xz") ||
            fileExt.endsWith(".tar")
          ) {
            missingCmd = "tar";
            installHint = "Usually pre-installed on Linux/Unix systems";
          } else if (fileExt.endsWith(".gz")) {
            missingCmd = "gunzip";
            installHint =
              "apt install gzip / yum install gzip / Usually pre-installed";
          } else if (fileExt.endsWith(".bz2")) {
            missingCmd = "bunzip2";
            installHint =
              "apt install bzip2 / yum install bzip2 / brew install bzip2";
          } else if (fileExt.endsWith(".xz")) {
            missingCmd = "unxz";
            installHint =
              "apt install xz-utils / yum install xz / brew install xz";
          } else if (fileExt.endsWith(".7z")) {
            missingCmd = "7z";
            installHint =
              "apt install p7zip-full / yum install p7zip / brew install p7zip";
          } else if (fileExt.endsWith(".rar")) {
            missingCmd = "unrar";
            installHint =
              "apt install unrar / yum install unrar / brew install unrar";
          }

          if (missingCmd) {
            friendlyError = `Command '${missingCmd}' not found on remote server. Please install it first: ${installHint}`;
          }
        }

        return res.status(500).json({ error: friendlyError });
      }

      fileLogger.success("Archive extracted successfully", {
        operation: "extract_archive",
        sessionId,
        archivePath,
        extractPath: targetPath,
      });

      res.json({
        success: true,
        message: "Archive extracted successfully",
        extractPath: targetPath,
      });
    });

    stream.on("error", (streamErr) => {
      fileLogger.error("SSH extractArchive stream error:", streamErr, {
        operation: "extract_archive",
        sessionId,
        archivePath,
      });
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: "Stream error while extracting archive" });
      }
    });
  });
});

/**
 * @openapi
 * /ssh/file_manager/ssh/compressFiles:
 *   post:
 *     summary: Compress files
 *     description: Compresses files and/or directories on the remote host.
 *     tags:
 *       - File Manager
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sessionId:
 *                 type: string
 *               paths:
 *                 type: array
 *                 items:
 *                   type: string
 *               archiveName:
 *                 type: string
 *               format:
 *                 type: string
 *     responses:
 *       200:
 *         description: Files compressed successfully.
 *       400:
 *         description: Missing required parameters or unsupported compression format.
 *       500:
 *         description: Failed to compress files.
 */
app.post("/ssh/file_manager/ssh/compressFiles", async (req, res) => {
  const { sessionId, paths, archiveName, format } = req.body;
  const userId = (req as AuthenticatedRequest).userId;

  if (
    !sessionId ||
    !paths ||
    !Array.isArray(paths) ||
    paths.length === 0 ||
    !archiveName
  ) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  const session = sshSessions[sessionId];
  if (!session || !session.isConnected) {
    return res.status(400).json({ error: "SSH session not connected" });
  }

  if (!verifySessionOwnership(session, userId)) {
    return res.status(403).json({ error: "Session access denied" });
  }

  session.lastActive = Date.now();
  scheduleSessionCleanup(sessionId);

  const compressionFormat = format || "zip";
  let compressCommand: string;

  const firstPath = paths[0];
  const workingDir = firstPath.substring(0, firstPath.lastIndexOf("/")) || "/";

  const escapeShell = (s: string) => s.replace(/'/g, "'\"'\"'");

  const fileNames = paths
    .map((p) => {
      const name = p.split("/").pop();
      return `'./${escapeShell(name || "")}'`;
    })
    .join(" ");

  let archivePath = "";
  if (archiveName.includes("/")) {
    archivePath = archiveName;
  } else {
    archivePath = workingDir.endsWith("/")
      ? `${workingDir}${archiveName}`
      : `${workingDir}/${archiveName}`;
  }

  const escapedDir = escapeShell(workingDir);
  const escapedArchive = escapeShell(archivePath);

  if (compressionFormat === "zip") {
    compressCommand = `cd '${escapedDir}' && zip -r '${escapedArchive}' -- ${fileNames}`;
  } else if (compressionFormat === "tar.gz" || compressionFormat === "tgz") {
    compressCommand = `cd '${escapedDir}' && tar -czf '${escapedArchive}' -- ${fileNames}`;
  } else if (compressionFormat === "tar.bz2" || compressionFormat === "tbz2") {
    compressCommand = `cd '${escapedDir}' && tar -cjf '${escapedArchive}' -- ${fileNames}`;
  } else if (compressionFormat === "tar.xz") {
    compressCommand = `cd '${escapedDir}' && tar -cJf '${escapedArchive}' -- ${fileNames}`;
  } else if (compressionFormat === "tar") {
    compressCommand = `cd '${escapedDir}' && tar -cf '${escapedArchive}' -- ${fileNames}`;
  } else if (compressionFormat === "7z") {
    compressCommand = `cd '${escapedDir}' && 7z a '${escapedArchive}' -- ${fileNames}`;
  } else {
    return res.status(400).json({ error: "Unsupported compression format" });
  }

  fileLogger.info("Compressing files", {
    operation: "compress_files",
    sessionId,
    paths,
    archivePath,
    format: compressionFormat,
    command: compressCommand,
  });

  execChannel(session, compressCommand, (err, stream) => {
    if (err) {
      fileLogger.error("SSH exec error during compress:", err, {
        operation: "compress_files",
        sessionId,
        paths,
      });
      return res
        .status(500)
        .json({ error: "Failed to execute compress command" });
    }

    let errorOutput = "";

    stream.on("data", () => {
      /* consume stdout */
    });

    stream.stderr.on("data", (data: Buffer) => {
      errorOutput += data.toString();
    });

    stream.on("close", (code: number) => {
      if (code !== 0) {
        fileLogger.error("Compress command failed", {
          operation: "compress_files",
          sessionId,
          paths,
          archivePath,
          exitCode: code,
          error: errorOutput,
        });

        let friendlyError = errorOutput || "Failed to compress files";
        if (
          errorOutput.includes("command not found") ||
          errorOutput.includes("not found")
        ) {
          const commandMap: Record<string, { cmd: string; install: string }> = {
            zip: {
              cmd: "zip",
              install: "apt install zip / yum install zip / brew install zip",
            },
            "tar.gz": {
              cmd: "tar",
              install: "Usually pre-installed on Linux/Unix systems",
            },
            "tar.bz2": {
              cmd: "tar",
              install: "Usually pre-installed on Linux/Unix systems",
            },
            "tar.xz": {
              cmd: "tar",
              install: "Usually pre-installed on Linux/Unix systems",
            },
            tar: {
              cmd: "tar",
              install: "Usually pre-installed on Linux/Unix systems",
            },
            "7z": {
              cmd: "7z",
              install:
                "apt install p7zip-full / yum install p7zip / brew install p7zip",
            },
          };

          const info = commandMap[compressionFormat];
          if (info) {
            friendlyError = `Command '${info.cmd}' not found on remote server. Please install it first: ${info.install}`;
          }
        }

        return res.status(500).json({ error: friendlyError });
      }

      fileLogger.success("Files compressed successfully", {
        operation: "compress_files",
        sessionId,
        paths,
        archivePath,
        format: compressionFormat,
      });

      res.json({
        success: true,
        message: "Files compressed successfully",
        archivePath: archivePath,
      });
    });

    stream.on("error", (streamErr) => {
      fileLogger.error("SSH compressFiles stream error:", streamErr, {
        operation: "compress_files",
        sessionId,
        paths,
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "Stream error while compressing files" });
      }
    });
  });
});

const hostTransferDeps: HostTransferDeps = {
  sshSessions,
  getSessionSftp,
  execChannel,
  verifySessionOwnership,
  openDedicatedTransferSession,
  closeDedicatedTransferSession,
};

app.post("/ssh/file_manager/ssh/transferMethodPreview", async (req, res) => {
  const {
    sourceSessionId,
    destSessionId,
    sourcePaths,
    destPath,
    methodPreference,
  } = req.body;
  const userId = (req as AuthenticatedRequest).userId;

  if (
    !sourceSessionId ||
    !destSessionId ||
    !destPath ||
    !sourcePaths ||
    !Array.isArray(sourcePaths) ||
    sourcePaths.length === 0
  ) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    const preview = await previewArchiveTransferMethod(hostTransferDeps, {
      sourceSessionId,
      destSessionId,
      sourcePaths,
      destPath,
      methodPreference:
        methodPreference === "tar" || methodPreference === "item_sftp"
          ? methodPreference
          : "auto",
      userId,
    });
    res.json(preview);
  } catch (err) {
    fileLogger.error("Failed to preview transfer method", err, {
      operation: "host_transfer",
      sourceSessionId,
      destSessionId,
      sourcePaths,
    });
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to preview method",
    });
  }
});

app.post("/ssh/file_manager/ssh/transferToHost", async (req, res) => {
  const {
    sourceSessionId,
    sourcePaths,
    destSessionId,
    destPath,
    move,
    methodPreference,
    parallelSegmentCount: parallelSegmentCountRaw,
  } = req.body;
  const userId = (req as AuthenticatedRequest).userId;

  if (
    !sourceSessionId ||
    !destSessionId ||
    !destPath ||
    !sourcePaths ||
    !Array.isArray(sourcePaths) ||
    sourcePaths.length === 0
  ) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  const sourceSession = sshSessions[sourceSessionId];
  const destSession = sshSessions[destSessionId];

  if (!sourceSession?.isConnected || !destSession?.isConnected) {
    return res.status(400).json({ error: "SSH session not connected" });
  }

  if (
    !verifySessionOwnership(sourceSession, userId) ||
    !verifySessionOwnership(destSession, userId)
  ) {
    return res.status(403).json({ error: "Session access denied" });
  }

  sourceSession.lastActive = Date.now();
  destSession.lastActive = Date.now();
  scheduleSessionCleanup(sourceSessionId);
  scheduleSessionCleanup(destSessionId);

  try {
    const rawParallel = Number(parallelSegmentCountRaw);
    const parallelSegmentCount = Number.isFinite(rawParallel)
      ? Math.max(1, Math.min(8, Math.floor(rawParallel)))
      : 2;

    const { transferId } = startHostTransfer(hostTransferDeps, {
      sourceSessionId,
      sourcePaths,
      destSessionId,
      destPath,
      move: !!move,
      userId,
      methodPreference:
        methodPreference === "tar" || methodPreference === "item_sftp"
          ? methodPreference
          : "auto",
      parallelSegmentCount,
    });

    res.json({ transferId });
  } catch (err) {
    fileLogger.error("Failed to start host transfer", err, {
      operation: "host_transfer",
      sourceSessionId,
      destSessionId,
      sourcePaths,
    });
    res.status(500).json({ error: "Failed to start transfer" });
  }
});

app.get("/ssh/file_manager/ssh/activeTransfers", async (req, res) => {
  const userId = (req as unknown as AuthenticatedRequest).userId;
  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  await probeHungStreamTransfers(hostTransferDeps);
  res.json({ transfers: listActiveTransfers(userId) });
});

app.get(
  "/ssh/file_manager/ssh/transferStatus/:transferId",
  async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const transferId = req.params.transferId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    await probeHungStreamTransfers(hostTransferDeps);
    const status = getTransferStatus(transferId, userId);
    if (!status) {
      return res.status(404).json({ error: "Transfer not found" });
    }

    res.json(status);
  },
);

app.post("/ssh/file_manager/ssh/transferCancel/:transferId", (req, res) => {
  const userId = (req as unknown as AuthenticatedRequest).userId;
  const transferId = req.params.transferId;

  const cancelled = requestTransferCancel(transferId, userId);
  if (!cancelled) {
    return res.status(404).json({ error: "Transfer not found or not running" });
  }

  res.json({ ok: true });
});

app.post(
  "/ssh/file_manager/ssh/transferCleanup/:transferId",
  async (req, res) => {
    const userId = (req as unknown as AuthenticatedRequest).userId;
    const transferId = req.params.transferId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    try {
      const result = await cleanupCancelledTransfer(
        hostTransferDeps,
        transferId,
        userId,
      );
      res.json(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to clean up transfer";
      const status = message === "Transfer not found" ? 404 : 400;
      res.status(status).json({ error: message });
    }
  },
);

app.post("/ssh/file_manager/ssh/transferRetry/:transferId", (req, res) => {
  const userId = (req as unknown as AuthenticatedRequest).userId;
  const transferId = req.params.transferId;

  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const retried = retryHostTransfer(hostTransferDeps, transferId, userId);
  if (!retried) {
    return res
      .status(404)
      .json({ error: "Transfer not found or not retryable" });
  }

  res.json({ ok: true, transferId });
});

process.on("SIGINT", () => {
  Object.keys(sshSessions).forEach(cleanupSession);
  process.exit(0);
});

process.on("SIGTERM", () => {
  Object.keys(sshSessions).forEach(cleanupSession);
  process.exit(0);
});

const PORT = 30004;

try {
  const server = app.listen(PORT, async () => {
    try {
      await authManager.initialize();
    } catch (err) {
      fileLogger.error("Failed to initialize AuthManager", err, {
        operation: "auth_init_error",
      });
    }
  });

  server.on("error", (err) => {
    fileLogger.error("File Manager server error", err, {
      operation: "file_manager_server_error",
      port: PORT,
    });
  });
} catch (err) {
  fileLogger.error("Failed to start File Manager server", err, {
    operation: "file_manager_server_start_failed",
    port: PORT,
  });
}
