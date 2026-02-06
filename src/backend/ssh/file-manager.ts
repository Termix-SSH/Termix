import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import axios from "axios";
import { Client as SSHClient } from "ssh2";
import { getDb } from "../database/db/index.js";
import { sshCredentials, sshData } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { fileLogger, sshLogger } from "../utils/logger.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { AuthManager } from "../utils/auth-manager.js";
import type { AuthenticatedRequest } from "../../types/index.js";
import { createSocks5Connection } from "../utils/socks5-helper.js";
import type { LogEntry, ConnectionStage } from "../../types/connection-log.js";
import { SSHHostKeyVerifier } from "./host-key-verifier.js";

function createConnectionLog(
  type: "info" | "success" | "warning" | "error",
  stage: ConnectionStage,
  message: string,
  details?: Record<string, any>,
): Omit<LogEntry, "id" | "timestamp"> {
  return {
    type,
    stage,
    message,
    details,
  };
}

function isExecutableFile(permissions: string, fileName: string): boolean {
  const hasExecutePermission =
    permissions[3] === "x" || permissions[6] === "x" || permissions[9] === "x";

  const scriptExtensions = [
    ".sh",
    ".py",
    ".pl",
    ".rb",
    ".js",
    ".php",
    ".bash",
    ".zsh",
    ".fish",
  ];
  const hasScriptExtension = scriptExtensions.some((ext) =>
    fileName.toLowerCase().endsWith(ext),
  );

  const executableExtensions = [".bin", ".exe", ".out"];
  const hasExecutableExtension = executableExtensions.some((ext) =>
    fileName.toLowerCase().endsWith(ext),
  );

  const hasNoExtension = !fileName.includes(".") && hasExecutePermission;

  return (
    hasExecutePermission &&
    (hasScriptExtension || hasExecutableExtension || hasNoExtension)
  );
}

function modeToPermissions(mode: number): string {
  const S_IFDIR = 0o040000;
  const S_IFLNK = 0o120000;
  const S_IFMT = 0o170000;

  const type = mode & S_IFMT;
  const prefix = type === S_IFDIR ? "d" : type === S_IFLNK ? "l" : "-";

  const perms = [
    mode & 0o400 ? "r" : "-",
    mode & 0o200 ? "w" : "-",
    mode & 0o100 ? "x" : "-",
    mode & 0o040 ? "r" : "-",
    mode & 0o020 ? "w" : "-",
    mode & 0o010 ? "x" : "-",
    mode & 0o004 ? "r" : "-",
    mode & 0o002 ? "w" : "-",
    mode & 0o001 ? "x" : "-",
  ].join("");

  return prefix + perms;
}

