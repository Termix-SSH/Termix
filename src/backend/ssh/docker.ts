import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import axios from "axios";
import { Client as SSHClient } from "ssh2";
import type { ClientChannel } from "ssh2";
import { getDb } from "../database/db/index.js";
import { sshData, sshCredentials } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { logger } from "../utils/logger.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { AuthManager } from "../utils/auth-manager.js";
import { createSocks5Connection } from "../utils/socks5-helper.js";
import type { AuthenticatedRequest, SSHHost } from "../../types/index.js";

const dockerLogger = logger;

interface SSHSession {
  client: SSHClient;
  isConnected: boolean;
  lastActive: number;
  timeout?: NodeJS.Timeout;
  activeOperations: number;
  hostId?: number;
}

interface PendingTOTPSession {
  client: SSHClient;
  finish: (responses: string[]) => void;
  config: any;
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
}

const sshSessions: Record<string, SSHSession> = {};
const pendingTOTPSessions: Record<string, PendingTOTPSession> = {};

const SESSION_IDLE_TIMEOUT = 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  Object.keys(pendingTOTPSessions).forEach((sessionId) => {
    const session = pendingTOTPSessions[sessionId];
    if (now - session.createdAt > 180000) {
      try {
        session.client.end();
      } catch {}
      delete pendingTOTPSessions[sessionId];
    }
  });
}, 60000);

