import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  Client,
  type ClientChannel,
  type PseudoTtyOptions,
  type ConnectConfig,
} from "ssh2";
import { parse as parseUrl } from "url";
import axios from "axios";
import { getDb } from "../database/db/index.js";
import { sshCredentials, sshData } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { sshLogger, authLogger } from "../utils/logger.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { AuthManager } from "../utils/auth-manager.js";
import { UserCrypto } from "../utils/user-crypto.js";
import { createSocks5Connection } from "../utils/socks5-helper.js";
import { SSHAuthManager } from "./auth-manager.js";
import { SSHHostKeyVerifier } from "./host-key-verifier.js";

interface ConnectToHostData {
  cols: number;
  rows: number;
  hostConfig: {
    id: number;
    ip: string;
    port: number;
    username: string;
    password?: string;
    key?: string;
    keyPassword?: string;
    keyType?: string;
    authType?: string;
    credentialId?: number;
    userId?: string;
    forceKeyboardInteractive?: boolean;
    jumpHosts?: Array<{ hostId: number }>;
    useSocks5?: boolean;
    socks5Host?: string;
    socks5Port?: number;
    socks5Username?: string;
    socks5Password?: string;
    socks5ProxyChain?: unknown;
  };
  initialPath?: string;
  executeCommand?: string;
}

interface ResizeData {
  cols: number;
  rows: number;
}

interface TOTPResponseData {
  code?: string;
}

interface WebSocketMessage {
  type: string;
  data?: ConnectToHostData | ResizeData | TOTPResponseData | string | unknown;
  code?: string;
  [key: string]: unknown;
}

const authManager = AuthManager.getInstance();
const userCrypto = UserCrypto.getInstance();

const userConnections = new Map<string, Set<WebSocket>>();