function formatMtime(mtime: number): string {
  const date = new Date(mtime * 1000);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = months[date.getMonth()];
  const day = date.getDate().toString().padStart(2, " ");
  const now = new Date();
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  if (date > sixMonthsAgo) {
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${month} ${day} ${hours}:${minutes}`;
  }
  return `${month} ${day}  ${date.getFullYear()}`;
}

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
      "Content-Type",
      "Authorization",
      "User-Agent",
      "X-Electron-App",
    ],
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "1gb" }));
app.use(express.urlencoded({ limit: "1gb", extended: true }));
app.use(express.raw({ limit: "5gb", type: "application/octet-stream" }));

const authManager = AuthManager.getInstance();
app.use(authManager.createAuthMiddleware());

async function resolveJumpHost(
  hostId: number,
  userId: string,
): Promise<any | null> {
  try {
    const hosts = await SimpleDBOps.select(
      getDb()
        .select()
        .from(sshData)
        .where(and(eq(sshData.id, hostId), eq(sshData.userId, userId))),
      "ssh_data",
      userId,
    );

    if (hosts.length === 0) {
      return null;
    }

    const host = hosts[0];

    if (host.credentialId) {
      const credentials = await SimpleDBOps.select(
        getDb()
          .select()
          .from(sshCredentials)
          .where(
            and(
              eq(sshCredentials.id, host.credentialId as number),
              eq(sshCredentials.userId, userId),
            ),
          ),
        "ssh_credentials",
        userId,
      );

      if (credentials.length > 0) {
        const credential = credentials[0];
        return {
          ...host,
          password: credential.password,
          key:
            credential.private_key || credential.privateKey || credential.key,
          keyPassword: credential.key_password || credential.keyPassword,
          keyType: credential.key_type || credential.keyType,
          authType: credential.auth_type || credential.authType,
        };
      }
    }

    return host;
  } catch (error) {
    fileLogger.error("Failed to resolve jump host", error, {
      operation: "resolve_jump_host",
      hostId,
      userId,
    });
    return null;
  }
}

async function createJumpHostChain(
  jumpHosts: Array<{ hostId: number }>,
  userId: string,
): Promise<SSHClient | null> {
  if (!jumpHosts || jumpHosts.length === 0) {
    return null;
  }

  let currentClient: SSHClient | null = null;
  const clients: SSHClient[] = [];

  try {
    for (let i = 0; i < jumpHosts.length; i++) {
      const jumpHostConfig = await resolveJumpHost(jumpHosts[i].hostId, userId);

      if (!jumpHostConfig) {
        fileLogger.error(`Jump host ${i + 1} not found`, undefined, {
          operation: "jump_host_chain",
          hostId: jumpHosts[i].hostId,
        });
        clients.forEach((c) => c.end());
        return null;
      }

      const jumpClient = new SSHClient();
      clients.push(jumpClient);

      const jumpHostVerifier = await SSHHostKeyVerifier.createHostVerifier(
        jumpHostConfig.id,
        jumpHostConfig.ip,
        jumpHostConfig.port || 22,
        null,
        userId,
        true,
      );

      const connected = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(false);
        }, 30000);

        jumpClient.on("ready", () => {
          clearTimeout(timeout);
          resolve(true);
        });

        jumpClient.on("error", (err) => {
          clearTimeout(timeout);
          fileLogger.error(`Jump host ${i + 1} connection failed`, err, {
            operation: "jump_host_connect",
            hostId: jumpHostConfig.id,
            ip: jumpHostConfig.ip,
          });
          resolve(false);
        });

        const connectConfig: any = {
          host: jumpHostConfig.ip,
          port: jumpHostConfig.port || 22,
          username: jumpHostConfig.username,
          tryKeyboard: true,
          readyTimeout: 30000,
          hostVerifier: jumpHostVerifier,
        };

        if (jumpHostConfig.authType === "password" && jumpHostConfig.password) {
          connectConfig.password = jumpHostConfig.password;
        } else if (jumpHostConfig.authType === "key" && jumpHostConfig.key) {
          const cleanKey = jumpHostConfig.key
            .trim()
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");
          connectConfig.privateKey = Buffer.from(cleanKey, "utf8");
          if (jumpHostConfig.keyPassword) {
            connectConfig.passphrase = jumpHostConfig.keyPassword;
          }
        }

        if (currentClient) {
          currentClient.forwardOut(
            "127.0.0.1",
            0,
            jumpHostConfig.ip,
            jumpHostConfig.port || 22,
            (err, stream) => {
              if (err) {
                clearTimeout(timeout);
                resolve(false);
                return;
              }
              connectConfig.sock = stream;
              jumpClient.connect(connectConfig);
            },
          );
        } else {
          jumpClient.connect(connectConfig);
        }
      });

      if (!connected) {
        clients.forEach((c) => c.end());
        return null;
      }

      currentClient = jumpClient;
    }

    return currentClient;
  } catch (error) {
    fileLogger.error("Failed to create jump host chain", error, {
      operation: "jump_host_chain",
    });
    clients.forEach((c) => c.end());
    return null;
  }
}

interface SSHSession {
  client: SSHClient;
  isConnected: boolean;
  lastActive: number;
  timeout?: NodeJS.Timeout;
  activeOperations: number;
  sudoPassword?: string;
}

interface PendingTOTPSession {
  client: SSHClient;
  finish: (responses: string[]) => void;
  config: import("ssh2").ConnectConfig;
  createdAt: number;
  sessionId: string;
  hostId?: number;
  ip?: string;
  port?: number;
  username?: string;
  userId?: string;
  prompts?: Array<{ prompt: string; echo: boolean }>;
  totpPromptIndex?: number;
  resolvedPassword?: string;
  totpAttempts: number;
  isWarpgate?: boolean;
}

const sshSessions: Record<string, SSHSession> = {};
const pendingTOTPSessions: Record<string, PendingTOTPSession> = {};

function execWithSudo(
  client: SSHClient,
  command: string,
  sudoPassword: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const escapedPassword = sudoPassword.replace(/'/g, "'\"'\"'");
    const sudoCommand = `echo '${escapedPassword}' | sudo -S ${command} 2>&1`;

    client.exec(sudoCommand, (err, stream) => {
      if (err) {
        resolve({ stdout: "", stderr: err.message, code: 1 });
        return;
      }

      let stdout = "";
      let stderr = "";

      stream.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      stream.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      stream.on("close", (code: number) => {
        stdout = stdout.replace(/\[sudo\] password for .+?:\s*/g, "");
        resolve({ stdout, stderr, code: code || 0 });
      });

      stream.on("error", (streamErr: Error) => {
        resolve({ stdout, stderr: streamErr.message, code: 1 });
      });
    });
  });
}

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
      session.client.end();
    } catch (error) {}
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

function getMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    txt: "text/plain",
    json: "application/json",
    js: "text/javascript",
    html: "text/html",
    css: "text/css",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    pdf: "application/pdf",
    zip: "application/zip",
    tar: "application/x-tar",
    gz: "application/gzip",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}

function detectBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;

  const sampleSize = Math.min(buffer.length, 8192);
  let nullBytes = 0;

  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i];

    if (byte === 0) {
      nullBytes++;
    }

    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      if (++nullBytes > 1) return true;
    }
  }

  return nullBytes / sampleSize > 0.01;
}

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
    userProvidedPassword,
    forceKeyboardInteractive,
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
    } catch {}
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

  let resolvedCredentials = { password, sshKey, keyPassword, authType };
  if (credentialId && hostId && userId) {
    try {
      const credentials = await SimpleDBOps.select(
        getDb()
          .select()
          .from(sshCredentials)
          .where(
            and(
              eq(sshCredentials.id, credentialId),
              eq(sshCredentials.userId, userId),
            ),
          ),
        "ssh_credentials",
        userId,
      );

      if (credentials.length > 0) {
        const credential = credentials[0];
        resolvedCredentials = {
          password: credential.password,
          sshKey:
            credential.private_key || credential.privateKey || credential.key,
          keyPassword: credential.key_password || credential.keyPassword,
          authType: credential.auth_type || credential.authType,
        };
        connectionLogs.push(
          createConnectionLog(
            "info",
            "sftp_auth",
            "Credentials resolved from credential store",
          ),
        );
      } else {
        fileLogger.warn(`No credentials found for host ${hostId}`, {
          operation: "ssh_credentials",
          hostId,
          credentialId,
          userId,
        });
        connectionLogs.push(
          createConnectionLog(
            "warning",
            "sftp_auth",
            "No stored credentials found, using provided credentials",
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
      connectionLogs.push(
        createConnectionLog(
          "warning",
          "sftp_auth",
          `Failed to resolve credentials: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
  } else if (credentialId && hostId) {
    fileLogger.warn(
      "Missing userId for credential resolution in file manager",
      {
        operation: "ssh_credentials",
        hostId,
        credentialId,
        hasUserId: !!userId,
      },
    );
  }

  const config: Record<string, unknown> = {
    host: ip,
    port,
    username,
    tryKeyboard: true,
    keepaliveInterval: 30000,
    keepaliveCountMax: 3,
    readyTimeout: 60000,
    tcpKeepAlive: true,
    tcpKeepAliveInitialDelay: 30000,
    hostVerifier: await SSHHostKeyVerifier.createHostVerifier(
      hostId,
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
    if (!resolvedCredentials.password || !resolvedCredentials.password.trim()) {
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

      const { promises: fs } = await import("fs");
      const path = await import("path");
      const os = await import("os");

      const tempDir = os.tmpdir();
      const keyPath = path.join(tempDir, `opkssh-fm-${userId}-${hostId}`);
      const certPath = `${keyPath}-cert.pub`;

      await fs.writeFile(keyPath, token.privateKey, { mode: 0o600 });
      await fs.writeFile(certPath, token.sshCert, { mode: 0o600 });

      config.privateKey = await fs.readFile(keyPath);
      connectionLogs.push(
        createConnectionLog(
          "info",
          "sftp_auth",
          "Using OPKSSH certificate authentication",
        ),
      );

      setTimeout(async () => {
        try {
          const cleanupResults = await Promise.allSettled([
            fs.unlink(keyPath),
            fs.unlink(certPath),
          ]);

          cleanupResults.forEach((result, index) => {
            if (result.status === "rejected") {
              fileLogger.warn(`Failed to cleanup OPKSSH temp file`, {
                operation: "opkssh_temp_cleanup_failed",
                file: index === 0 ? "keyPath" : "certPath",
                sessionId,
                error: result.reason,
              });
            }
          });
        } catch (error) {
          fileLogger.error("Failed to cleanup OPKSSH temp files", {
            operation: "opkssh_temp_cleanup_error",
            sessionId,
            error,
          });
        }
      }, 60000);
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
          const hosts = await SimpleDBOps.select(
            getDb()
              .select()
              .from(sshData)
              .where(and(eq(sshData.id, hostId), eq(sshData.userId, userId))),
            "ssh_data",
            userId,
          );

          const hostName =
            hosts.length > 0 && hosts[0].name
              ? hosts[0].name
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

    let errorStage: ConnectionStage = "error";
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
          { errorCode: (err as any).code, errorLevel: (err as any).level },
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
          { errorCode: (err as any).code, errorLevel: (err as any).level },
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
          { errorCode: (err as any).code, errorLevel: (err as any).level },
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
          { errorCode: (err as any).code, errorLevel: (err as any).level },
        ),
      );
    } else if (err.message.includes("verification failed")) {
      errorStage = "handshake";
      connectionLogs.push(
        createConnectionLog(
          "error",
          errorStage,
          `SSH host key has changed. For security, please open a Terminal connection to this host first to verify and accept the new key fingerprint.`,
          { errorCode: (err as any).code, errorLevel: (err as any).level },
        ),
      );
    } else {
      connectionLogs.push(
        createConnectionLog(
          "error",
          "error",
          `SSH connection failed: ${err.message}`,
          { errorCode: (err as any).code, errorLevel: (err as any).level },
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

  let keyboardInteractiveResponded = false;

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

          keyboardInteractiveResponded = true;

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

        keyboardInteractiveResponded = true;

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

          keyboardInteractiveResponded = true;

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

  if (
    useSocks5 &&
    (socks5Host || (socks5ProxyChain && (socks5ProxyChain as any).length > 0))
  ) {
    connectionLogs.push(
      createConnectionLog("info", "proxy", "Connecting via SOCKS5 proxy", {
        proxyHost: socks5Host,
        proxyPort: socks5Port || 1080,
      }),
    );
    try {
      const socks5Socket = await createSocks5Connection(ip, port, {
        useSocks5,
        socks5Host,
        socks5Port,
        socks5Username,
        socks5Password,
        socks5ProxyChain: socks5ProxyChain as any,
      });

      if (socks5Socket) {
        connectionLogs.push(
          createConnectionLog(
            "success",
            "proxy",
            "SOCKS5 proxy connected successfully",
          ),
        );
        config.sock = socks5Socket;
        client.connect(config);
        return;
      } else {
        fileLogger.error("SOCKS5 socket is null for SFTP", undefined, {
          operation: "sftp_socks5_socket_null",
          sessionId,
        });
        connectionLogs.push(
          createConnectionLog(
            "error",
            "proxy",
            "SOCKS5 socket creation returned null",
          ),
        );
      }
    } catch (socks5Error) {
      fileLogger.error("SOCKS5 connection failed", socks5Error, {
        operation: "socks5_connect",
        sessionId,
        hostId,
        proxyHost: socks5Host,
        proxyPort: socks5Port || 1080,
      });
      connectionLogs.push(
        createConnectionLog(
          "error",
          "proxy",
          `SOCKS5 proxy connection failed: ${socks5Error instanceof Error ? socks5Error.message : "Unknown error"}`,
        ),
      );
      return res.status(500).json({
        error:
          "SOCKS5 proxy connection failed: " +
          (socks5Error instanceof Error
            ? socks5Error.message
            : "Unknown error"),
        connectionLogs,
      });
    }
  } else if (jumpHosts && jumpHosts.length > 0 && userId) {
    try {
      connectionLogs.push(
        createConnectionLog(
          "info",
          "jump",
          `Connecting via ${jumpHosts.length} jump host(s)`,
        ),
      );
      const jumpClient = await createJumpHostChain(jumpHosts, userId);

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
    } catch (error) {}
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
  let responseTimeout: NodeJS.Timeout;

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
      };
      scheduleSessionCleanup(sessionId);

      res.json({
        status: "success",
        message: "TOTP verified, SSH connection established",
      });

      if (session.hostId && session.userId) {
        (async () => {
          try {
            const hosts = await SimpleDBOps.select(
              getDb()
                .select()
                .from(sshData)
                .where(
                  and(
                    eq(sshData.id, session.hostId!),
                    eq(sshData.userId, session.userId!),
                  ),
                ),
              "ssh_data",
              session.userId!,
            );

            const hostName =
              hosts.length > 0 && hosts[0].name
                ? hosts[0].name
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

  responseTimeout = setTimeout(() => {
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
    } catch (error) {}
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
  let responseTimeout: NodeJS.Timeout;

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
      };
      scheduleSessionCleanup(sessionId);

      res.json({
        status: "success",
        message: "Warpgate verified, SSH connection established",
      });

      if (session.hostId && session.userId) {
        (async () => {
          try {
            const hosts = await SimpleDBOps.select(
              getDb()
                .select()
                .from(sshData)
                .where(
                  and(
                    eq(sshData.id, session.hostId!),
                    eq(sshData.userId, session.userId!),
                  ),
                ),
              "ssh_data",
              session.userId!,
            );

            const hostName =
              hosts.length > 0 && hosts[0].name
                ? hosts[0].name
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

  responseTimeout = setTimeout(() => {
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
  const session = sshSessions[sessionId];
  if (!session || !session.isConnected) {
    return res.status(400).json({ error: "Invalid or disconnected session" });
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
  const isConnected = !!sshSessions[sessionId]?.isConnected;
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
app.post("/ssh/file_manager/ssh/keepalive", (req, res) => {
  const { sessionId } = req.body;

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

  session.lastActive = Date.now();
  scheduleSessionCleanup(sessionId);

  res.json({
    status: "success",
    connected: true,
    message: "Session keepalive successful",
    lastActive: session.lastActive,
  });
});

/**
 * @openapi
 * /ssh/file_manager/ssh/listFiles:
 *   get:
 *     summary: List files in a directory
 *     description: Lists the files and directories in a given path on the remote host.
 *     tags:
 *       - File Manager
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: A list of files and directories.
 *       400:
 *         description: Session ID is required or SSH connection not established.
 *       500:
 *         description: Failed to list files.
 */
app.get("/ssh/file_manager/ssh/listFiles", (req, res) => {
  const sessionId = req.query.sessionId as string;
  const sshConn = sshSessions[sessionId];
  const sshPath = decodeURIComponent((req.query.path as string) || "/");
  const userId = (req as AuthenticatedRequest).userId;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  sshConn.lastActive = Date.now();
  sshConn.activeOperations++;
  const trySFTP = () => {
    try {
      fileLogger.info("Opening SFTP channel", {
        operation: "file_sftp_open",
        sessionId,
        userId,
        path: sshPath,
      });
      sshConn.client.sftp((err, sftp) => {
        if (err) {
          fileLogger.warn(
            `SFTP failed for listFiles, trying fallback: ${err.message}`,
          );
          tryFallbackMethod();
          return;
        }

        sftp.readdir(sshPath, (readdirErr, list) => {
          if (readdirErr) {
            fileLogger.warn(
              `SFTP readdir failed, trying fallback: ${readdirErr.message}`,
            );
            tryFallbackMethod();
            return;
          }

          const symlinks: Array<{ index: number; path: string }> = [];
          const files: Array<{
            name: string;
            type: string;
            size: number | undefined;
            modified: string;
            permissions: string;
            owner: string;
            group: string;
            linkTarget: string | undefined;
            path: string;
            executable: boolean;
          }> = [];

          for (const entry of list) {
            if (entry.filename === "." || entry.filename === "..") continue;

            const attrs = entry.attrs;
            const permissions = modeToPermissions(attrs.mode);
            const isDirectory = attrs.isDirectory();
            const isLink = attrs.isSymbolicLink();

            const fileEntry = {
              name: entry.filename,
              type: isDirectory ? "directory" : isLink ? "link" : "file",
              size: isDirectory ? undefined : attrs.size,
              modified: formatMtime(attrs.mtime),
              permissions,
              owner: String(attrs.uid),
              group: String(attrs.gid),
              linkTarget: undefined as string | undefined,
              path: `${sshPath.endsWith("/") ? sshPath : sshPath + "/"}${entry.filename}`,
              executable:
                !isDirectory && !isLink
                  ? isExecutableFile(permissions, entry.filename)
                  : false,
            };

            if (isLink) {
              symlinks.push({ index: files.length, path: fileEntry.path });
            }

            files.push(fileEntry);
          }

          if (symlinks.length === 0) {
            sshConn.activeOperations--;
            return res.json({ files, path: sshPath });
          }

          let resolved = 0;
          let responded = false;

          const sendResponse = () => {
            if (responded) return;
            responded = true;
            sshConn.activeOperations--;
            res.json({ files, path: sshPath });
          };

          // Timeout: send response even if some readlink callbacks never return
          const readlinkTimeout = setTimeout(sendResponse, 5000);

          for (const link of symlinks) {
            sftp.readlink(link.path, (linkErr, target) => {
              resolved++;
              if (!linkErr && target) {
                files[link.index].linkTarget = target;
              }
              if (resolved === symlinks.length) {
                clearTimeout(readlinkTimeout);
                sendResponse();
              }
            });
          }
        });
      });
    } catch (sftpErr: unknown) {
      const errMsg =
        sftpErr instanceof Error ? sftpErr.message : "Unknown error";
      fileLogger.warn(`SFTP connection error, trying fallback: ${errMsg}`);
      tryFallbackMethod();
    }
  };

  const tryFallbackMethod = () => {
    const escapedPath = sshPath.replace(/'/g, "'\"'\"'");
    sshConn.client.exec(`command ls -la '${escapedPath}'`, (err, stream) => {
      if (err) {
        sshConn.activeOperations--;
        fileLogger.error("SSH listFiles error:", err);
        return res.status(500).json({ error: err.message });
      }

      let data = "";
      let errorData = "";

      stream.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });

      stream.stderr.on("data", (chunk: Buffer) => {
        errorData += chunk.toString();
      });

      stream.on("close", (code) => {
        if (code !== 0) {
          const isPermissionDenied =
            errorData.toLowerCase().includes("permission denied") ||
            errorData.toLowerCase().includes("access denied");

          if (isPermissionDenied) {
            if (sshConn.sudoPassword) {
              fileLogger.info(
                `Permission denied for listFiles, retrying with sudo: ${sshPath}`,
              );
              tryWithSudo();
              return;
            }

            sshConn.activeOperations--;
            fileLogger.warn(
              `Permission denied for listFiles, sudo required: ${sshPath}`,
            );
            return res.status(403).json({
              error: `Permission denied: Cannot access ${sshPath}`,
              needsSudo: true,
              path: sshPath,
            });
          }

          sshConn.activeOperations--;
          fileLogger.error(
            `SSH listFiles command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
          );
          return res
            .status(500)
            .json({ error: `Command failed: ${errorData}` });
        }
        sshConn.activeOperations--;

        const lines = data.split("\n").filter((line) => line.trim());
        const files = [];

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          const parts = line.split(/\s+/);
          if (parts.length >= 9) {
            const permissions = parts[0];
            const owner = parts[2];
            const group = parts[3];
            const size = parseInt(parts[4], 10);

            let dateStr = "";
            const nameStartIndex = 8;

            if (parts[5] && parts[6] && parts[7]) {
              dateStr = `${parts[5]} ${parts[6]} ${parts[7]}`;
            }

            const name = parts.slice(nameStartIndex).join(" ");
            const isDirectory = permissions.startsWith("d");
            const isLink = permissions.startsWith("l");

            if (name === "." || name === "..") continue;

            let actualName = name;
            let linkTarget = undefined;
            if (isLink && name.includes(" -> ")) {
              const linkParts = name.split(" -> ");
              actualName = linkParts[0];
              linkTarget = linkParts[1];
            }

            files.push({
              name: actualName,
              type: isDirectory ? "directory" : isLink ? "link" : "file",
              size: isDirectory ? undefined : size,
              modified: dateStr,
              permissions,
              owner,
              group,
              linkTarget,
              path: `${sshPath.endsWith("/") ? sshPath : sshPath + "/"}${actualName}`,
              executable:
                !isDirectory && !isLink
                  ? isExecutableFile(permissions, actualName)
                  : false,
            });
          }
        }

        res.json({ files, path: sshPath });
      });
    });
  };

  const tryWithSudo = () => {
    const escapedPath = sshPath.replace(/'/g, "'\"'\"'");
    const escapedPassword = sshConn.sudoPassword!.replace(/'/g, "'\"'\"'");
    const sudoCommand = `echo '${escapedPassword}' | sudo -S ls -la '${escapedPath}' 2>&1`;

    sshConn.client.exec(sudoCommand, (err, stream) => {
      if (err) {
        sshConn.activeOperations--;
        fileLogger.error("SSH sudo listFiles error:", err);
        return res.status(500).json({ error: err.message });
      }

      let data = "";
      let errorData = "";

      stream.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });

      stream.stderr.on("data", (chunk: Buffer) => {
        errorData += chunk.toString();
      });

      stream.on("close", (code) => {
        sshConn.activeOperations--;

        data = data.replace(/\[sudo\] password for .+?:\s*/g, "");

        if (
          data.toLowerCase().includes("sorry, try again") ||
          data.toLowerCase().includes("incorrect password") ||
          errorData.toLowerCase().includes("sorry, try again")
        ) {
          sshConn.sudoPassword = undefined;
          return res.status(403).json({
            error: "Sudo authentication failed. Please try again.",
            needsSudo: true,
            sudoFailed: true,
            path: sshPath,
          });
        }

        if (code !== 0 && !data.trim()) {
          fileLogger.error(
            `SSH sudo listFiles failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
          );
          return res
            .status(500)
            .json({ error: `Sudo command failed: ${errorData || data}` });
        }

        const lines = data.split("\n").filter((line) => line.trim());
        const files: Array<{
          name: string;
          type: string;
          size: number | undefined;
          modified: string;
          permissions: string;
          owner: string;
          group: string;
          linkTarget: string | undefined;
          path: string;
          executable: boolean;
        }> = [];

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          const parts = line.split(/\s+/);
          if (parts.length >= 9) {
            const permissions = parts[0];
            const owner = parts[2];
            const group = parts[3];
            const size = parseInt(parts[4], 10);

            let dateStr = "";
            const nameStartIndex = 8;

            if (parts[5] && parts[6] && parts[7]) {
              dateStr = `${parts[5]} ${parts[6]} ${parts[7]}`;
            }

            const name = parts.slice(nameStartIndex).join(" ");
            const isDirectory = permissions.startsWith("d");
            const isLink = permissions.startsWith("l");

            if (name === "." || name === "..") continue;

            let actualName = name;
            let linkTarget = undefined;
            if (isLink && name.includes(" -> ")) {
              const linkParts = name.split(" -> ");
              actualName = linkParts[0];
              linkTarget = linkParts[1];
            }

            files.push({
              name: actualName,
              type: isDirectory ? "directory" : isLink ? "link" : "file",
              size: isDirectory ? undefined : size,
              modified: dateStr,
              permissions,
              owner,
              group,
              linkTarget,
              path: `${sshPath.endsWith("/") ? sshPath : sshPath + "/"}${actualName}`,
              executable:
                !isDirectory && !isLink
                  ? isExecutableFile(permissions, actualName)
                  : false,
            });
          }
        }

        res.json({ files, path: sshPath });
      });
    });
  };

  trySFTP();
});

/**
 * @openapi
 * /ssh/file_manager/ssh/identifySymlink:
 *   get:
 *     summary: Identify symbolic link
 *     description: Identifies the target of a symbolic link.
 *     tags:
 *       - File Manager
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Symbolic link information.
 *       400:
 *         description: Missing required parameters or SSH connection not established.
 *       500:
 *         description: Failed to identify symbolic link.
 */
app.get("/ssh/file_manager/ssh/identifySymlink", (req, res) => {
  const sessionId = req.query.sessionId as string;
  const sshConn = sshSessions[sessionId];
  const linkPath = decodeURIComponent(req.query.path as string);

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!linkPath) {
    return res.status(400).json({ error: "Link path is required" });
  }

  sshConn.lastActive = Date.now();

  const escapedPath = linkPath.replace(/'/g, "'\"'\"'");
  const command = `stat -L -c "%F" '${escapedPath}' && readlink -f '${escapedPath}'`;

  sshConn.client.exec(command, (err, stream) => {
    if (err) {
      fileLogger.error("SSH identifySymlink error:", err);
      return res.status(500).json({ error: err.message });
    }

    let data = "";
    let errorData = "";

    stream.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });

    stream.stderr.on("data", (chunk: Buffer) => {
      errorData += chunk.toString();
    });

    stream.on("close", (code) => {
      if (code !== 0) {
        fileLogger.error(
          `SSH identifySymlink command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
        );
        return res.status(500).json({ error: `Command failed: ${errorData}` });
      }

      const [fileType, target] = data.trim().split("\n");

      res.json({
        path: linkPath,
        target: target,
        type: fileType.toLowerCase().includes("directory")
          ? "directory"
          : "file",
      });
    });

    stream.on("error", (streamErr) => {
      fileLogger.error("SSH identifySymlink stream error:", streamErr);
      if (!res.headersSent) {
        res.status(500).json({ error: `Stream error: ${streamErr.message}` });
      }
    });
  });
});

/**
 * @openapi
 * /ssh/file_manager/ssh/readFile:
 *   get:
 *     summary: Read a file
 *     description: Reads the content of a file from the remote host.
 *     tags:
 *       - File Manager
 *     parameters:
 *       - in: query
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The content of the file.
 *       400:
 *         description: Missing required parameters or file too large.
 *       404:
 *         description: File not found.
 *       500:
 *         description: Failed to read file.
 */
app.get("/ssh/file_manager/ssh/readFile", (req, res) => {
  const sessionId = req.query.sessionId as string;
  const sshConn = sshSessions[sessionId];
  const filePath = decodeURIComponent(req.query.path as string);
  const userId = (req as AuthenticatedRequest).userId;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!filePath) {
    return res.status(400).json({ error: "File path is required" });
  }

  fileLogger.info("Reading file", {
    operation: "file_read",
    sessionId,
    userId,
    path: filePath,
  });
  sshConn.lastActive = Date.now();

  const MAX_READ_SIZE = 500 * 1024 * 1024;
  const escapedPath = filePath.replace(/'/g, "'\"'\"'");

  sshConn.client.exec(
    `stat -c%s '${escapedPath}' 2>/dev/null || wc -c < '${escapedPath}'`,
    (sizeErr, sizeStream) => {
      if (sizeErr) {
        fileLogger.error("SSH file size check error:", sizeErr);
        return res.status(500).json({ error: sizeErr.message });
      }

      let sizeData = "";
      let sizeErrorData = "";

      sizeStream.on("data", (chunk: Buffer) => {
        sizeData += chunk.toString();
      });

      sizeStream.stderr.on("data", (chunk: Buffer) => {
        sizeErrorData += chunk.toString();
      });

      sizeStream.on("close", (sizeCode) => {
        if (sizeCode !== 0) {
          const errorLower = sizeErrorData.toLowerCase();
          const isFileNotFound =
            errorLower.includes("no such file or directory") ||
            errorLower.includes("cannot access") ||
            errorLower.includes("not found") ||
            errorLower.includes("resource not found");

          fileLogger.error(`File size check failed: ${sizeErrorData}`);
          return res.status(isFileNotFound ? 404 : 500).json({
            error: `Cannot check file size: ${sizeErrorData}`,
            fileNotFound: isFileNotFound,
          });
        }

        const fileSize = parseInt(sizeData.trim(), 10);

        if (isNaN(fileSize)) {
          fileLogger.error("Invalid file size response:", sizeData);
          return res.status(500).json({ error: "Cannot determine file size" });
        }

        if (fileSize > MAX_READ_SIZE) {
          fileLogger.warn("File too large for reading", {
            operation: "file_read",
            sessionId,
            filePath,
            fileSize,
            maxSize: MAX_READ_SIZE,
          });
          return res.status(400).json({
            error: `File too large to open in editor. Maximum size is ${MAX_READ_SIZE / 1024 / 1024}MB, file is ${(fileSize / 1024 / 1024).toFixed(2)}MB. Use download instead.`,
            fileSize,
            maxSize: MAX_READ_SIZE,
            tooLarge: true,
          });
        }

        sshConn.client.exec(`cat '${escapedPath}'`, (err, stream) => {
          if (err) {
            fileLogger.error("SSH readFile error:", err);
            return res.status(500).json({ error: err.message });
          }

          let binaryData = Buffer.alloc(0);
          let errorData = "";

          stream.on("data", (chunk: Buffer) => {
            binaryData = Buffer.concat([binaryData, chunk]);
          });

          stream.stderr.on("data", (chunk: Buffer) => {
            errorData += chunk.toString();
          });

          stream.on("close", (code) => {
            if (code !== 0) {
              fileLogger.error(
                `SSH readFile command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
              );

              const isFileNotFound =
                errorData.includes("No such file or directory") ||
                errorData.includes("cannot access") ||
                errorData.includes("not found");

              return res.status(isFileNotFound ? 404 : 500).json({
                error: `Command failed: ${errorData}`,
                fileNotFound: isFileNotFound,
              });
            }

            const isBinary = detectBinary(binaryData);
            fileLogger.success("File read successfully", {
              operation: "file_read_success",
              sessionId,
              userId,
              path: filePath,
              bytes: binaryData.length,
            });

            if (isBinary) {
              const base64Content = binaryData.toString("base64");
              res.json({
                content: base64Content,
                path: filePath,
                encoding: "base64",
              });
            } else {
              const textContent = binaryData.toString("utf8");
              res.json({
                content: textContent,
                path: filePath,
                encoding: "utf8",
              });
            }
          });
        });
      });
    },
  );
});

/**
 * @openapi
 * /ssh/file_manager/ssh/writeFile:
 *   post:
 *     summary: Write to a file
 *     description: Writes content to a file on the remote host.
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
 *               path:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: File written successfully.
 *       400:
 *         description: Missing required parameters or SSH connection not established.
 *       500:
 *         description: Failed to write file.
 */
app.post("/ssh/file_manager/ssh/writeFile", async (req, res) => {
  const { sessionId, path: filePath, content } = req.body;
  const sshConn = sshSessions[sessionId];
  const userId = (req as AuthenticatedRequest).userId;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!filePath) {
    return res.status(400).json({ error: "File path is required" });
  }

  if (content === undefined) {
    return res.status(400).json({ error: "File content is required" });
  }

  const contentLength =
    typeof content === "string" ? content.length : Buffer.byteLength(content);
  fileLogger.info("Writing file", {
    operation: "file_write",
    sessionId,
    userId,
    path: filePath,
    bytes: contentLength,
  });
  sshConn.lastActive = Date.now();

  const trySFTP = () => {
    try {
      fileLogger.info("Opening SFTP channel", {
        operation: "file_sftp_open",
        sessionId,
        userId,
        path: filePath,
      });
      sshConn.client.sftp((err, sftp) => {
        if (err) {
          fileLogger.warn(
            `SFTP failed, trying fallback method: ${err.message}`,
          );
          tryFallbackMethod();
          return;
        }

        let fileBuffer;
        try {
          if (typeof content === "string") {
            try {
              const testBuffer = Buffer.from(content, "base64");
              if (testBuffer.toString("base64") === content) {
                fileBuffer = testBuffer;
              } else {
                fileBuffer = Buffer.from(content, "utf8");
              }
            } catch {
              fileBuffer = Buffer.from(content, "utf8");
            }
          } else if (Buffer.isBuffer(content)) {
            fileBuffer = content;
          } else {
            fileBuffer = Buffer.from(content);
          }
        } catch (bufferErr) {
          fileLogger.error("Buffer conversion error:", bufferErr);
          if (!res.headersSent) {
            return res
              .status(500)
              .json({ error: "Invalid file content format" });
          }
          return;
        }

        const writeStream = sftp.createWriteStream(filePath);

        let hasError = false;
        let hasFinished = false;

        writeStream.on("error", (streamErr) => {
          if (hasError || hasFinished) return;
          hasError = true;
          fileLogger.warn(
            `SFTP write failed, trying fallback method: ${streamErr.message}`,
          );
          tryFallbackMethod();
        });

        writeStream.on("finish", () => {
          if (hasError || hasFinished) return;
          hasFinished = true;
          fileLogger.success("File written successfully", {
            operation: "file_write_success",
            sessionId,
            userId,
            path: filePath,
            bytes: fileBuffer.length,
          });
          if (!res.headersSent) {
            res.json({
              message: "File written successfully",
              path: filePath,
              toast: { type: "success", message: `File written: ${filePath}` },
            });
          }
        });

        writeStream.on("close", () => {
          if (hasError || hasFinished) return;
          hasFinished = true;
          fileLogger.success("File written successfully", {
            operation: "file_write_success",
            sessionId,
            userId,
            path: filePath,
            bytes: fileBuffer.length,
          });
          if (!res.headersSent) {
            res.json({
              message: "File written successfully",
              path: filePath,
              toast: { type: "success", message: `File written: ${filePath}` },
            });
          }
        });

        try {
          writeStream.write(fileBuffer);
          writeStream.end();
        } catch (writeErr) {
          if (hasError || hasFinished) return;
          hasError = true;
          fileLogger.warn(
            `SFTP write operation failed, trying fallback method: ${writeErr.message}`,
          );
          tryFallbackMethod();
        }
      });
    } catch (sftpErr) {
      fileLogger.warn(
        `SFTP connection error, trying fallback method: ${sftpErr.message}`,
      );
      tryFallbackMethod();
    }
  };

  const tryFallbackMethod = () => {
    try {
      let contentBuffer: Buffer;
      if (typeof content === "string") {
        try {
          contentBuffer = Buffer.from(content, "base64");
          if (contentBuffer.toString("base64") !== content) {
            contentBuffer = Buffer.from(content, "utf8");
          }
        } catch {
          contentBuffer = Buffer.from(content, "utf8");
        }
      } else if (Buffer.isBuffer(content)) {
        contentBuffer = content;
      } else {
        contentBuffer = Buffer.from(content);
      }
      const base64Content = contentBuffer.toString("base64");
      const escapedPath = filePath.replace(/'/g, "'\"'\"'");

      const writeCommand = `echo '${base64Content}' | base64 -d > '${escapedPath}' && echo "SUCCESS"`;

      sshConn.client.exec(writeCommand, (err, stream) => {
        if (err) {
          fileLogger.error("Fallback write command failed:", err);
          if (!res.headersSent) {
            return res.status(500).json({
              error: `Write failed: ${err.message}`,
              toast: {
                type: "error",
                message: `Write failed: ${err.message}`,
              },
            });
          }
          return;
        }

        let outputData = "";
        let errorData = "";

        stream.on("data", (chunk: Buffer) => {
          outputData += chunk.toString();
        });

        stream.stderr.on("data", (chunk: Buffer) => {
          errorData += chunk.toString();
        });

        stream.on("close", (code) => {
          if (outputData.includes("SUCCESS")) {
            if (!res.headersSent) {
              res.json({
                message: "File written successfully",
                path: filePath,
                toast: {
                  type: "success",
                  message: `File written: ${filePath}`,
                },
              });
            }
          } else {
            fileLogger.error(
              `Fallback write failed with code ${code}: ${errorData}`,
            );
            if (!res.headersSent) {
              res.status(500).json({
                error: `Write failed: ${errorData}`,
                toast: { type: "error", message: `Write failed: ${errorData}` },
              });
            }
          }
        });

        stream.on("error", (streamErr) => {
          fileLogger.error("Fallback write stream error:", streamErr);
          if (!res.headersSent) {
            res
              .status(500)
              .json({ error: `Write stream error: ${streamErr.message}` });
          }
        });
      });
    } catch (fallbackErr) {
      fileLogger.error("Fallback method failed:", fallbackErr);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: `All write methods failed: ${fallbackErr.message}` });
      }
    }
  };

  trySFTP();
});

/**
 * @openapi
 * /ssh/file_manager/ssh/uploadFile:
 *   post:
 *     summary: Upload a file
 *     description: Uploads a file to the remote host.
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
 *               path:
 *                 type: string
 *               content:
 *                 type: string
 *               fileName:
 *                 type: string
 *     responses:
 *       200:
 *         description: File uploaded successfully.
 *       400:
 *         description: Missing required parameters or SSH connection not established.
 *       500:
 *         description: Failed to upload file.
 */
app.post("/ssh/file_manager/ssh/uploadFile", async (req, res) => {
  const { sessionId, path: filePath, content, fileName } = req.body;
  const sshConn = sshSessions[sessionId];
  const userId = (req as AuthenticatedRequest).userId;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!filePath || !fileName || content === undefined) {
    return res
      .status(400)
      .json({ error: "File path, name, and content are required" });
  }

  sshConn.lastActive = Date.now();

  const contentSize =
    typeof content === "string"
      ? Buffer.byteLength(content, "utf8")
      : content.length;

  const fullPath = filePath.endsWith("/")
    ? filePath + fileName
    : filePath + "/" + fileName;
  const uploadStartTime = Date.now();
  fileLogger.info("File upload started", {
    operation: "file_upload_start",
    sessionId,
    userId,
    path: fullPath,
    bytes: contentSize,
  });

  const trySFTP = () => {
    try {
      fileLogger.info("Opening SFTP channel", {
        operation: "file_sftp_open",
        sessionId,
        userId,
        path: fullPath,
      });
      sshConn.client.sftp((err, sftp) => {
        if (err) {
          fileLogger.warn(
            `SFTP failed, trying fallback method: ${err.message}`,
          );
          tryFallbackMethod();
          return;
        }

        let fileBuffer;
        try {
          if (typeof content === "string") {
            fileBuffer = Buffer.from(content, "base64");
          } else if (Buffer.isBuffer(content)) {
            fileBuffer = content;
          } else {
            fileBuffer = Buffer.from(content);
          }
        } catch (bufferErr) {
          fileLogger.error("Buffer conversion error:", bufferErr);
          if (!res.headersSent) {
            return res
              .status(500)
              .json({ error: "Invalid file content format" });
          }
          return;
        }

        const writeStream = sftp.createWriteStream(fullPath);

        let hasError = false;
        let hasFinished = false;

        writeStream.on("error", (streamErr) => {
          if (hasError || hasFinished) return;
          hasError = true;
          fileLogger.warn(
            `SFTP write failed, trying fallback method: ${streamErr.message}`,
            {
              operation: "file_upload",
              sessionId,
              fileName,
              fileSize: contentSize,
              error: streamErr.message,
            },
          );
          tryFallbackMethod();
        });

        writeStream.on("finish", () => {
          if (hasError || hasFinished) return;
          hasFinished = true;
          fileLogger.success("File upload completed", {
            operation: "file_upload_complete",
            sessionId,
            userId,
            path: fullPath,
            bytes: fileBuffer.length,
            duration: Date.now() - uploadStartTime,
          });
          if (!res.headersSent) {
            res.json({
              message: "File uploaded successfully",
              path: fullPath,
              toast: { type: "success", message: `File uploaded: ${fullPath}` },
            });
          }
        });

        writeStream.on("close", () => {
          if (hasError || hasFinished) return;
          hasFinished = true;
          fileLogger.success("File upload completed", {
            operation: "file_upload_complete",
            sessionId,
            userId,
            path: fullPath,
            bytes: fileBuffer.length,
            duration: Date.now() - uploadStartTime,
          });
          if (!res.headersSent) {
            res.json({
              message: "File uploaded successfully",
              path: fullPath,
              toast: { type: "success", message: `File uploaded: ${fullPath}` },
            });
          }
        });

        try {
          writeStream.write(fileBuffer);
          writeStream.end();
        } catch (writeErr) {
          if (hasError || hasFinished) return;
          hasError = true;
          fileLogger.warn(
            `SFTP write operation failed, trying fallback method: ${writeErr.message}`,
          );
          tryFallbackMethod();
        }
      });
    } catch (sftpErr) {
      fileLogger.warn(
        `SFTP connection error, trying fallback method: ${sftpErr.message}`,
      );
      tryFallbackMethod();
    }
  };

  const tryFallbackMethod = () => {
    try {
      let contentBuffer: Buffer;
      if (typeof content === "string") {
        try {
          contentBuffer = Buffer.from(content, "base64");
          if (contentBuffer.toString("base64") !== content) {
            contentBuffer = Buffer.from(content, "utf8");
          }
        } catch {
          contentBuffer = Buffer.from(content, "utf8");
        }
      } else if (Buffer.isBuffer(content)) {
        contentBuffer = content;
      } else {
        contentBuffer = Buffer.from(content);
      }
      const base64Content = contentBuffer.toString("base64");
      const chunkSize = 1000000;
      const chunks = [];

      for (let i = 0; i < base64Content.length; i += chunkSize) {
        chunks.push(base64Content.slice(i, i + chunkSize));
      }

      if (chunks.length === 1) {
        const escapedPath = fullPath.replace(/'/g, "'\"'\"'");

        const writeCommand = `echo '${chunks[0]}' | base64 -d > '${escapedPath}' && echo "SUCCESS"`;

        sshConn.client.exec(writeCommand, (err, stream) => {
          if (err) {
            fileLogger.error("Fallback upload command failed:", err);
            if (!res.headersSent) {
              return res
                .status(500)
                .json({ error: `Upload failed: ${err.message}` });
            }
            return;
          }

          let outputData = "";
          let errorData = "";

          stream.on("data", (chunk: Buffer) => {
            outputData += chunk.toString();
          });

          stream.stderr.on("data", (chunk: Buffer) => {
            errorData += chunk.toString();
          });

          stream.on("close", (code) => {
            if (outputData.includes("SUCCESS")) {
              if (!res.headersSent) {
                res.json({
                  message: "File uploaded successfully",
                  path: fullPath,
                  toast: {
                    type: "success",
                    message: `File uploaded: ${fullPath}`,
                  },
                });
              }
            } else {
              fileLogger.error(
                `Fallback upload failed with code ${code}: ${errorData}`,
              );
              if (!res.headersSent) {
                res.status(500).json({
                  error: `Upload failed: ${errorData}`,
                  toast: {
                    type: "error",
                    message: `Upload failed: ${errorData}`,
                  },
                });
              }
            }
          });

          stream.on("error", (streamErr) => {
            fileLogger.error("Fallback upload stream error:", streamErr);
            if (!res.headersSent) {
              res
                .status(500)
                .json({ error: `Upload stream error: ${streamErr.message}` });
            }
          });
        });
      } else {
        const escapedPath = fullPath.replace(/'/g, "'\"'\"'");

        let writeCommand = `> '${escapedPath}'`;

        chunks.forEach((chunk) => {
          writeCommand += ` && echo '${chunk}' | base64 -d >> '${escapedPath}'`;
        });

        writeCommand += ` && echo "SUCCESS"`;

        sshConn.client.exec(writeCommand, (err, stream) => {
          if (err) {
            fileLogger.error("Chunked fallback upload failed:", err);
            if (!res.headersSent) {
              return res
                .status(500)
                .json({ error: `Chunked upload failed: ${err.message}` });
            }
            return;
          }

          let outputData = "";
          let errorData = "";

          stream.on("data", (chunk: Buffer) => {
            outputData += chunk.toString();
          });

          stream.stderr.on("data", (chunk: Buffer) => {
            errorData += chunk.toString();
          });

          stream.on("close", (code) => {
            if (outputData.includes("SUCCESS")) {
              if (!res.headersSent) {
                res.json({
                  message: "File uploaded successfully",
                  path: fullPath,
                  toast: {
                    type: "success",
                    message: `File uploaded: ${fullPath}`,
                  },
                });
              }
            } else {
              fileLogger.error(
                `Chunked fallback upload failed with code ${code}: ${errorData}`,
              );
              if (!res.headersSent) {
                res.status(500).json({
                  error: `Chunked upload failed: ${errorData}`,
                  toast: {
                    type: "error",
                    message: `Chunked upload failed: ${errorData}`,
                  },
                });
              }
            }
          });

          stream.on("error", (streamErr) => {
            fileLogger.error(
              "Chunked fallback upload stream error:",
              streamErr,
            );
            if (!res.headersSent) {
              res.status(500).json({
                error: `Chunked upload stream error: ${streamErr.message}`,
              });
            }
          });
        });
      }
    } catch (fallbackErr) {
      fileLogger.error("Fallback method failed:", fallbackErr);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: `All upload methods failed: ${fallbackErr.message}` });
      }
    }
  };

  trySFTP();
});