function cleanupSession(sessionId: string) {
  const session = sshSessions[sessionId];
  if (session) {
    if (session.activeOperations > 0) {
      dockerLogger.warn(
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

    session.timeout = setTimeout(() => {
      cleanupSession(sessionId);
    }, SESSION_IDLE_TIMEOUT);
  }
}

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
    dockerLogger.error("Failed to resolve jump host", error, {
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
    const jumpHostConfigs = await Promise.all(
      jumpHosts.map((jh) => resolveJumpHost(jh.hostId, userId)),
    );

    for (let i = 0; i < jumpHostConfigs.length; i++) {
      if (!jumpHostConfigs[i]) {
        dockerLogger.error(`Jump host ${i + 1} not found`, undefined, {
          operation: "jump_host_chain",
          hostId: jumpHosts[i].hostId,
        });
        clients.forEach((c) => c.end());
        return null;
      }
    }

    for (let i = 0; i < jumpHostConfigs.length; i++) {
      const jumpHostConfig = jumpHostConfigs[i];

      const jumpClient = new SSHClient();
      clients.push(jumpClient);

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
          dockerLogger.error(`Jump host ${i + 1} connection failed`, err, {
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
    dockerLogger.error("Failed to create jump host chain", error, {
      operation: "jump_host_chain",
    });
    clients.forEach((c) => c.end());
    return null;
  }
}

async function executeDockerCommand(
  session: SSHSession,
  command: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    session.client.exec(command, (err, stream) => {
      if (err) {
        dockerLogger.error("Docker command execution error", err, {
          operation: "execute_docker_command",
          command,
        });
        return reject(err);
      }

      let stdout = "";
      let stderr = "";

      stream.on("close", (code: number) => {
        if (code !== 0) {
          dockerLogger.error("Docker command failed", undefined, {
            operation: "execute_docker_command",
            command,
            exitCode: code,
            stderr,
          });
          reject(new Error(stderr || `Command exited with code ${code}`));
        } else {
          resolve(stdout);
        }
      });

      stream.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      stream.on("error", (streamErr: Error) => {
        dockerLogger.error("Docker command stream error", streamErr, {
          operation: "execute_docker_command",
          command,
        });
        reject(streamErr);
      });
    });
  });
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
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

const authManager = AuthManager.getInstance();
app.use(authManager.createAuthMiddleware());

// POST /docker/ssh/connect - Establish SSH session
app.post("/docker/ssh/connect", async (req, res) => {
  const {
    sessionId,
    hostId,
    userProvidedPassword,
    userProvidedSshKey,
    userProvidedKeyPassword,
    forceKeyboardInteractive,
    useSocks5,
    socks5Host,
    socks5Port,
    socks5Username,
    socks5Password,
    socks5ProxyChain,
  } = req.body;
  const userId = (req as any).userId;

  if (!userId) {
    dockerLogger.error(
      "Docker SSH connection rejected: no authenticated user",
      {
        operation: "docker_connect_auth",
        sessionId,
      },
    );
    return res.status(401).json({ error: "Authentication required" });
  }

  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  if (!sessionId || !hostId) {
    dockerLogger.warn("Missing Docker SSH connection parameters", {
      operation: "docker_connect",
      sessionId,
      hasHostId: !!hostId,
    });
    return res.status(400).json({ error: "Missing sessionId or hostId" });
  }

  try {
    const hosts = await SimpleDBOps.select(
      getDb().select().from(sshData).where(eq(sshData.id, hostId)),
      "ssh_data",
      userId,
    );

    if (hosts.length === 0) {
      return res.status(404).json({ error: "Host not found" });
    }

    const host = hosts[0] as unknown as SSHHost;

    if (host.userId !== userId) {
      const { PermissionManager } =
        await import("../utils/permission-manager.js");
      const permissionManager = PermissionManager.getInstance();
      const accessInfo = await permissionManager.canAccessHost(
        userId,
        hostId,
        "execute",
      );

      if (!accessInfo.hasAccess) {
        dockerLogger.warn("User does not have access to host", {
          operation: "docker_connect",
          hostId,
          userId,
        });
        return res.status(403).json({ error: "Access denied" });
      }
    }
    if (typeof host.jumpHosts === "string" && host.jumpHosts) {
      try {
        host.jumpHosts = JSON.parse(host.jumpHosts);
      } catch (e) {
        dockerLogger.error("Failed to parse jump hosts", e, {
          hostId: host.id,
        });
        host.jumpHosts = [];
      }
    }

    if (!host.enableDocker) {
      dockerLogger.warn("Docker not enabled for host", {
        operation: "docker_connect",
        hostId,
        userId,
      });
      return res.status(403).json({
        error:
          "Docker is not enabled for this host. Enable it in Host Settings.",
        code: "DOCKER_DISABLED",
      });
    }

    if (sshSessions[sessionId]) {
      cleanupSession(sessionId);
    }

    if (pendingTOTPSessions[sessionId]) {
      try {
        pendingTOTPSessions[sessionId].client.end();
      } catch {}
      delete pendingTOTPSessions[sessionId];
    }

    let resolvedCredentials: any = {
      password: host.password,
      sshKey: host.key,
      keyPassword: host.keyPassword,
      authType: host.authType,
    };

    if (userProvidedPassword) {
      resolvedCredentials.password = userProvidedPassword;
    }
    if (userProvidedSshKey) {
      resolvedCredentials.sshKey = userProvidedSshKey;
      resolvedCredentials.authType = "key";
    }
    if (userProvidedKeyPassword) {
      resolvedCredentials.keyPassword = userProvidedKeyPassword;
    }

    if (host.credentialId) {
      const ownerId = host.userId;

      if (userId !== ownerId) {
        try {
          const { SharedCredentialManager } =
            await import("../utils/shared-credential-manager.js");
          const sharedCredManager = SharedCredentialManager.getInstance();
          const sharedCred = await sharedCredManager.getSharedCredentialForUser(
            host.id,
            userId,
          );

          if (sharedCred) {
            resolvedCredentials = {
              password: sharedCred.password,
              sshKey: sharedCred.key,
              keyPassword: sharedCred.keyPassword,
              authType: sharedCred.authType,
            };
          }
        } catch (error) {
          dockerLogger.error("Failed to resolve shared credential", error, {
            operation: "docker_connect",
            hostId,
            userId,
          });
        }
      } else {
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
          resolvedCredentials = {
            password: credential.password,
            sshKey:
              credential.private_key || credential.privateKey || credential.key,
            keyPassword: credential.key_password || credential.keyPassword,
            authType: credential.auth_type || credential.authType,
          };
        }
      }
    }

    const client = new SSHClient();

    const config: any = {
      host: host.ip,
      port: host.port || 22,
      username: host.username,
      tryKeyboard: true,
      keepaliveInterval: 30000,
      keepaliveCountMax: 3,
      readyTimeout: 60000,
      tcpKeepAlive: true,
      tcpKeepAliveInitialDelay: 30000,
    };

    if (resolvedCredentials.authType === "none") {
    } else if (resolvedCredentials.authType === "password") {
      if (resolvedCredentials.password) {
        config.password = resolvedCredentials.password;
      }
    } else if (
      resolvedCredentials.authType === "key" &&
      resolvedCredentials.sshKey
    ) {
      try {
        if (
          !resolvedCredentials.sshKey.includes("-----BEGIN") ||
          !resolvedCredentials.sshKey.includes("-----END")
        ) {
          dockerLogger.error("Invalid SSH key format", {
            operation: "docker_connect",
            sessionId,
            hostId,
          });
          return res.status(400).json({
            error: "Invalid private key format",
          });
        }

        const cleanKey = resolvedCredentials.sshKey
          .trim()
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n");
        config.privateKey = Buffer.from(cleanKey, "utf8");
        if (resolvedCredentials.keyPassword) {
          config.passphrase = resolvedCredentials.keyPassword;
        }
      } catch (error) {
        dockerLogger.error("SSH key processing error", error, {
          operation: "docker_connect",
          sessionId,
          hostId,
        });
        return res.status(400).json({
          error: "SSH key format error: Invalid private key format",
        });
      }
    } else if (resolvedCredentials.authType === "key") {
      dockerLogger.error(
        "SSH key authentication requested but no key provided",
        {
          operation: "docker_connect",
          sessionId,
          hostId,
        },
      );
      return res.status(400).json({
        error: "SSH key authentication requested but no key provided",
      });
    }

    let responseSent = false;
    let keyboardInteractiveResponded = false;

    client.on("ready", () => {
      if (responseSent) return;
      responseSent = true;

      sshSessions[sessionId] = {
        client,
        isConnected: true,
        lastActive: Date.now(),
        activeOperations: 0,
        hostId,
      };

      scheduleSessionCleanup(sessionId);

      res.json({ success: true, message: "SSH connection established" });
    });

    client.on("error", (err) => {
      if (responseSent) return;
      responseSent = true;

      dockerLogger.error("Docker SSH connection failed", err, {
        operation: "docker_connect",
        sessionId,
        hostId,
        userId,
      });

      if (
        resolvedCredentials.authType === "none" &&
        (err.message.includes("authentication") ||
          err.message.includes("All configured authentication methods failed"))
      ) {
        res.json({
          status: "auth_required",
          reason: "no_keyboard",
        });
      } else {
        res.status(500).json({
          success: false,
          message: err.message || "SSH connection failed",
        });
      }
    });

    client.on("close", () => {
      if (sshSessions[sessionId]) {
        sshSessions[sessionId].isConnected = false;
        cleanupSession(sessionId);
      }
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

          pendingTOTPSessions[sessionId] = {
            client,
            finish,
            config,
            createdAt: Date.now(),
            sessionId,
            hostId,
            ip: host.ip,
            port: host.port || 22,
            username: host.username,
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
          });
        } else {
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

          const hasStoredPassword =
            resolvedCredentials.password &&
            resolvedCredentials.authType !== "none";

          if (!hasStoredPassword && passwordPromptIndex !== -1) {
            if (responseSent) {
              const responses = prompts.map((p) => {
                if (
                  /password/i.test(p.prompt) &&
                  resolvedCredentials.password
                ) {
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
                if (
                  /password/i.test(p.prompt) &&
                  resolvedCredentials.password
                ) {
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
              ip: host.ip,
              port: host.port || 22,
              username: host.username,
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
      try {
        const socks5Socket = await createSocks5Connection(
          host.ip,
          host.port || 22,
          {
            useSocks5,
            socks5Host,
            socks5Port,
            socks5Username,
            socks5Password,
            socks5ProxyChain: socks5ProxyChain as any,
          },
        );

        if (socks5Socket) {
          config.sock = socks5Socket;
          client.connect(config);
          return;
        }
      } catch (socks5Error) {
        dockerLogger.error("SOCKS5 connection failed", socks5Error, {
          operation: "docker_socks5_connect",
          sessionId,
          hostId,
          proxyHost: socks5Host,
          proxyPort: socks5Port || 1080,
        });
        if (!responseSent) {
          responseSent = true;
          return res.status(500).json({
            error:
              "SOCKS5 proxy connection failed: " +
              (socks5Error instanceof Error
                ? socks5Error.message
                : "Unknown error"),
          });
        }
        return;
      }
    } else if (host.jumpHosts && host.jumpHosts.length > 0) {
      const jumpClient = await createJumpHostChain(
        host.jumpHosts as Array<{ hostId: number }>,
        userId,
      );

      if (!jumpClient) {
        return res.status(500).json({
          error: "Failed to establish jump host chain",
        });
      }

      jumpClient.forwardOut(
        "127.0.0.1",
        0,
        host.ip,
        host.port || 22,
        (err, stream) => {
          if (err) {
            dockerLogger.error("Failed to forward through jump host", err, {
              operation: "docker_jump_forward",
              sessionId,
              hostId,
            });
            jumpClient.end();
            if (!responseSent) {
              responseSent = true;
              return res.status(500).json({
                error: "Failed to forward through jump host: " + err.message,
              });
            }
            return;
          }

          config.sock = stream;
          client.connect(config);
        },
      );
    } else {
      client.connect(config);
    }
  } catch (error) {
    dockerLogger.error("Docker SSH connection error", error, {
      operation: "docker_connect",
      sessionId,
      hostId,
      userId,
    });
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// POST /docker/ssh/disconnect - Close SSH session
app.post("/docker/ssh/disconnect", async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  cleanupSession(sessionId);

  res.json({ success: true, message: "SSH session disconnected" });
});

// POST /docker/ssh/connect-totp - Verify TOTP and complete connection
app.post("/docker/ssh/connect-totp", async (req, res) => {
  const { sessionId, totpCode } = req.body;
  const userId = (req as any).userId;

  if (!userId) {
    dockerLogger.error("TOTP verification rejected: no authenticated user", {
      operation: "docker_totp_auth",
      sessionId,
    });
    return res.status(401).json({ error: "Authentication required" });
  }

  if (!sessionId || !totpCode) {
    return res.status(400).json({ error: "Session ID and TOTP code required" });
  }

  const session = pendingTOTPSessions[sessionId];

  if (!session) {
    dockerLogger.warn("TOTP session not found or expired", {
      operation: "docker_totp_verify",
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
    } catch {}
    dockerLogger.warn("TOTP session timeout before code submission", {
      operation: "docker_totp_verify",
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
        hostId: session.hostId,
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

            await axios.post(
              "http://localhost:30006/activity/log",
              {
                type: "docker",
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
            dockerLogger.warn("Failed to log Docker activity (TOTP)", {
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

    dockerLogger.error("TOTP verification failed", {
      operation: "docker_totp_verify",
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
      dockerLogger.warn("TOTP verification timeout", {
        operation: "docker_totp_verify",
        sessionId,
        userId,
      });
      res.status(408).json({ error: "TOTP verification timeout" });
    }
  }, 60000);

  session.finish(responses);
});

// POST /docker/ssh/keepalive - Keep session alive
app.post("/docker/ssh/keepalive", async (req, res) => {
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
    success: true,
    connected: true,
    message: "Session keepalive successful",
    lastActive: session.lastActive,
  });
});

// GET /docker/ssh/status - Check session status
app.get("/docker/ssh/status", async (req, res) => {
  const sessionId = req.query.sessionId as string;

  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  const isConnected = !!sshSessions[sessionId]?.isConnected;

  res.json({ success: true, connected: isConnected });
});

// GET /docker/validate/:sessionId - Validate Docker availability
app.get("/docker/validate/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const userId = (req as any).userId;

  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const session = sshSessions[sessionId];

  if (!session || !session.isConnected) {
    return res.status(400).json({
      error: "SSH session not found or not connected",
    });
  }

  session.lastActive = Date.now();
  session.activeOperations++;

  try {
    try {
      const versionOutput = await executeDockerCommand(
        session,
        "docker --version",
      );
      const versionMatch = versionOutput.match(/Docker version ([^\s,]+)/);
      const version = versionMatch ? versionMatch[1] : "unknown";

      try {
        await executeDockerCommand(session, "docker ps >/dev/null 2>&1");

        session.activeOperations--;
        return res.json({
          available: true,
          version,
        });
      } catch (daemonError) {
        session.activeOperations--;
        const errorMsg =
          daemonError instanceof Error ? daemonError.message : "";

        if (errorMsg.includes("Cannot connect to the Docker daemon")) {
          return res.json({
            available: false,
            error:
              "Docker daemon is not running. Start it with: sudo systemctl start docker",
            code: "DAEMON_NOT_RUNNING",
          });
        }

        if (errorMsg.includes("permission denied")) {
          return res.json({
            available: false,
            error:
              "Permission denied. Add your user to the docker group: sudo usermod -aG docker $USER",
            code: "PERMISSION_DENIED",
          });
        }

        return res.json({
          available: false,
          error: errorMsg,
          code: "DOCKER_ERROR",
        });
      }
    } catch (installError) {
      session.activeOperations--;
      return res.json({
        available: false,
        error:
          "Docker is not installed on this host. Please install Docker to use this feature.",
        code: "NOT_INSTALLED",
      });
    }
  } catch (error) {
    session.activeOperations--;
    dockerLogger.error("Docker validation error", error, {
      operation: "docker_validate",
      sessionId,
      userId,
    });

    res.status(500).json({
      available: false,
      error: error instanceof Error ? error.message : "Validation failed",
    });
  }
});

// GET /docker/containers/:sessionId - List all containers
app.get("/docker/containers/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const all = req.query.all !== "false";
  const userId = (req as any).userId;

  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const session = sshSessions[sessionId];

  if (!session || !session.isConnected) {
    return res.status(400).json({
      error: "SSH session not found or not connected",
    });
  }

  session.lastActive = Date.now();
  session.activeOperations++;

  try {
    const allFlag = all ? "-a " : "";
    const command = `docker ps ${allFlag}--format '{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","state":"{{.State}}","ports":"{{.Ports}}","created":"{{.CreatedAt}}"}'`;

    const output = await executeDockerCommand(session, command);

    const containers = output
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (e) {
          dockerLogger.warn("Failed to parse container line", {
            operation: "parse_container",
            line,
          });
          return null;
        }
      })
      .filter((c) => c !== null);

    session.activeOperations--;

    res.json(containers);
  } catch (error) {
    session.activeOperations--;
    dockerLogger.error("Failed to list Docker containers", error, {
      operation: "list_containers",
      sessionId,
      userId,
    });

    res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to list containers",
    });
  }
});

// GET /docker/containers/:sessionId/:containerId - Get container details
app.get("/docker/containers/:sessionId/:containerId", async (req, res) => {
  const { sessionId, containerId } = req.params;
  const userId = (req as any).userId;

  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const session = sshSessions[sessionId];

  if (!session || !session.isConnected) {
    return res.status(400).json({
      error: "SSH session not found or not connected",
    });
  }

  session.lastActive = Date.now();
  session.activeOperations++;

  try {
    const command = `docker inspect ${containerId}`;
    const output = await executeDockerCommand(session, command);
    const details = JSON.parse(output);

    session.activeOperations--;

    if (details && details.length > 0) {
      res.json(details[0]);
    } else {
      res.status(404).json({
        error: "Container not found",
        code: "CONTAINER_NOT_FOUND",
      });
    }
  } catch (error) {
    session.activeOperations--;

    const errorMsg = error instanceof Error ? error.message : "";
    if (errorMsg.includes("No such container")) {
      return res.status(404).json({
        error: "Container not found",
        code: "CONTAINER_NOT_FOUND",
      });
    }

    dockerLogger.error("Failed to get container details", error, {
      operation: "get_container_details",
      sessionId,
      containerId,
      userId,
    });

    res.status(500).json({
      error: errorMsg || "Failed to get container details",
    });
  }
});

// POST /docker/containers/:sessionId/:containerId/start - Start container
app.post(
  "/docker/containers/:sessionId/:containerId/start",
  async (req, res) => {
    const { sessionId, containerId } = req.params;
    const userId = (req as any).userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const session = sshSessions[sessionId];

    if (!session || !session.isConnected) {
      return res.status(400).json({
        error: "SSH session not found or not connected",
      });
    }

    session.lastActive = Date.now();
    session.activeOperations++;

    try {
      await executeDockerCommand(session, `docker start ${containerId}`);

      session.activeOperations--;

      res.json({
        success: true,
        message: "Container started successfully",
      });
    } catch (error) {
      session.activeOperations--;

      const errorMsg = error instanceof Error ? error.message : "";
      if (errorMsg.includes("No such container")) {
        return res.status(404).json({
          success: false,
          error: "Container not found",
          code: "CONTAINER_NOT_FOUND",
        });
      }

      dockerLogger.error("Failed to start container", error, {
        operation: "start_container",
        sessionId,
        containerId,
        userId,
      });

      res.status(500).json({
        success: false,
        error: errorMsg || "Failed to start container",
      });
    }
  },
);

// POST /docker/containers/:sessionId/:containerId/stop - Stop container
app.post(
  "/docker/containers/:sessionId/:containerId/stop",
  async (req, res) => {
    const { sessionId, containerId } = req.params;
    const userId = (req as any).userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const session = sshSessions[sessionId];

    if (!session || !session.isConnected) {
      return res.status(400).json({
        error: "SSH session not found or not connected",
      });
    }

    session.lastActive = Date.now();
    session.activeOperations++;

    try {
      await executeDockerCommand(session, `docker stop ${containerId}`);

      session.activeOperations--;

      res.json({
        success: true,
        message: "Container stopped successfully",
      });
    } catch (error) {
      session.activeOperations--;

      const errorMsg = error instanceof Error ? error.message : "";
      if (errorMsg.includes("No such container")) {
        return res.status(404).json({
          success: false,
          error: "Container not found",
          code: "CONTAINER_NOT_FOUND",
        });
      }

      dockerLogger.error("Failed to stop container", error, {
        operation: "stop_container",
        sessionId,
        containerId,
        userId,
      });

      res.status(500).json({
        success: false,
        error: errorMsg || "Failed to stop container",
      });
    }
  },
);

// POST /docker/containers/:sessionId/:containerId/restart - Restart container
app.post(
  "/docker/containers/:sessionId/:containerId/restart",
  async (req, res) => {
    const { sessionId, containerId } = req.params;
    const userId = (req as any).userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const session = sshSessions[sessionId];

    if (!session || !session.isConnected) {
      return res.status(400).json({
        error: "SSH session not found or not connected",
      });
    }

    session.lastActive = Date.now();
    session.activeOperations++;

    try {
      await executeDockerCommand(session, `docker restart ${containerId}`);

      session.activeOperations--;

      res.json({
        success: true,
        message: "Container restarted successfully",
      });
    } catch (error) {
      session.activeOperations--;

      const errorMsg = error instanceof Error ? error.message : "";
      if (errorMsg.includes("No such container")) {
        return res.status(404).json({
          success: false,
          error: "Container not found",
          code: "CONTAINER_NOT_FOUND",
        });
      }

      dockerLogger.error("Failed to restart container", error, {
        operation: "restart_container",
        sessionId,
        containerId,
        userId,
      });

      res.status(500).json({
        success: false,
        error: errorMsg || "Failed to restart container",
      });
    }
  },
);

// POST /docker/containers/:sessionId/:containerId/pause - Pause container
app.post(
  "/docker/containers/:sessionId/:containerId/pause",
  async (req, res) => {
    const { sessionId, containerId } = req.params;
    const userId = (req as any).userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const session = sshSessions[sessionId];

    if (!session || !session.isConnected) {
      return res.status(400).json({
        error: "SSH session not found or not connected",
      });
    }

    session.lastActive = Date.now();
    session.activeOperations++;

    try {
      await executeDockerCommand(session, `docker pause ${containerId}`);

      session.activeOperations--;

      res.json({
        success: true,
        message: "Container paused successfully",
      });
    } catch (error) {
      session.activeOperations--;

      const errorMsg = error instanceof Error ? error.message : "";
      if (errorMsg.includes("No such container")) {
        return res.status(404).json({
          success: false,
          error: "Container not found",
          code: "CONTAINER_NOT_FOUND",
        });
      }

      dockerLogger.error("Failed to pause container", error, {
        operation: "pause_container",
        sessionId,
        containerId,
        userId,
      });

      res.status(500).json({
        success: false,
        error: errorMsg || "Failed to pause container",
      });
    }
  },
);

// POST /docker/containers/:sessionId/:containerId/unpause - Unpause container
app.post(
  "/docker/containers/:sessionId/:containerId/unpause",
  async (req, res) => {
    const { sessionId, containerId } = req.params;
    const userId = (req as any).userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const session = sshSessions[sessionId];

    if (!session || !session.isConnected) {
      return res.status(400).json({
        error: "SSH session not found or not connected",
      });
    }

    session.lastActive = Date.now();
    session.activeOperations++;

    try {
      await executeDockerCommand(session, `docker unpause ${containerId}`);

      session.activeOperations--;

      res.json({
        success: true,
        message: "Container unpaused successfully",
      });
    } catch (error) {
      session.activeOperations--;

      const errorMsg = error instanceof Error ? error.message : "";
      if (errorMsg.includes("No such container")) {
        return res.status(404).json({
          success: false,
          error: "Container not found",
          code: "CONTAINER_NOT_FOUND",
        });
      }

      dockerLogger.error("Failed to unpause container", error, {
        operation: "unpause_container",
        sessionId,
        containerId,
        userId,
      });

      res.status(500).json({
        success: false,
        error: errorMsg || "Failed to unpause container",
      });
    }
  },
);

// DELETE /docker/containers/:sessionId/:containerId/remove - Remove container
app.delete(
  "/docker/containers/:sessionId/:containerId/remove",
  async (req, res) => {
    const { sessionId, containerId } = req.params;
    const force = req.query.force === "true";
    const userId = (req as any).userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const session = sshSessions[sessionId];

    if (!session || !session.isConnected) {
      return res.status(400).json({
        error: "SSH session not found or not connected",
      });
    }

    session.lastActive = Date.now();
    session.activeOperations++;

    try {
      const forceFlag = force ? "-f " : "";
      await executeDockerCommand(
        session,
        `docker rm ${forceFlag}${containerId}`,
      );

      session.activeOperations--;

      res.json({
        success: true,
        message: "Container removed successfully",
      });
    } catch (error) {
      session.activeOperations--;

      const errorMsg = error instanceof Error ? error.message : "";
      if (errorMsg.includes("No such container")) {
        return res.status(404).json({
          success: false,
          error: "Container not found",
          code: "CONTAINER_NOT_FOUND",
        });
      }

      if (errorMsg.includes("cannot remove a running container")) {
        return res.status(400).json({
          success: false,
          error:
            "Cannot remove a running container. Stop it first or use force.",
          code: "CONTAINER_RUNNING",
        });
      }

      dockerLogger.error("Failed to remove container", error, {
        operation: "remove_container",
        sessionId,
        containerId,
        userId,
      });

      res.status(500).json({
        success: false,
        error: errorMsg || "Failed to remove container",
      });
    }
  },
);

// GET /docker/containers/:sessionId/:containerId/logs - Get container logs
app.get("/docker/containers/:sessionId/:containerId/logs", async (req, res) => {
  const { sessionId, containerId } = req.params;
  const tail = req.query.tail ? parseInt(req.query.tail as string) : 100;
  const timestamps = req.query.timestamps === "true";
  const since = req.query.since as string;
  const until = req.query.until as string;
  const userId = (req as any).userId;

  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const session = sshSessions[sessionId];

  if (!session || !session.isConnected) {
    return res.status(400).json({
      error: "SSH session not found or not connected",
    });
  }

  session.lastActive = Date.now();
  session.activeOperations++;

  try {
    let command = `docker logs ${containerId}`;

    if (tail && tail > 0) {
      command += ` --tail ${tail}`;
    }

    if (timestamps) {
      command += " --timestamps";
    }

    if (since) {
      command += ` --since ${since}`;
    }

    if (until) {
      command += ` --until ${until}`;
    }

    const logs = await executeDockerCommand(session, command);

    session.activeOperations--;

    res.json({
      success: true,
      logs,
    });
  } catch (error) {
    session.activeOperations--;

    const errorMsg = error instanceof Error ? error.message : "";
    if (errorMsg.includes("No such container")) {
      return res.status(404).json({
        success: false,
        error: "Container not found",
        code: "CONTAINER_NOT_FOUND",
      });
    }

    dockerLogger.error("Failed to get container logs", error, {
      operation: "get_logs",
      sessionId,
      containerId,
      userId,
    });

    res.status(500).json({
      success: false,
      error: errorMsg || "Failed to get container logs",
    });
  }
});

// GET /docker/containers/:sessionId/:containerId/stats - Get container stats
app.get(
  "/docker/containers/:sessionId/:containerId/stats",
  async (req, res) => {
    const { sessionId, containerId } = req.params;
    const userId = (req as any).userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const session = sshSessions[sessionId];

    if (!session || !session.isConnected) {
      return res.status(400).json({
        error: "SSH session not found or not connected",
      });
    }

    session.lastActive = Date.now();
    session.activeOperations++;

    try {
      const command = `docker stats ${containerId} --no-stream --format '{"cpu":"{{.CPUPerc}}","memory":"{{.MemUsage}}","memoryPercent":"{{.MemPerc}}","netIO":"{{.NetIO}}","blockIO":"{{.BlockIO}}","pids":"{{.PIDs}}"}'`;

      const output = await executeDockerCommand(session, command);
      const rawStats = JSON.parse(output.trim());

      const memoryParts = rawStats.memory.split(" / ");
      const memoryUsed = memoryParts[0]?.trim() || "0B";
      const memoryLimit = memoryParts[1]?.trim() || "0B";

      const netIOParts = rawStats.netIO.split(" / ");
      const netInput = netIOParts[0]?.trim() || "0B";
      const netOutput = netIOParts[1]?.trim() || "0B";

      const blockIOParts = rawStats.blockIO.split(" / ");
      const blockRead = blockIOParts[0]?.trim() || "0B";
      const blockWrite = blockIOParts[1]?.trim() || "0B";

      const stats = {
        cpu: rawStats.cpu,
        memoryUsed,
        memoryLimit,
        memoryPercent: rawStats.memoryPercent,
        netInput,
        netOutput,
        blockRead,
        blockWrite,
        pids: rawStats.pids,
      };

      session.activeOperations--;

      res.json(stats);
    } catch (error) {
      session.activeOperations--;

      const errorMsg = error instanceof Error ? error.message : "";
      if (errorMsg.includes("No such container")) {
        return res.status(404).json({
          success: false,
          error: "Container not found",
          code: "CONTAINER_NOT_FOUND",
        });
      }

      dockerLogger.error("Failed to get container stats", error, {
        operation: "get_stats",
        sessionId,
        containerId,
        userId,
      });

      res.status(500).json({
        success: false,
        error: errorMsg || "Failed to get container stats",
      });
    }
  },
);

const PORT = 30007;

app.listen(PORT, async () => {
  try {
    await authManager.initialize();
  } catch (err) {
    dockerLogger.error("Failed to initialize Docker backend", err, {
      operation: "startup",
    });
  }
});

process.on("SIGINT", () => {
  Object.keys(sshSessions).forEach((sessionId) => {
    cleanupSession(sessionId);
  });
  process.exit(0);
});

process.on("SIGTERM", () => {
  Object.keys(sshSessions).forEach((sessionId) => {
    cleanupSession(sessionId);
  });
  process.exit(0);
});