async function resolveJumpHost(
  hostId: number,
  userId: string,
): Promise<any | null> {
  sshLogger.info("Resolving jump host", {
    operation: "terminal_jumphost_resolve",
    userId,
    hostId,
  });
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
    sshLogger.error("Failed to resolve jump host", error, {
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
): Promise<Client | null> {
  if (!jumpHosts || jumpHosts.length === 0) {
    return null;
  }

  let currentClient: Client | null = null;
  const clients: Client[] = [];

  try {
    const jumpHostConfigs = await Promise.all(
      jumpHosts.map((jh) => resolveJumpHost(jh.hostId, userId)),
    );

    for (let i = 0; i < jumpHostConfigs.length; i++) {
      if (!jumpHostConfigs[i]) {
        sshLogger.error(`Jump host ${i + 1} not found`, undefined, {
          operation: "jump_host_chain",
          hostId: jumpHosts[i].hostId,
        });
        clients.forEach((c) => c.end());
        return null;
      }
    }

    for (let i = 0; i < jumpHostConfigs.length; i++) {
      const jumpHostConfig = jumpHostConfigs[i];

      const jumpClient = new Client();
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
          sshLogger.success("Jump host connection established", {
            operation: "terminal_jumphost_connected",
            userId,
            hostId: jumpHostConfig.id,
            ip: jumpHostConfig.ip,
            depth: i,
          });
          resolve(true);
        });

        jumpClient.on("error", (err) => {
          clearTimeout(timeout);
          sshLogger.error(`Jump host ${i + 1} connection failed`, err, {
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
    sshLogger.error("Failed to create jump host chain", error, {
      operation: "jump_host_chain",
    });
    clients.forEach((c) => c.end());
    return null;
  }
}

const wss = new WebSocketServer({
  port: 30002,
  verifyClient: async (info) => {
    try {
      const url = parseUrl(info.req.url!, true);
      const token = url.query.token as string;

      if (!token) {
        return false;
      }

      const payload = await authManager.verifyJWTToken(token);

      if (!payload) {
        return false;
      }

      if (payload.pendingTOTP) {
        return false;
      }

      const existingConnections = userConnections.get(payload.userId);

      if (existingConnections && existingConnections.size >= 3) {
        return false;
      }

      return true;
    } catch (error) {
      sshLogger.error("WebSocket authentication error", error, {
        operation: "websocket_auth_error",
        ip: info.req.socket.remoteAddress,
      });
      return false;
    }
  },
});

wss.on("connection", async (ws: WebSocket, req) => {
  let userId: string | undefined;
  let sessionId: string | undefined;

  try {
    const url = parseUrl(req.url!, true);
    const token = url.query.token as string;

    if (!token) {
      ws.close(1008, "Authentication required");
      return;
    }

    const payload = await authManager.verifyJWTToken(token);
    if (!payload) {
      ws.close(1008, "Authentication required");
      return;
    }

    userId = payload.userId;
    sessionId = payload.sessionId;
  } catch (error) {
    sshLogger.error(
      "WebSocket JWT verification failed during connection",
      error,
      {
        operation: "websocket_connection_auth_error",
        ip: req.socket.remoteAddress,
      },
    );
    ws.close(1008, "Authentication required");
    return;
  }

  const dataKey = userCrypto.getUserDataKey(userId);
  if (!dataKey) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "Data locked - re-authenticate with password",
        code: "DATA_LOCKED",
      }),
    );
    ws.close(1008, "Data access required");
    return;
  }

  if (!userConnections.has(userId)) {
    userConnections.set(userId, new Set());
  }
  const userWs = userConnections.get(userId)!;
  userWs.add(ws);
  sshLogger.info("Terminal WebSocket connection established", {
    operation: "terminal_ws_connect",
    sessionId,
    userId,
  });

  let sshConn: Client | null = null;
  let sshStream: ClientChannel | null = null;
  let keyboardInteractiveFinish: ((responses: string[]) => void) | null = null;
  let totpPromptSent = false;
  let totpTimeout: NodeJS.Timeout | null = null;
  let isKeyboardInteractive = false;
  let keyboardInteractiveResponded = false;
  let isConnecting = false;
  let isConnected = false;
  let isCleaningUp = false;
  let isShellInitializing = false;
  let warpgateAuthPromptSent = false;
  let warpgateAuthTimeout: NodeJS.Timeout | null = null;
  let isAwaitingAuthCredentials = false;
  let opksshTempFiles: { keyPath: string; certPath: string } | null = null;

  ws.on("close", () => {
    sshLogger.info("Terminal WebSocket disconnected", {
      operation: "terminal_ws_disconnect",
      sessionId,
      userId,
    });
    const userWs = userConnections.get(userId);
    if (userWs) {
      userWs.delete(ws);
      if (userWs.size === 0) {
        userConnections.delete(userId);
      }
    }

    cleanupSSH();
  });

  function resetConnectionState() {
    isConnecting = false;
    isConnected = false;
    isKeyboardInteractive = false;
    keyboardInteractiveResponded = false;
    keyboardInteractiveFinish = null;
    totpPromptSent = false;
    warpgateAuthPromptSent = false;
  }

  ws.on("message", async (msg: RawData) => {
    const currentDataKey = userCrypto.getUserDataKey(userId);
    if (!currentDataKey) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Data access expired - please re-authenticate",
          code: "DATA_EXPIRED",
        }),
      );
      ws.close(1008, "Data access expired");
      return;
    }

    let parsed: WebSocketMessage;
    try {
      parsed = JSON.parse(msg.toString()) as WebSocketMessage;
    } catch (e) {
      sshLogger.error("Invalid JSON received", e, {
        operation: "websocket_message_invalid_json",
        userId,
        messageLength: msg.toString().length,
      });
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    const { type, data } = parsed;

    switch (type) {
      case "connectToHost": {
        const connectData = data as ConnectToHostData;
        if (connectData.hostConfig) {
          connectData.hostConfig.userId = userId;
        }
        handleConnectToHost(connectData).catch((error) => {
          sshLogger.error("Failed to connect to host", error, {
            operation: "ssh_connect",
            userId,
            hostId: connectData.hostConfig?.id,
            ip: connectData.hostConfig?.ip,
          });
          ws.send(
            JSON.stringify({
              type: "error",
              message:
                "Failed to connect to host: " +
                (error instanceof Error ? error.message : "Unknown error"),
            }),
          );
        });
        break;
      }

      case "resize": {
        const resizeData = data as ResizeData;
        handleResize(resizeData);
        break;
      }

      case "disconnect":
        cleanupSSH();
        break;

      case "input": {
        const inputData = data as string;
        if (sshStream) {
          if (inputData === "\t") {
            sshStream.write(inputData);
          } else if (
            typeof inputData === "string" &&
            inputData.startsWith("\x1b")
          ) {
            sshStream.write(inputData);
          } else {
            try {
              sshStream.write(Buffer.from(inputData, "utf8"));
            } catch (error) {
              sshLogger.error("Error writing input to SSH stream", error, {
                operation: "ssh_input_encoding",
                userId,
                dataLength: inputData.length,
              });
              sshStream.write(Buffer.from(inputData, "latin1"));
            }
          }
        }
        break;
      }

      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;

      case "totp_response": {
        const totpData = data as TOTPResponseData;
        if (keyboardInteractiveFinish && totpData?.code) {
          if (totpTimeout) {
            clearTimeout(totpTimeout);
            totpTimeout = null;
          }
          const totpCode = totpData.code;
          keyboardInteractiveFinish([totpCode]);
          keyboardInteractiveFinish = null;
          totpPromptSent = false;
        } else {
          sshLogger.warn("TOTP response received but no callback available", {
            operation: "totp_response_error",
            userId,
            hasCallback: !!keyboardInteractiveFinish,
            hasCode: !!totpData?.code,
          });
          ws.send(
            JSON.stringify({
              type: "error",
              message: "TOTP authentication state lost. Please reconnect.",
            }),
          );
        }
        break;
      }

      case "password_response": {
        const passwordData = data as TOTPResponseData;
        if (keyboardInteractiveFinish && passwordData?.code) {
          if (totpTimeout) {
            clearTimeout(totpTimeout);
            totpTimeout = null;
          }
          const password = passwordData.code;
          keyboardInteractiveFinish([password]);
          keyboardInteractiveFinish = null;
        } else {
          sshLogger.warn(
            "Password response received but no callback available",
            {
              operation: "password_response_error",
              userId,
              hasCallback: !!keyboardInteractiveFinish,
              hasCode: !!passwordData?.code,
            },
          );
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Password authentication state lost. Please reconnect.",
            }),
          );
        }
        break;
      }

      case "warpgate_auth_continue": {
        if (keyboardInteractiveFinish) {
          if (warpgateAuthTimeout) {
            clearTimeout(warpgateAuthTimeout);
            warpgateAuthTimeout = null;
          }
          keyboardInteractiveFinish([""]);
          keyboardInteractiveFinish = null;
          warpgateAuthPromptSent = false;
        }
        break;
      }

      case "reconnect_with_credentials": {
        const credentialsData = data as {
          cols: number;
          rows: number;
          hostConfig: ConnectToHostData["hostConfig"];
          password?: string;
          sshKey?: string;
          keyPassword?: string;
        };

        if (credentialsData.password) {
          credentialsData.hostConfig.password = credentialsData.password;
          credentialsData.hostConfig.authType = "password";
          (credentialsData.hostConfig as any).userProvidedPassword = true;
        } else if (credentialsData.sshKey) {
          credentialsData.hostConfig.key = credentialsData.sshKey;
          credentialsData.hostConfig.keyPassword = credentialsData.keyPassword;
          credentialsData.hostConfig.authType = "key";
        }

        isAwaitingAuthCredentials = false;
        cleanupSSH();

        const reconnectData: ConnectToHostData = {
          cols: credentialsData.cols,
          rows: credentialsData.rows,
          hostConfig: credentialsData.hostConfig,
        };

        handleConnectToHost(reconnectData).catch((error) => {
          sshLogger.error("Failed to reconnect with credentials", error, {
            operation: "ssh_reconnect_with_credentials",
            userId,
            hostId: credentialsData.hostConfig?.id,
            ip: credentialsData.hostConfig?.ip,
          });
          ws.send(
            JSON.stringify({
              type: "error",
              message:
                "Failed to connect with provided credentials: " +
                (error instanceof Error ? error.message : "Unknown error"),
            }),
          );
        });
        break;
      }

      case "opkssh_start_auth": {
        const opksshData = data as { hostId: number };
        try {
          const { startOPKSSHAuth, getRequestOrigin } =
            await import("./opkssh-auth.js");
          const db = getDb();
          const hostRow = await db
            .select()
            .from(sshData)
            .where(eq(sshData.id, opksshData.hostId))
            .limit(1);
          if (!hostRow || hostRow.length === 0) {
            sshLogger.error(
              `Host ${opksshData.hostId} not found for OPKSSH auth`,
              {
                operation: "opkssh_start_auth_host_not_found",
                userId,
                hostId: opksshData.hostId,
              },
            );
            ws.send(
              JSON.stringify({
                type: "opkssh_error",
                requestId: "",
                error: "Host not found",
              }),
            );
            break;
          }
          const hostname = hostRow[0].name || hostRow[0].ip;
          const requestOrigin = getRequestOrigin(req);
          await startOPKSSHAuth(
            userId,
            opksshData.hostId,
            hostname,
            ws,
            requestOrigin,
          );
        } catch (error) {
          sshLogger.error("Failed to start OPKSSH auth", error, {
            operation: "opkssh_start_auth_error",
            userId,
            hostId: opksshData.hostId,
          });
          ws.send(
            JSON.stringify({
              type: "opkssh_error",
              requestId: "",
              error: "Failed to start OPKSSH authentication",
            }),
          );
        }
        break;
      }

      case "opkssh_cancel": {
        const cancelData = data as { requestId: string };
        try {
          const { cancelAuthSession } = await import("./opkssh-auth.js");
          cancelAuthSession(cancelData.requestId);
          resetConnectionState();
        } catch (error) {
          sshLogger.error("Failed to cancel OPKSSH auth", error, {
            operation: "opkssh_cancel_error",
            userId,
          });
        }
        break;
      }

      case "opkssh_browser_opened": {
        break;
      }

      case "opkssh_auth_completed": {
        const completedData = data as {
          hostId: number;
          cols?: number;
          rows?: number;
          hostConfig?: any;
        };

        resetConnectionState();

        const reconnectConfig: ConnectToHostData = {
          cols: completedData.cols || 80,
          rows: completedData.rows || 24,
          hostConfig:
            completedData.hostConfig ||
            ({ id: completedData.hostId, userId } as any),
        };

        handleConnectToHost(reconnectConfig).catch((error) => {
          sshLogger.error("Failed to reconnect after OPKSSH auth", error, {
            operation: "opkssh_reconnect_error",
            userId,
            hostId: completedData.hostId,
          });
          ws.send(
            JSON.stringify({
              type: "error",
              message:
                "Failed to connect after authentication: " +
                (error instanceof Error ? error.message : "Unknown error"),
            }),
          );
        });
        break;
      }

      default:
        sshLogger.warn("Unknown message type received", {
          operation: "websocket_message_unknown_type",
          userId,
          messageType: type,
        });
    }
  });

  async function handleConnectToHost(data: ConnectToHostData) {
    const { hostConfig, initialPath, executeCommand } = data;
    const {
      id,
      ip,
      port,
      username,
      password,
      key,
      keyPassword,
      keyType,
      authType,
      credentialId,
    } = hostConfig;
    sshLogger.info("Resolving SSH host configuration", {
      operation: "terminal_host_resolve",
      sessionId,
      userId,
      hostId: id,
    });

    const sendLog = (
      stage: string,
      level: string,
      message: string,
      details?: Record<string, any>,
    ) => {
      ws.send(
        JSON.stringify({
          type: "connection_log",
          data: { stage, level, message, details },
        }),
      );
    };

    if (!username || typeof username !== "string" || username.trim() === "") {
      sshLogger.error("Invalid username provided", undefined, {
        operation: "ssh_connect",
        hostId: id,
        ip,
      });
      ws.send(
        JSON.stringify({ type: "error", message: "Invalid username provided" }),
      );
      return;
    }

    if (!ip || typeof ip !== "string" || ip.trim() === "") {
      sshLogger.error("Invalid IP provided", undefined, {
        operation: "ssh_connect",
        hostId: id,
        username,
      });
      ws.send(
        JSON.stringify({ type: "error", message: "Invalid IP provided" }),
      );
      return;
    }

    if (!port || typeof port !== "number" || port <= 0) {
      sshLogger.error("Invalid port provided", undefined, {
        operation: "ssh_connect",
        hostId: id,
        ip,
        username,
        port,
      });
      ws.send(
        JSON.stringify({ type: "error", message: "Invalid port provided" }),
      );
      return;
    }

    if (isConnecting || isConnected) {
      sshLogger.warn("Connection already in progress or established", {
        operation: "ssh_connect",
        hostId: id,
        isConnecting,
        isConnected,
      });
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Connection already in progress",
          code: "DUPLICATE_CONNECTION",
        }),
      );
      return;
    }

    isConnecting = true;
    sshConn = new Client();

    sendLog("dns", "info", `Starting address resolution of ${ip}`);
    sendLog("tcp", "info", `Connecting to ${ip} port ${port}`);

    const connectionTimeout = setTimeout(() => {
      if (sshConn && isConnecting && !isConnected) {
        sshLogger.error("SSH connection timeout", undefined, {
          operation: "ssh_connect",
          hostId: id,
          ip,
          port,
          username,
        });
        ws.send(
          JSON.stringify({ type: "error", message: "SSH connection timeout" }),
        );
        cleanupSSH(connectionTimeout);
      }
    }, 120000);

    let resolvedCredentials = { password, key, keyPassword, keyType, authType };
    let authMethodNotAvailable = false;
    if (credentialId && id && hostConfig.userId) {
      try {
        const credentials = await SimpleDBOps.select(
          getDb()
            .select()
            .from(sshCredentials)
            .where(
              and(
                eq(sshCredentials.id, credentialId),
                eq(sshCredentials.userId, hostConfig.userId),
              ),
            ),
          "ssh_credentials",
          hostConfig.userId,
        );

        if (credentials.length > 0) {
          const credential = credentials[0];
          resolvedCredentials = {
            password: credential.password as string | undefined,
            key: (credential.private_key ||
              credential.privateKey ||
              credential.key) as string | undefined,
            keyPassword: (credential.key_password || credential.keyPassword) as
              | string
              | undefined,
            keyType: (credential.key_type || credential.keyType) as
              | string
              | undefined,
            authType: (credential.auth_type || credential.authType) as
              | string
              | undefined,
          };
        } else {
          sshLogger.warn(`No credentials found for host ${id}`, {
            operation: "ssh_credentials",
            hostId: id,
            credentialId,
            userId: hostConfig.userId,
          });
        }
      } catch (error) {
        sshLogger.warn(`Failed to resolve credentials for host ${id}`, {
          operation: "ssh_credentials",
          hostId: id,
          credentialId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    } else if (credentialId && id) {
      sshLogger.warn("Missing userId for credential resolution in terminal", {
        operation: "ssh_credentials",
        hostId: id,
        credentialId,
        hasUserId: !!hostConfig.userId,
      });
    }

    sshConn.on("ready", () => {
      clearTimeout(connectionTimeout);
      sshLogger.success("SSH connection established", {
        operation: "terminal_ssh_connected",
        sessionId,
        userId,
        hostId: id,
        ip,
      });
      if (totpPromptSent) {
        authLogger.success("TOTP verification successful for SSH session", {
          operation: "terminal_totp_success",
          sessionId,
          userId,
          hostId: id,
        });
      }
      sendLog("handshake", "success", "SSH handshake completed");
      sendLog("auth", "success", `Authentication successful for ${username}`);
      sendLog("connected", "success", "Connection established");

      const conn = sshConn;

      if (!conn || isCleaningUp || !sshConn) {
        sshLogger.warn(
          "SSH connection was cleaned up before shell could be created",
          {
            operation: "ssh_shell",
            hostId: id,
            ip,
            port,
            username,
            isCleaningUp,
            connNull: !conn,
            sshConnNull: !sshConn,
          },
        );
        ws.send(
          JSON.stringify({
            type: "error",
            message:
              "SSH connection was closed before terminal could be created",
          }),
        );
        return;
      }

      isShellInitializing = true;
      isConnecting = false;
      isConnected = true;

      if (!sshConn) {
        sshLogger.error(
          "SSH connection became null right before shell creation",
          {
            operation: "ssh_shell",
            hostId: id,
          },
        );
        ws.send(
          JSON.stringify({
            type: "error",
            message: "SSH connection lost during setup",
          }),
        );
        isShellInitializing = false;
        return;
      }

      sshLogger.info("Creating shell", {
        operation: "ssh_shell_start",
        hostId: id,
        ip,
        port,
        username,
      });

      let shellCallbackReceived = false;
      const shellTimeout = setTimeout(() => {
        if (!shellCallbackReceived && isShellInitializing) {
          sshLogger.error("Shell creation timeout - no response from server", {
            operation: "ssh_shell_timeout",
            hostId: id,
            ip,
            port,
            username,
          });
          isShellInitializing = false;
          ws.send(
            JSON.stringify({
              type: "error",
              message:
                "Shell creation timeout. The server may not support interactive shells or the connection was interrupted.",
            }),
          );
          cleanupSSH(connectionTimeout);
        }
      }, 15000);

      conn.shell(
        {
          rows: data.rows,
          cols: data.cols,
          term: "xterm-256color",
        } as PseudoTtyOptions,
        (err, stream) => {
          shellCallbackReceived = true;
          clearTimeout(shellTimeout);
          isShellInitializing = false;

          if (err) {
            sshLogger.error("Shell error", err, {
              operation: "ssh_shell",
              hostId: id,
              ip,
              port,
              username,
            });
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Shell error: " + err.message,
              }),
            );
            cleanupSSH(connectionTimeout);
            return;
          }

          sshStream = stream;
          sshLogger.success("Terminal shell channel opened", {
            operation: "terminal_shell_opened",
            sessionId,
            userId,
            hostId: id,
            termType: "xterm-256color",
          });

          stream.on("data", (data: Buffer) => {
            try {
              const utf8String = data.toString("utf-8");
              ws.send(JSON.stringify({ type: "data", data: utf8String }));
            } catch (error) {
              sshLogger.error("Error encoding terminal data", error, {
                operation: "terminal_data_encoding",
                hostId: id,
                dataLength: data.length,
              });
              ws.send(
                JSON.stringify({
                  type: "data",
                  data: data.toString("latin1"),
                }),
              );
            }
          });

          stream.on("close", () => {
            ws.send(
              JSON.stringify({
                type: "disconnected",
                message: "Connection lost",
              }),
            );
          });

          stream.on("error", (err: Error) => {
            sshLogger.error("SSH stream error", err, {
              operation: "ssh_stream",
              hostId: id,
              ip,
              port,
              username,
            });
            ws.send(
              JSON.stringify({
                type: "error",
                message: "SSH stream error: " + err.message,
              }),
            );
          });

          if (initialPath && initialPath.trim() !== "") {
            const cdCommand = `cd "${initialPath.replace(/"/g, '\\"')}" && pwd\n`;
            stream.write(cdCommand);
          }

          if (executeCommand && executeCommand.trim() !== "") {
            setTimeout(() => {
              const command = `${executeCommand}\n`;
              stream.write(command);
            }, 500);
          }

          ws.send(
            JSON.stringify({ type: "connected", message: "SSH connected" }),
          );

          if (id && hostConfig.userId) {
            (async () => {
              try {
                const hosts = await SimpleDBOps.select(
                  getDb()
                    .select()
                    .from(sshData)
                    .where(
                      and(
                        eq(sshData.id, id),
                        eq(sshData.userId, hostConfig.userId!),
                      ),
                    ),
                  "ssh_data",
                  hostConfig.userId!,
                );

                const hostName =
                  hosts.length > 0 && hosts[0].name
                    ? hosts[0].name
                    : `${username}@${ip}:${port}`;

                await axios.post(
                  "http://localhost:30006/activity/log",
                  {
                    type: "terminal",
                    hostId: id,
                    hostName,
                  },
                  {
                    headers: {
                      Authorization: `Bearer ${await authManager.generateJWTToken(hostConfig.userId!)}`,
                    },
                  },
                );
              } catch (error) {
                sshLogger.warn("Failed to log terminal activity", {
                  operation: "activity_log_error",
                  userId: hostConfig.userId,
                  hostId: id,
                  error:
                    error instanceof Error ? error.message : "Unknown error",
                });
              }
            })();
          }
        },
      );
    });

    sshConn.on("error", (err: Error) => {
      clearTimeout(connectionTimeout);

      sendLog("error", "error", `Connection error: ${err.message}`);

      sshLogger.error("SSH connection error", err, {
        operation: "ssh_connect",
        hostId: id,
        ip,
        port,
        username,
        authType: resolvedCredentials.authType,
        warpgateAuthPromptSent,
        isKeyboardInteractive,
        hasKeyboardInteractiveFinish: !!keyboardInteractiveFinish,
        keyboardInteractiveResponded,
      });

      if (
        authMethodNotAvailable &&
        resolvedCredentials.authType === "none" &&
        !isKeyboardInteractive
      ) {
        sendLog(
          "auth",
          "error",
          "Server does not support keyboard-interactive authentication",
        );
        clearTimeout(connectionTimeout);
        isAwaitingAuthCredentials = true;
        if (sshConn) {
          try {
            sshConn.end();
          } catch (e) {}
          sshConn = null;
        }
        resetConnectionState();
        ws.send(
          JSON.stringify({
            type: "auth_method_not_available",
            message:
              "The server does not support keyboard-interactive authentication. Please provide credentials.",
          }),
        );
        return;
      }

      if (
        resolvedCredentials.authType === "none" &&
        err.message.includes("All configured authentication methods failed") &&
        !isKeyboardInteractive &&
        !keyboardInteractiveResponded
      ) {
        clearTimeout(connectionTimeout);
        isAwaitingAuthCredentials = true;
        if (sshConn) {
          try {
            sshConn.end();
          } catch (e) {}
          sshConn = null;
        }
        resetConnectionState();
        ws.send(
          JSON.stringify({
            type: "auth_method_not_available",
            message:
              "The server does not support keyboard-interactive authentication. Please provide credentials.",
          }),
        );
        return;
      }

      if (
        isKeyboardInteractive &&
        keyboardInteractiveFinish &&
        err.message.includes("All configured authentication methods failed")
      ) {
        sshLogger.warn(
          "Authentication error during keyboard-interactive - SKIPPING cleanup, waiting for user response",
          {
            operation: "ssh_error_during_keyboard_interactive_skip_cleanup",
            hostId: id,
            error: err.message,
          },
        );
        resetConnectionState();
        return;
      }

      sshLogger.error("Proceeding with cleanup after error", {
        operation: "ssh_error_cleanup",
        hostId: id,
        error: err.message,
      });

      if (
        err.message.includes("authentication") ||
        err.message.includes("Authentication")
      ) {
        authLogger.error("SSH authentication failed", err, {
          operation: "terminal_ssh_auth_failed",
          sessionId,
          userId,
          hostId: id,
          authType: resolvedCredentials.authType,
        });
        sendLog("auth", "error", `Authentication failed: ${err.message}`);
      } else {
        sendLog("error", "error", `Connection failed: ${err.message}`);
      }

      let errorMessage = "SSH error: " + err.message;
      if (err.message.includes("No matching key exchange algorithm")) {
        errorMessage =
          "SSH error: No compatible key exchange algorithm found. This may be due to an older SSH server or network device.";
      } else if (err.message.includes("No matching cipher")) {
        errorMessage =
          "SSH error: No compatible cipher found. This may be due to an older SSH server or network device.";
      } else if (err.message.includes("No matching MAC")) {
        errorMessage =
          "SSH error: No compatible MAC algorithm found. This may be due to an older SSH server or network device.";
      } else if (
        err.message.includes("ENOTFOUND") ||
        err.message.includes("ENOENT")
      ) {
        errorMessage =
          "SSH error: Could not resolve hostname or connect to server.";
      } else if (err.message.includes("ECONNREFUSED")) {
        errorMessage =
          "SSH error: Connection refused. The server may not be running or the port may be incorrect.";
      } else if (err.message.includes("ETIMEDOUT")) {
        errorMessage =
          "SSH error: Connection timed out. Check your network connection and server availability.";
      } else if (
        err.message.includes("ECONNRESET") ||
        err.message.includes("EPIPE")
      ) {
        errorMessage =
          "SSH error: Connection was reset. This may be due to network issues or server timeout.";
      } else if (
        err.message.includes("authentication failed") ||
        err.message.includes("Permission denied")
      ) {
        errorMessage =
          "SSH error: Authentication failed. Please check your username and password/key.";
      }

      ws.send(JSON.stringify({ type: "error", message: errorMessage }));
      cleanupSSH(connectionTimeout);
    });

    sshConn.on("close", () => {
      clearTimeout(connectionTimeout);
      sshLogger.info("SSH connection closed", {
        operation: "terminal_ssh_disconnected",
        sessionId,
        userId,
        hostId: id,
      });

      if (isAwaitingAuthCredentials) {
        cleanupSSH(connectionTimeout);
        return;
      }

      if (isShellInitializing || (isConnected && !sshStream)) {
        sshLogger.warn("SSH connection closed during shell initialization", {
          operation: "ssh_close_during_init",
          hostId: id,
          ip,
          port,
          username,
          isShellInitializing,
          hasStream: !!sshStream,
        });
        ws.send(
          JSON.stringify({
            type: "error",
            message:
              "Connection closed during shell initialization. The server may have rejected the shell request.",
          }),
        );
      } else if (!sshStream) {
        ws.send(
          JSON.stringify({
            type: "disconnected",
            message: "Connection closed",
          }),
        );
      }
      cleanupSSH(connectionTimeout);
    });

    const sshAuthManager = new SSHAuthManager({
      userId,
      ws,
      hostId: id || 0,
      isKeyboardInteractive,
      keyboardInteractiveResponded,
      keyboardInteractiveFinish,
      totpPromptSent,
      warpgateAuthPromptSent,
      totpTimeout,
      warpgateAuthTimeout,
      totpAttempts: 0,
    });

    sshConn.on(
      "keyboard-interactive",
      (
        name: string,
        instructions: string,
        instructionsLang: string,
        prompts: Array<{ prompt: string; echo: boolean }>,
        finish: (responses: string[]) => void,
      ) => {
        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
        }

        sshAuthManager.handleKeyboardInteractive(
          name,
          instructions,
          instructionsLang,
          prompts,
          finish,
          resolvedCredentials as any,
        );

        isKeyboardInteractive = sshAuthManager.context.isKeyboardInteractive;
        keyboardInteractiveResponded =
          sshAuthManager.context.keyboardInteractiveResponded;
        keyboardInteractiveFinish =
          sshAuthManager.context.keyboardInteractiveFinish;
        totpPromptSent = sshAuthManager.context.totpPromptSent;
        warpgateAuthPromptSent = sshAuthManager.context.warpgateAuthPromptSent;
        totpTimeout = sshAuthManager.context.totpTimeout;
        warpgateAuthTimeout = sshAuthManager.context.warpgateAuthTimeout;
      },
    );

    const connectConfig: any = {
      host: ip,
      port,
      username,
      tryKeyboard: true,
      keepaliveInterval: 30000,
      keepaliveCountMax: 3,
      readyTimeout: 120000,
      tcpKeepAlive: true,
      tcpKeepAliveInitialDelay: 30000,
      timeout: 120000,
      hostVerifier: await SSHHostKeyVerifier.createHostVerifier(
        id,
        ip,
        port,
        ws,
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
          "diffie-hellman-group18-sha512",
          "diffie-hellman-group17-sha512",
          "diffie-hellman-group16-sha512",
          "diffie-hellman-group15-sha512",
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

    if (resolvedCredentials.authType === "none") {
    } else if (resolvedCredentials.authType === "password") {
      if (!resolvedCredentials.password) {
        sshLogger.error(
          "Password authentication requested but no password provided",
        );
        ws.send(
          JSON.stringify({
            type: "error",
            message:
              "Password authentication requested but no password provided",
          }),
        );
        return;
      }

      if (!hostConfig.forceKeyboardInteractive) {
        connectConfig.password = resolvedCredentials.password;
      }
      sendLog("auth", "info", "Using password authentication");
    } else if (
      resolvedCredentials.authType === "key" &&
      resolvedCredentials.key
    ) {
      sendLog("auth", "info", "Using SSH key authentication");
      try {
        if (
          !resolvedCredentials.key.includes("-----BEGIN") ||
          !resolvedCredentials.key.includes("-----END")
        ) {
          throw new Error("Invalid private key format");
        }

        const cleanKey = resolvedCredentials.key
          .trim()
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n");

        connectConfig.privateKey = Buffer.from(cleanKey, "utf8");

        if (resolvedCredentials.keyPassword) {
          connectConfig.passphrase = resolvedCredentials.keyPassword;
        }
      } catch (keyError) {
        sshLogger.error("SSH key format error: " + keyError.message);
        ws.send(
          JSON.stringify({
            type: "error",
            message: "SSH key format error: Invalid private key format",
          }),
        );
        return;
      }
    } else if (resolvedCredentials.authType === "key") {
      sendLog(
        "auth",
        "error",
        "SSH key authentication requested but no key provided",
      );
      sshLogger.error("SSH key authentication requested but no key provided");
      ws.send(
        JSON.stringify({
          type: "error",
          message: "SSH key authentication requested but no key provided",
        }),
      );
      return;
    } else if (resolvedCredentials.authType === "opkssh") {
      sendLog("auth", "info", "Using OPKSSH certificate authentication");
      try {
        const { getOPKSSHToken } = await import("./opkssh-auth.js");
        const token = await getOPKSSHToken(userId, id);

        if (!token) {
          sendLog(
            "auth",
            "info",
            "No valid OPKSSH token found, requesting authentication",
          );
          ws.send(
            JSON.stringify({
              type: "opkssh_auth_required",
              hostId: id,
            }),
          );
          return;
        }

        sendLog("auth", "info", "Using cached OPKSSH certificate");

        const { promises: fs } = await import("fs");
        const path = await import("path");
        const os = await import("os");

        const tempDir = os.tmpdir();
        const keyPath = path.join(tempDir, `opkssh-${userId}-${id}`);
        const certPath = `${keyPath}-cert.pub`;

        await fs.writeFile(keyPath, token.privateKey, { mode: 0o600 });
        await fs.writeFile(certPath, token.sshCert, { mode: 0o600 });

        opksshTempFiles = { keyPath, certPath };
        connectConfig.privateKey = await fs.readFile(keyPath);
      } catch (opksshError) {
        sshLogger.error("OPKSSH authentication error", opksshError, {
          operation: "opkssh_auth_error",
          userId,
          hostId: id,
        });
        ws.send(
          JSON.stringify({
            type: "error",
            message:
              "OPKSSH authentication failed: " +
              (opksshError instanceof Error
                ? opksshError.message
                : "Unknown error"),
          }),
        );
        return;
      }
    } else {
      sendLog("auth", "info", "Using keyboard-interactive authentication");
      sshLogger.error("No valid authentication method provided");
      ws.send(
        JSON.stringify({
          type: "error",
          message: "No valid authentication method provided",
        }),
      );
      return;
    }

    if (
      hostConfig.useSocks5 &&
      (hostConfig.socks5Host ||
        (hostConfig.socks5ProxyChain &&
          (hostConfig.socks5ProxyChain as any).length > 0))
    ) {
      try {
        const socks5Socket = await createSocks5Connection(ip, port, {
          useSocks5: hostConfig.useSocks5,
          socks5Host: hostConfig.socks5Host,
          socks5Port: hostConfig.socks5Port,
          socks5Username: hostConfig.socks5Username,
          socks5Password: hostConfig.socks5Password,
          socks5ProxyChain: hostConfig.socks5ProxyChain as any,
        });

        if (socks5Socket) {
          connectConfig.sock = socks5Socket;
          sshConn.connect(connectConfig);
          return;
        }
      } catch (socks5Error) {
        sshLogger.error("SOCKS5 connection failed", socks5Error, {
          operation: "socks5_connect",
          hostId: id,
          proxyHost: hostConfig.socks5Host,
          proxyPort: hostConfig.socks5Port || 1080,
        });
        ws.send(
          JSON.stringify({
            type: "error",
            message:
              "SOCKS5 proxy connection failed: " +
              (socks5Error instanceof Error
                ? socks5Error.message
                : "Unknown error"),
          }),
        );
        cleanupSSH(connectionTimeout);
        return;
      }
    }

    if (
      hostConfig.jumpHosts &&
      hostConfig.jumpHosts.length > 0 &&
      hostConfig.userId
    ) {
      try {
        const jumpClient = await createJumpHostChain(
          hostConfig.jumpHosts,
          hostConfig.userId,
        );

        if (!jumpClient) {
          sshLogger.error("Failed to establish jump host chain");
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Failed to connect through jump hosts",
            }),
          );
          cleanupSSH(connectionTimeout);
          return;
        }

        jumpClient.forwardOut("127.0.0.1", 0, ip, port, (err, stream) => {
          if (err) {
            sshLogger.error("Failed to forward through jump host", err, {
              operation: "ssh_jump_forward",
              hostId: id,
              ip,
              port,
            });
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Failed to forward through jump host: " + err.message,
              }),
            );
            jumpClient.end();
            cleanupSSH(connectionTimeout);
            return;
          }

          connectConfig.sock = stream;
          sendLog(
            "handshake",
            "info",
            "Starting SSH session through jump host",
          );
          sendLog("auth", "info", `Authenticating as ${username}`);
          sshLogger.info("Initiating SSH connection", {
            operation: "terminal_ssh_connect_attempt",
            sessionId,
            userId,
            hostId: id,
            ip,
            port,
            username,
            authType: resolvedCredentials.authType,
          });
          sshConn.connect(connectConfig);
        });
      } catch (error) {
        sshLogger.error("Jump host error", error, {
          operation: "ssh_jump_host",
          hostId: id,
        });
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Failed to connect through jump hosts",
          }),
        );
        cleanupSSH(connectionTimeout);
        return;
      }
    } else {
      sendLog("handshake", "info", "Starting SSH session");
      sendLog("auth", "info", `Authenticating as ${username}`);
      sshLogger.info("Initiating SSH connection", {
        operation: "terminal_ssh_connect_attempt",
        sessionId,
        userId,
        hostId: id,
        ip,
        port,
        username,
        authType: resolvedCredentials.authType,
      });
      sshConn.connect(connectConfig);
    }
  }

  function handleResize(data: ResizeData) {
    if (sshStream && sshStream.setWindow) {
      sshStream.setWindow(data.rows, data.cols, data.rows, data.cols);
      ws.send(
        JSON.stringify({ type: "resized", cols: data.cols, rows: data.rows }),
      );
    }
  }

  function cleanupSSH(timeoutId?: NodeJS.Timeout) {
    if (isCleaningUp) {
      return;
    }

    if (isShellInitializing) {
      sshLogger.warn(
        "Cleanup attempted during shell initialization, deferring",
        {
          operation: "cleanup_deferred",
          userId,
        },
      );
      setTimeout(() => cleanupSSH(timeoutId), 100);
      return;
    }

    isCleaningUp = true;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (totpTimeout) {
      clearTimeout(totpTimeout);
      totpTimeout = null;
    }

    if (warpgateAuthTimeout) {
      clearTimeout(warpgateAuthTimeout);
      warpgateAuthTimeout = null;
    }

    if (sshStream) {
      try {
        sshStream.end();
      } catch (e: unknown) {
        sshLogger.error(
          "Error closing stream: " +
            (e instanceof Error ? e.message : "Unknown error"),
        );
      }
      sshStream = null;
    }

    if (sshConn) {
      try {
        sshConn.end();
      } catch (e: unknown) {
        sshLogger.error(
          "Error closing connection: " +
            (e instanceof Error ? e.message : "Unknown error"),
        );
      }
      sshConn = null;
    }

    resetConnectionState();
    isCleaningUp = false;
    isAwaitingAuthCredentials = false;

    if (opksshTempFiles) {
      (async () => {
        try {
          const { promises: fs } = await import("fs");
          await fs.unlink(opksshTempFiles.keyPath).catch(() => {});
          await fs.unlink(opksshTempFiles.certPath).catch(() => {});
        } catch {}
      })();
      opksshTempFiles = null;
    }
  }

  // Note: PTY-level keepalive (writing \x00 to the stream) was removed.
  // It was causing ^@ characters to appear in terminals with echoctl enabled.
  // SSH-level keepalive is configured via connectConfig (keepaliveInterval,
  // keepaliveCountMax, tcpKeepAlive), which handles connection health monitoring
  // without producing visible output on the terminal.
  //
  // See: https://github.com/Termix-SSH/Support/issues/232
  // See: https://github.com/Termix-SSH/Support/issues/309
});