/**
 * @openapi
 * /ssh/file_manager/ssh/createFile:
 *   post:
 *     summary: Create a file
 *     description: Creates an empty file on the remote host.
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
 *               path:
 *                 type: string
 *               fileName:
 *                 type: string
 *     responses:
 *       200:
 *         description: File created successfully.
 *       400:
 *         description: Missing required parameters or SSH connection not established.
 *       403:
 *         description: Permission denied.
 *       500:
 *         description: Failed to create file.
 */
app.post("/ssh/file_manager/ssh/createFile", async (req, res) => {
  const { sessionId, path: filePath, fileName } = req.body;
  const sshConn = sshSessions[sessionId];

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!filePath || !fileName) {
    return res.status(400).json({ error: "File path and name are required" });
  }

  sshConn.lastActive = Date.now();

  const fullPath = filePath.endsWith("/")
    ? filePath + fileName
    : filePath + "/" + fileName;
  const escapedPath = fullPath.replace(/'/g, "'\"'\"'");

  const createCommand = `touch '${escapedPath}' && echo "SUCCESS" && exit 0`;

  sshConn.client.exec(createCommand, (err, stream) => {
    if (err) {
      fileLogger.error("SSH createFile error:", err);
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message });
      }
      return;
    }

    let outputData = "";
    let errorData = "";

    stream.on("data", (chunk: Buffer) => {
      outputData += chunk.toString();
    });

    stream.stderr.on("data", (chunk: Buffer) => {
      errorData += chunk.toString();

      if (chunk.toString().includes("Permission denied")) {
        fileLogger.error(`Permission denied creating file: ${fullPath}`);
        if (!res.headersSent) {
          return res.status(403).json({
            error: `Permission denied: Cannot create file ${fullPath}. Check directory permissions.`,
          });
        }
        return;
      }
    });

    stream.on("close", (code) => {
      if (outputData.includes("SUCCESS")) {
        if (!res.headersSent) {
          res.json({
            message: "File created successfully",
            path: fullPath,
            toast: { type: "success", message: `File created: ${fullPath}` },
          });
        }
        return;
      }

      if (code !== 0) {
        fileLogger.error(
          `SSH createFile command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
        );
        if (!res.headersSent) {
          return res.status(500).json({
            error: `Command failed: ${errorData}`,
            toast: {
              type: "error",
              message: `File creation failed: ${errorData}`,
            },
          });
        }
        return;
      }

      if (!res.headersSent) {
        res.json({
          message: "File created successfully",
          path: fullPath,
          toast: { type: "success", message: `File created: ${fullPath}` },
        });
      }
    });

    stream.on("error", (streamErr) => {
      fileLogger.error("SSH createFile stream error:", streamErr);
      if (!res.headersSent) {
        res.status(500).json({ error: `Stream error: ${streamErr.message}` });
      }
    });
  });
});

/**
 * @openapi
 * /ssh/file_manager/ssh/createFolder:
 *   post:
 *     summary: Create a folder
 *     description: Creates a new folder on the remote host.
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
 *               path:
 *                 type: string
 *               folderName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Folder created successfully.
 *       400:
 *         description: Missing required parameters or SSH connection not established.
 *       403:
 *         description: Permission denied.
 *       500:
 *         description: Failed to create folder.
 */
app.post("/ssh/file_manager/ssh/createFolder", async (req, res) => {
  const { sessionId, path: folderPath, folderName } = req.body;
  const sshConn = sshSessions[sessionId];
  const userId = (req as AuthenticatedRequest).userId;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!folderPath || !folderName) {
    return res.status(400).json({ error: "Folder path and name are required" });
  }

  sshConn.lastActive = Date.now();

  const fullPath = folderPath.endsWith("/")
    ? folderPath + folderName
    : folderPath + "/" + folderName;
  fileLogger.info("Creating directory", {
    operation: "file_mkdir",
    sessionId,
    userId,
    path: fullPath,
  });
  const escapedPath = fullPath.replace(/'/g, "'\"'\"'");

  const createCommand = `mkdir -p '${escapedPath}' && echo "SUCCESS" && exit 0`;

  sshConn.client.exec(createCommand, (err, stream) => {
    if (err) {
      fileLogger.error("SSH createFolder error:", err);
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message });
      }
      return;
    }

    let outputData = "";
    let errorData = "";

    stream.on("data", (chunk: Buffer) => {
      outputData += chunk.toString();
    });

    stream.stderr.on("data", (chunk: Buffer) => {
      errorData += chunk.toString();

      if (chunk.toString().includes("Permission denied")) {
        fileLogger.error(`Permission denied creating folder: ${fullPath}`);
        if (!res.headersSent) {
          return res.status(403).json({
            error: `Permission denied: Cannot create folder ${fullPath}. Check directory permissions.`,
          });
        }
        return;
      }
    });

    stream.on("close", (code) => {
      if (outputData.includes("SUCCESS")) {
        fileLogger.success("Directory created successfully", {
          operation: "file_mkdir_success",
          sessionId,
          userId,
          path: fullPath,
        });
        if (!res.headersSent) {
          res.json({
            message: "Folder created successfully",
            path: fullPath,
            toast: { type: "success", message: `Folder created: ${fullPath}` },
          });
        }
        return;
      }

      if (code !== 0) {
        fileLogger.error(
          `SSH createFolder command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
        );
        if (!res.headersSent) {
          return res.status(500).json({
            error: `Command failed: ${errorData}`,
            toast: {
              type: "error",
              message: `Folder creation failed: ${errorData}`,
            },
          });
        }
        return;
      }

      fileLogger.success("Directory created successfully", {
        operation: "file_mkdir_success",
        sessionId,
        userId,
        path: fullPath,
      });
      if (!res.headersSent) {
        res.json({
          message: "Folder created successfully",
          path: fullPath,
          toast: { type: "success", message: `Folder created: ${fullPath}` },
        });
      }
    });

    stream.on("error", (streamErr) => {
      fileLogger.error("SSH createFolder stream error:", streamErr);
      if (!res.headersSent) {
        res.status(500).json({ error: `Stream error: ${streamErr.message}` });
      }
    });
  });
});

/**
 * @openapi
 * /ssh/file_manager/ssh/deleteItem:
 *   delete:
 *     summary: Delete a file or directory
 *     description: Deletes a file or directory on the remote host.
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
 *               path:
 *                 type: string
 *               isDirectory:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Item deleted successfully.
 *       400:
 *         description: Missing required parameters or SSH connection not established.
 *       403:
 *         description: Permission denied.
 *       500:
 *         description: Failed to delete item.
 */
app.delete("/ssh/file_manager/ssh/deleteItem", async (req, res) => {
  const { sessionId, path: itemPath, isDirectory } = req.body;
  const sshConn = sshSessions[sessionId];
  const userId = (req as AuthenticatedRequest).userId;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!itemPath) {
    return res.status(400).json({ error: "Item path is required" });
  }

  fileLogger.info("Deleting item", {
    operation: "file_delete",
    sessionId,
    userId,
    path: itemPath,
    type: isDirectory ? "directory" : "file",
  });
  sshConn.lastActive = Date.now();
  const escapedPath = itemPath.replace(/'/g, "'\"'\"'");

  const deleteCommand = isDirectory
    ? `rm -rf '${escapedPath}'`
    : `rm -f '${escapedPath}'`;

  const executeDelete = (useSudo: boolean): Promise<void> => {
    return new Promise((resolve) => {
      if (useSudo && sshConn.sudoPassword) {
        execWithSudo(sshConn.client, deleteCommand, sshConn.sudoPassword).then(
          (result) => {
            if (
              result.code === 0 ||
              (!result.stderr.includes("Permission denied") &&
                !result.stdout.includes("Permission denied"))
            ) {
              res.json({
                message: "Item deleted successfully",
                path: itemPath,
                toast: {
                  type: "success",
                  message: `${isDirectory ? "Directory" : "File"} deleted: ${itemPath}`,
                },
              });
            } else {
              res.status(500).json({
                error: `Delete failed: ${result.stderr || result.stdout}`,
              });
            }
            resolve();
          },
        );
        return;
      }

      sshConn.client.exec(
        `${deleteCommand} && echo "SUCCESS"`,
        (err, stream) => {
          if (err) {
            fileLogger.error("SSH deleteItem error:", err);
            res.status(500).json({ error: err.message });
            resolve();
            return;
          }

          let outputData = "";
          let errorData = "";
          let permissionDenied = false;

          stream.on("data", (chunk: Buffer) => {
            outputData += chunk.toString();
          });

          stream.stderr.on("data", (chunk: Buffer) => {
            errorData += chunk.toString();
            if (chunk.toString().includes("Permission denied")) {
              permissionDenied = true;
            }
          });

          stream.on("close", (code) => {
            if (permissionDenied) {
              if (sshConn.sudoPassword) {
                executeDelete(true).then(resolve);
                return;
              }
              fileLogger.error(`Permission denied deleting: ${itemPath}`);
              res.status(403).json({
                error: `Permission denied: Cannot delete ${itemPath}.`,
                needsSudo: true,
              });
              resolve();
              return;
            }

            if (outputData.includes("SUCCESS") || code === 0) {
              fileLogger.success("Item deleted successfully", {
                operation: "file_delete_success",
                sessionId,
                userId,
                path: itemPath,
              });
              res.json({
                message: "Item deleted successfully",
                path: itemPath,
                toast: {
                  type: "success",
                  message: `${isDirectory ? "Directory" : "File"} deleted: ${itemPath}`,
                },
              });
            } else {
              res.status(500).json({
                error: `Command failed: ${errorData}`,
              });
            }
            resolve();
          });

          stream.on("error", (streamErr) => {
            fileLogger.error("SSH deleteItem stream error:", streamErr);
            res
              .status(500)
              .json({ error: `Stream error: ${streamErr.message}` });
            resolve();
          });
        },
      );
    });
  };

  await executeDelete(false);
});

/**
 * @openapi
 * /ssh/file_manager/ssh/renameItem:
 *   put:
 *     summary: Rename a file or directory
 *     description: Renames a file or directory on the remote host.
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
 *               oldPath:
 *                 type: string
 *               newName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Item renamed successfully.
 *       400:
 *         description: Missing required parameters or SSH connection not established.
 *       403:
 *         description: Permission denied.
 *       500:
 *         description: Failed to rename item.
 */
app.put("/ssh/file_manager/ssh/renameItem", async (req, res) => {
  const { sessionId, oldPath, newName } = req.body;
  const sshConn = sshSessions[sessionId];
  const userId = (req as AuthenticatedRequest).userId;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!oldPath || !newName) {
    return res
      .status(400)
      .json({ error: "Old path and new name are required" });
  }

  sshConn.lastActive = Date.now();

  const oldDir = oldPath.substring(0, oldPath.lastIndexOf("/") + 1);
  const newPath = oldDir + newName;
  fileLogger.info("Renaming item", {
    operation: "file_rename",
    sessionId,
    userId,
    from: oldPath,
    to: newPath,
  });
  const escapedOldPath = oldPath.replace(/'/g, "'\"'\"'");
  const escapedNewPath = newPath.replace(/'/g, "'\"'\"'");

  const renameCommand = `mv '${escapedOldPath}' '${escapedNewPath}' && echo "SUCCESS" && exit 0`;

  sshConn.client.exec(renameCommand, (err, stream) => {
    if (err) {
      fileLogger.error("SSH renameItem error:", err);
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message });
      }
      return;
    }

    let outputData = "";
    let errorData = "";

    stream.on("data", (chunk: Buffer) => {
      outputData += chunk.toString();
    });

    stream.stderr.on("data", (chunk: Buffer) => {
      errorData += chunk.toString();

      if (chunk.toString().includes("Permission denied")) {
        fileLogger.error(`Permission denied renaming: ${oldPath}`);
        if (!res.headersSent) {
          return res.status(403).json({
            error: `Permission denied: Cannot rename ${oldPath}. Check file permissions.`,
          });
        }
        return;
      }
    });

    stream.on("close", (code) => {
      if (outputData.includes("SUCCESS")) {
        fileLogger.success("Item renamed successfully", {
          operation: "file_rename_success",
          sessionId,
          userId,
          from: oldPath,
          to: newPath,
        });
        if (!res.headersSent) {
          res.json({
            message: "Item renamed successfully",
            oldPath,
            newPath,
            toast: {
              type: "success",
              message: `Item renamed: ${oldPath} -> ${newPath}`,
            },
          });
        }
        return;
      }

      if (code !== 0) {
        fileLogger.error(
          `SSH renameItem command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
        );
        if (!res.headersSent) {
          return res.status(500).json({
            error: `Command failed: ${errorData}`,
            toast: { type: "error", message: `Rename failed: ${errorData}` },
          });
        }
        return;
      }

      fileLogger.success("Item renamed successfully", {
        operation: "file_rename_success",
        sessionId,
        userId,
        from: oldPath,
        to: newPath,
      });
      if (!res.headersSent) {
        res.json({
          message: "Item renamed successfully",
          oldPath,
          newPath,
          toast: {
            type: "success",
            message: `Item renamed: ${oldPath} -> ${newPath}`,
          },
        });
      }
    });

    stream.on("error", (streamErr) => {
      fileLogger.error("SSH renameItem stream error:", streamErr);
      if (!res.headersSent) {
        res.status(500).json({ error: `Stream error: ${streamErr.message}` });
      }
    });
  });
});

/**
 * @openapi
 * /ssh/file_manager/ssh/moveItem:
 *   put:
 *     summary: Move a file or directory
 *     description: Moves a file or directory on the remote host.
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
 *               oldPath:
 *                 type: string
 *               newPath:
 *                 type: string
 *     responses:
 *       200:
 *         description: Item moved successfully.
 *       400:
 *         description: Missing required parameters or SSH connection not established.
 *       403:
 *         description: Permission denied.
 *       408:
 *         description: Move operation timed out.
 *       500:
 *         description: Failed to move item.
 */
app.put("/ssh/file_manager/ssh/moveItem", async (req, res) => {
  const { sessionId, oldPath, newPath } = req.body;
  const sshConn = sshSessions[sessionId];

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  if (!sshConn?.isConnected) {
    return res.status(400).json({ error: "SSH connection not established" });
  }

  if (!oldPath || !newPath) {
    return res
      .status(400)
      .json({ error: "Old path and new path are required" });
  }

  sshConn.lastActive = Date.now();

  const escapedOldPath = oldPath.replace(/'/g, "'\"'\"'");
  const escapedNewPath = newPath.replace(/'/g, "'\"'\"'");

  const moveCommand = `mv '${escapedOldPath}' '${escapedNewPath}' && echo "SUCCESS" && exit 0`;

  const commandTimeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).json({
        error: "Move operation timed out. SSH connection may be unstable.",
        toast: {
          type: "error",
          message: "Move operation timed out. SSH connection may be unstable.",
        },
      });
    }
  }, 60000);

  sshConn.client.exec(moveCommand, (err, stream) => {
    if (err) {
      clearTimeout(commandTimeout);
      fileLogger.error("SSH moveItem error:", err);
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message });
      }
      return;
    }

    let outputData = "";
    let errorData = "";

    stream.on("data", (chunk: Buffer) => {
      outputData += chunk.toString();
    });

    stream.stderr.on("data", (chunk: Buffer) => {
      errorData += chunk.toString();

      if (chunk.toString().includes("Permission denied")) {
        fileLogger.error(`Permission denied moving: ${oldPath}`);
        if (!res.headersSent) {
          return res.status(403).json({
            error: `Permission denied: Cannot move ${oldPath}. Check file permissions.`,
            toast: {
              type: "error",
              message: `Permission denied: Cannot move ${oldPath}. Check file permissions.`,
            },
          });
        }
        return;
      }
    });

    stream.on("close", (code) => {
      clearTimeout(commandTimeout);
      if (outputData.includes("SUCCESS")) {
        if (!res.headersSent) {
          res.json({
            message: "Item moved successfully",
            oldPath,
            newPath,
            toast: {
              type: "success",
              message: `Item moved: ${oldPath} -> ${newPath}`,
            },
          });
        }
        return;
      }

      if (code !== 0) {
        fileLogger.error(
          `SSH moveItem command failed with code ${code}: ${errorData.replace(/\n/g, " ").trim()}`,
        );
        if (!res.headersSent) {
          return res.status(500).json({
            error: `Command failed: ${errorData}`,
            toast: { type: "error", message: `Move failed: ${errorData}` },
          });
        }
        return;
      }

      if (!res.headersSent) {
        res.json({
          message: "Item moved successfully",
          oldPath,
          newPath,
          toast: {
            type: "success",
            message: `Item moved: ${oldPath} -> ${newPath}`,
          },
        });
      }
    });

    stream.on("error", (streamErr) => {
      clearTimeout(commandTimeout);
      fileLogger.error("SSH moveItem stream error:", streamErr);
      if (!res.headersSent) {
        res.status(500).json({ error: `Stream error: ${streamErr.message}` });
      }
    });
  });
});

/**
 * @openapi
 * /ssh/file_manager/ssh/downloadFile:
 *   post:
 *     summary: Download a file
 *     description: Downloads a file from the remote host.
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
 *               path:
 *                 type: string
 *               hostId:
 *                 type: integer
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: The file content.
 *       400:
 *         description: Missing required parameters or file too large.
 *       500:
 *         description: Failed to download file.
 */
app.post("/ssh/file_manager/ssh/downloadFile", async (req, res) => {
  const { sessionId, path: filePath, hostId, userId } = req.body;
  const downloadStartTime = Date.now();

  if (!sessionId || !filePath) {
    fileLogger.warn("Missing download parameters", {
      operation: "file_download",
      sessionId,
      hasFilePath: !!filePath,
    });
    return res.status(400).json({ error: "Missing download parameters" });
  }

  fileLogger.info("File download started", {
    operation: "file_download_start",
    sessionId,
    userId,
    path: filePath,
  });

  const sshConn = sshSessions[sessionId];
  if (!sshConn || !sshConn.isConnected) {
    fileLogger.warn("SSH session not found or not connected for download", {
      operation: "file_download",
      sessionId,
      isConnected: sshConn?.isConnected,
    });
    return res
      .status(400)
      .json({ error: "SSH session not found or not connected" });
  }

  sshConn.lastActive = Date.now();
  scheduleSessionCleanup(sessionId);
  fileLogger.info("Opening SFTP channel", {
    operation: "file_sftp_open",
    sessionId,
    userId,
    path: filePath,
  });

  sshConn.client.sftp((err, sftp) => {
    if (err) {
      fileLogger.error("SFTP connection failed for download:", err);
      return res.status(500).json({ error: "SFTP connection failed" });
    }

    sftp.stat(filePath, (statErr, stats) => {
      if (statErr) {
        fileLogger.error("File stat failed for download:", statErr);
        return res
          .status(500)
          .json({ error: `Cannot access file: ${statErr.message}` });
      }

      if (!stats.isFile()) {
        fileLogger.warn("Attempted to download non-file", {
          operation: "file_download",
          sessionId,
          filePath,
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
        });
        return res
          .status(400)
          .json({ error: "Cannot download directories or special files" });
      }

      const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;
      if (stats.size > MAX_FILE_SIZE) {
        fileLogger.warn("File too large for download", {
          operation: "file_download",
          sessionId,
          filePath,
          fileSize: stats.size,
          maxSize: MAX_FILE_SIZE,
        });
        return res.status(400).json({
          error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB, file is ${(stats.size / 1024 / 1024).toFixed(2)}MB`,
        });
      }

      sftp.readFile(filePath, (readErr, data) => {
        if (readErr) {
          fileLogger.error("File read failed for download:", readErr);
          return res
            .status(500)
            .json({ error: `Failed to read file: ${readErr.message}` });
        }

        const base64Content = data.toString("base64");
        const fileName = filePath.split("/").pop() || "download";
        fileLogger.success("File download completed", {
          operation: "file_download_complete",
          sessionId,
          userId,
          hostId,
          path: filePath,
          bytes: stats.size,
          duration: Date.now() - downloadStartTime,
        });

        res.json({
          content: base64Content,
          fileName: fileName,
          size: stats.size,
          mimeType: getMimeType(fileName),
          path: filePath,
        });
      });
    });
  });
});

/**
 * @openapi
 * /ssh/file_manager/ssh/copyItem:
 *   post:
 *     summary: Copy a file or directory
 *     description: Copies a file or directory on the remote host.
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
 *               sourcePath:
 *                 type: string
 *               targetDir:
 *                 type: string
 *               hostId:
 *                 type: integer
 *               userId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Item copied successfully.
 *       400:
 *         description: Missing required parameters or SSH connection not established.
 *       500:
 *         description: Failed to copy item.
 */
app.post("/ssh/file_manager/ssh/copyItem", async (req, res) => {
  const { sessionId, sourcePath, targetDir, hostId, userId } = req.body;

  if (!sessionId || !sourcePath || !targetDir) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  const sshConn = sshSessions[sessionId];
  if (!sshConn || !sshConn.isConnected) {
    return res
      .status(400)
      .json({ error: "SSH session not found or not connected" });
  }

  sshConn.lastActive = Date.now();
  scheduleSessionCleanup(sessionId);

  const sourceName = sourcePath.split("/").pop() || "copied_item";

  const timestamp = Date.now().toString().slice(-8);
  const uniqueName = `${sourceName}_copy_${timestamp}`;
  const targetPath = `${targetDir}/${uniqueName}`;

  const escapedSource = sourcePath.replace(/'/g, "'\"'\"'");
  const escapedTarget = targetPath.replace(/'/g, "'\"'\"'");

  const copyCommand = `cp '${escapedSource}' '${escapedTarget}' && echo "COPY_SUCCESS"`;

  const commandTimeout = setTimeout(() => {
    fileLogger.error("Copy command timed out after 60 seconds", {
      sourcePath,
      targetPath,
      command: copyCommand,
    });
    if (!res.headersSent) {
      res.status(500).json({
        error: "Copy operation timed out",
        toast: {
          type: "error",
          message: "Copy operation timed out. SSH connection may be unstable.",
        },
      });
    }
  }, 60000);

  sshConn.client.exec(copyCommand, (err, stream) => {
    if (err) {
      clearTimeout(commandTimeout);
      fileLogger.error("SSH copyItem error:", err);
      if (!res.headersSent) {
        return res.status(500).json({ error: err.message });
      }
      return;
    }

    let errorData = "";
    let stdoutData = "";

    stream.on("data", (data: Buffer) => {
      const output = data.toString();
      stdoutData += output;
      stream.stderr.on("data", (data: Buffer) => {
        const output = data.toString();
        errorData += output;
      });

      stream.on("close", (code) => {
        clearTimeout(commandTimeout);

        if (code !== 0) {
          const fullErrorInfo =
            errorData || stdoutData || "No error message available";
          fileLogger.error(`SSH copyItem command failed with code ${code}`, {
            operation: "file_copy_failed",
            sessionId,
            sourcePath,
            targetPath,
            command: copyCommand,
            exitCode: code,
            errorData,
            stdoutData,
            fullErrorInfo,
          });
          if (!res.headersSent) {
            return res.status(500).json({
              error: `Copy failed: ${fullErrorInfo}`,
              toast: {
                type: "error",
                message: `Copy failed: ${fullErrorInfo}`,
              },
              debug: {
                sourcePath,
                targetPath,
                exitCode: code,
                command: copyCommand,
              },
            });
          }
          return;
        }

        const copySuccessful =
          stdoutData.includes("COPY_SUCCESS") || code === 0;

        if (copySuccessful) {
          fileLogger.success("Item copied successfully", {
            operation: "file_copy",
            sessionId,
            sourcePath,
            targetPath,
            uniqueName,
            hostId,
            userId,
          });

          if (!res.headersSent) {
            res.json({
              message: "Item copied successfully",
              sourcePath,
              targetPath,
              uniqueName,
              toast: {
                type: "success",
                message: `Successfully copied to: ${uniqueName}`,
              },
            });
          }
        } else {
          fileLogger.warn("Copy completed but without success confirmation", {
            operation: "file_copy_uncertain",
            sessionId,
            sourcePath,
            targetPath,
            code,
            stdoutData: stdoutData.substring(0, 200),
          });

          if (!res.headersSent) {
            res.json({
              message: "Copy may have completed",
              sourcePath,
              targetPath,
              uniqueName,
              toast: {
                type: "warning",
                message: `Copy completed but verification uncertain for: ${uniqueName}`,
              },
            });
          }
        }
      });

      stream.on("error", (streamErr) => {
        clearTimeout(commandTimeout);
        fileLogger.error("SSH copyItem stream error:", streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: `Stream error: ${streamErr.message}` });
        }
      });
    });
  });
});

/**
 * @openapi
 * /ssh/file_manager/ssh/executeFile:
 *   post:
 *     summary: Execute a file
 *     description: Executes a file on the remote host.
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
 *               filePath:
 *                 type: string
 *     responses:
 *       200:
 *         description: File execution result.
 *       400:
 *         description: Missing required parameters or SSH connection not available.
 *       500:
 *         description: Failed to execute file.
 */
app.post("/ssh/file_manager/ssh/executeFile", async (req, res) => {
  const { sessionId, filePath } = req.body;
  const sshConn = sshSessions[sessionId];

  if (!sshConn || !sshConn.isConnected) {
    fileLogger.error(
      "SSH connection not found or not connected for executeFile",
      {
        operation: "execute_file",
        sessionId,
        hasConnection: !!sshConn,
        isConnected: sshConn?.isConnected,
      },
    );
    return res.status(400).json({ error: "SSH connection not available" });
  }

  if (!filePath) {
    return res.status(400).json({ error: "File path is required" });
  }

  const escapedPath = filePath.replace(/'/g, "'\"'\"'");

  const checkCommand = `test -x '${escapedPath}' && echo "EXECUTABLE" || echo "NOT_EXECUTABLE"`;

  sshConn.client.exec(checkCommand, (checkErr, checkStream) => {
    if (checkErr) {
      fileLogger.error("SSH executeFile check error:", checkErr);
      return res
        .status(500)
        .json({ error: "Failed to check file executability" });
    }

    let checkResult = "";
    checkStream.on("data", (data) => {
      checkResult += data.toString();
    });

    checkStream.on("close", () => {
      if (!checkResult.includes("EXECUTABLE")) {
        return res.status(400).json({ error: "File is not executable" });
      }

      const executeCommand = `cd "$(dirname '${escapedPath}')" && '${escapedPath}' 2>&1; echo "EXIT_CODE:$?"`;

      sshConn.client.exec(executeCommand, (err, stream) => {
        if (err) {
          fileLogger.error("SSH executeFile error:", err);
          return res.status(500).json({ error: "Failed to execute file" });
        }

        let output = "";
        let errorOutput = "";

        stream.on("data", (data) => {
          output += data.toString();
        });

        stream.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        stream.on("close", (code) => {
          const exitCodeMatch = output.match(/EXIT_CODE:(\d+)$/);
          const actualExitCode = exitCodeMatch
            ? parseInt(exitCodeMatch[1])
            : code;
          const cleanOutput = output.replace(/EXIT_CODE:\d+$/, "").trim();

          fileLogger.info("File execution completed", {
            operation: "execute_file",
            sessionId,
            filePath,
            exitCode: actualExitCode,
            outputLength: cleanOutput.length,
            errorLength: errorOutput.length,
          });

          res.json({
            success: true,
            exitCode: actualExitCode,
            output: cleanOutput,
            error: errorOutput,
            timestamp: new Date().toISOString(),
          });
        });

        stream.on("error", (streamErr) => {
          fileLogger.error("SSH executeFile stream error:", streamErr);
          if (!res.headersSent) {
            res.status(500).json({ error: "Execution stream error" });
          }
        });
      });
    });
  });
});

/**
 * @openapi
 * /ssh/file_manager/ssh/changePermissions:
 *   post:
 *     summary: Change file permissions
 *     description: Changes the permissions of a file on the remote host.
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
 *               path:
 *                 type: string
 *               permissions:
 *                 type: string
 *     responses:
 *       200:
 *         description: Permissions changed successfully.
 *       400:
 *         description: Missing required parameters or SSH connection not available.
 *       408:
 *         description: Permission change timed out.
 *       500:
 *         description: Failed to change permissions.
 */
app.post("/ssh/file_manager/ssh/changePermissions", async (req, res) => {
  const { sessionId, path, permissions } = req.body;
  const sshConn = sshSessions[sessionId];

  if (!sshConn || !sshConn.isConnected) {
    fileLogger.error(
      "SSH connection not found or not connected for changePermissions",
      {
        operation: "change_permissions",
        sessionId,
        hasConnection: !!sshConn,
        isConnected: sshConn?.isConnected,
      },
    );
    return res.status(400).json({ error: "SSH connection not available" });
  }

  if (!path) {
    return res.status(400).json({ error: "File path is required" });
  }

  if (!permissions || !/^\d{3,4}$/.test(permissions)) {
    return res.status(400).json({
      error: "Valid permissions required (e.g., 755, 644)",
    });
  }

  sshConn.lastActive = Date.now();
  scheduleSessionCleanup(sessionId);

  const octalPerms = permissions.slice(-3);
  const escapedPath = path.replace(/'/g, "'\"'\"'");
  const command = `chmod ${octalPerms} '${escapedPath}' && echo "SUCCESS"`;

  fileLogger.info("Changing file permissions", {
    operation: "change_permissions",
    sessionId,
    path,
    permissions: octalPerms,
  });

  const commandTimeout = setTimeout(() => {
    if (!res.headersSent) {
      fileLogger.error("changePermissions command timeout", {
        operation: "change_permissions",
        sessionId,
        path,
        permissions: octalPerms,
      });
      res.status(408).json({
        error: "Permission change timed out. SSH connection may be unstable.",
      });
    }
  }, 10000);

  sshConn.client.exec(command, (err, stream) => {
    if (err) {
      clearTimeout(commandTimeout);
      fileLogger.error("SSH changePermissions exec error:", err, {
        operation: "change_permissions",
        sessionId,
        path,
        permissions: octalPerms,
      });
      if (!res.headersSent) {
        return res.status(500).json({ error: "Failed to change permissions" });
      }
      return;
    }

    let outputData = "";
    let errorOutput = "";

    stream.on("data", (chunk: Buffer) => {
      outputData += chunk.toString();
    });

    stream.stderr.on("data", (data: Buffer) => {
      errorOutput += data.toString();
    });

    stream.on("close", (code) => {
      clearTimeout(commandTimeout);

      if (outputData.includes("SUCCESS")) {
        fileLogger.success("File permissions changed successfully", {
          operation: "change_permissions",
          sessionId,
          path,
          permissions: octalPerms,
        });

        if (!res.headersSent) {
          res.json({
            success: true,
            message: "Permissions changed successfully",
          });
        }
        return;
      }

      if (code !== 0) {
        fileLogger.error("chmod command failed", {
          operation: "change_permissions",
          sessionId,
          path,
          permissions: octalPerms,
          exitCode: code,
          error: errorOutput,
        });
        if (!res.headersSent) {
          return res.status(500).json({
            error: errorOutput || "Failed to change permissions",
          });
        }
        return;
      }

      fileLogger.success("File permissions changed successfully", {
        operation: "change_permissions",
        sessionId,
        path,
        permissions: octalPerms,
      });

      if (!res.headersSent) {
        res.json({
          success: true,
          message: "Permissions changed successfully",
        });
      }
    });

    stream.on("error", (streamErr) => {
      clearTimeout(commandTimeout);
      fileLogger.error("SSH changePermissions stream error:", streamErr, {
        operation: "change_permissions",
        sessionId,
        path,
        permissions: octalPerms,
      });
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: "Stream error while changing permissions" });
      }
    });
  });
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

  if (!sessionId || !archivePath) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  const session = sshSessions[sessionId];
  if (!session || !session.isConnected) {
    return res.status(400).json({ error: "SSH session not connected" });
  }

  session.lastActive = Date.now();
  scheduleSessionCleanup(sessionId);

  const fileName = archivePath.split("/").pop() || "";
  const fileExt = fileName.toLowerCase();

  let extractCommand = "";
  const targetPath =
    extractPath || archivePath.substring(0, archivePath.lastIndexOf("/"));

  if (fileExt.endsWith(".tar.gz") || fileExt.endsWith(".tgz")) {
    extractCommand = `tar -xzf "${archivePath}" -C "${targetPath}"`;
  } else if (fileExt.endsWith(".tar.bz2") || fileExt.endsWith(".tbz2")) {
    extractCommand = `tar -xjf "${archivePath}" -C "${targetPath}"`;
  } else if (fileExt.endsWith(".tar.xz")) {
    extractCommand = `tar -xJf "${archivePath}" -C "${targetPath}"`;
  } else if (fileExt.endsWith(".tar")) {
    extractCommand = `tar -xf "${archivePath}" -C "${targetPath}"`;
  } else if (fileExt.endsWith(".zip")) {
    extractCommand = `unzip -o "${archivePath}" -d "${targetPath}"`;
  } else if (fileExt.endsWith(".gz") && !fileExt.endsWith(".tar.gz")) {
    extractCommand = `gunzip -c "${archivePath}" > "${archivePath.replace(/\.gz$/, "")}"`;
  } else if (fileExt.endsWith(".bz2") && !fileExt.endsWith(".tar.bz2")) {
    extractCommand = `bunzip2 -k "${archivePath}"`;
  } else if (fileExt.endsWith(".xz") && !fileExt.endsWith(".tar.xz")) {
    extractCommand = `unxz -k "${archivePath}"`;
  } else if (fileExt.endsWith(".7z")) {
    extractCommand = `7z x "${archivePath}" -o"${targetPath}"`;
  } else if (fileExt.endsWith(".rar")) {
    extractCommand = `unrar x "${archivePath}" "${targetPath}/"`;
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

  session.client.exec(extractCommand, (err, stream) => {
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

    stream.on("data", (data: Buffer) => {});

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

  session.lastActive = Date.now();
  scheduleSessionCleanup(sessionId);

  const compressionFormat = format || "zip";
  let compressCommand = "";

  const firstPath = paths[0];
  const workingDir = firstPath.substring(0, firstPath.lastIndexOf("/")) || "/";

  const fileNames = paths
    .map((p) => {
      const name = p.split("/").pop();
      return `"${name}"`;
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

  if (compressionFormat === "zip") {
    compressCommand = `cd "${workingDir}" && zip -r "${archivePath}" ${fileNames}`;
  } else if (compressionFormat === "tar.gz" || compressionFormat === "tgz") {
    compressCommand = `cd "${workingDir}" && tar -czf "${archivePath}" ${fileNames}`;
  } else if (compressionFormat === "tar.bz2" || compressionFormat === "tbz2") {
    compressCommand = `cd "${workingDir}" && tar -cjf "${archivePath}" ${fileNames}`;
  } else if (compressionFormat === "tar.xz") {
    compressCommand = `cd "${workingDir}" && tar -cJf "${archivePath}" ${fileNames}`;
  } else if (compressionFormat === "tar") {
    compressCommand = `cd "${workingDir}" && tar -cf "${archivePath}" ${fileNames}`;
  } else if (compressionFormat === "7z") {
    compressCommand = `cd "${workingDir}" && 7z a "${archivePath}" ${fileNames}`;
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

  session.client.exec(compressCommand, (err, stream) => {
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

    stream.on("data", (data: Buffer) => {});

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
