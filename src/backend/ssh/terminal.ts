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
import { sshLogger } from "../utils/logger.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { AuthManager } from "../utils/auth-manager.js";
import { UserCrypto } from "../utils/user-crypto.js";
import { createSocks5Connection } from "../utils/socks5-helper.js";

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

  let sshConn: Client | null = null;
  let sshStream: ClientChannel | null = null;
  let keyboardInteractiveFinish: ((responses: string[]) => void) | null = null;
  let totpPromptSent = false;
  let isKeyboardInteractive = false;
  let keyboardInteractiveResponded = false;
  let isConnecting = false;
  let isConnected = false;
  let isCleaningUp = false;
  let isShellInitializing = false;

  ws.on("close", () => {
    const userWs = userConnections.get(userId);
    if (userWs) {
      userWs.delete(ws);
      if (userWs.size === 0) {
        userConnections.delete(userId);
      }
    }

    cleanupSSH();
  });

  ws.on("message", (msg: RawData) => {
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
          const totpCode = totpData.code;
          keyboardInteractiveFinish([totpCode]);
          keyboardInteractiveFinish = null;
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
      return;
    }

    isConnecting = true;
    sshConn = new Client();

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
    }, 30000);

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

      conn.shell(
        {
          rows: data.rows,
          cols: data.cols,
          term: "xterm-256color",
        } as PseudoTtyOptions,
        (err, stream) => {
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
            return;
          }

          sshStream = stream;

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

      if (
        (authMethodNotAvailable && resolvedCredentials.authType === "none") ||
        (resolvedCredentials.authType === "none" &&
          err.message.includes("All configured authentication methods failed"))
      ) {
        ws.send(
          JSON.stringify({
            type: "auth_method_not_available",
            message:
              "The server does not support keyboard-interactive authentication. Please provide credentials.",
          }),
        );
        cleanupSSH(connectionTimeout);
        return;
      }

      sshLogger.error("SSH connection error", err, {
        operation: "ssh_connect",
        hostId: id,
        ip,
        port,
        username,
        authType: resolvedCredentials.authType,
      });

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
      cleanupSSH(connectionTimeout);
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
        isKeyboardInteractive = true;
        const promptTexts = prompts.map((p) => p.prompt);
        const totpPromptIndex = prompts.findIndex((p) =>
          /verification code|verification_code|token|otp|2fa|authenticator|google.*auth/i.test(
            p.prompt,
          ),
        );

        if (totpPromptIndex !== -1) {
          if (totpPromptSent) {
            sshLogger.warn("TOTP prompt asked again - ignoring duplicate", {
              operation: "ssh_keyboard_interactive_totp_duplicate",
              hostId: id,
              prompts: promptTexts,
            });
            return;
          }
          totpPromptSent = true;
          keyboardInteractiveResponded = true;

          keyboardInteractiveFinish = (totpResponses: string[]) => {
            const totpCode = (totpResponses[0] || "").trim();

            const responses = prompts.map((p, index) => {
              if (index === totpPromptIndex) {
                return totpCode;
              }
              if (/password/i.test(p.prompt) && resolvedCredentials.password) {
                return resolvedCredentials.password;
              }
              return "";
            });

            finish(responses);
          };
          ws.send(
            JSON.stringify({
              type: "totp_required",
              prompt: prompts[totpPromptIndex].prompt,
            }),
          );
        } else {
          const hasStoredPassword =
            resolvedCredentials.password &&
            resolvedCredentials.authType !== "none";

          const passwordPromptIndex = prompts.findIndex((p) =>
            /password/i.test(p.prompt),
          );

          if (!hasStoredPassword && passwordPromptIndex !== -1) {
            if (keyboardInteractiveResponded) {
              return;
            }
            keyboardInteractiveResponded = true;

            keyboardInteractiveFinish = (userResponses: string[]) => {
              const userInput = (userResponses[0] || "").trim();

              const responses = prompts.map((p, index) => {
                if (index === passwordPromptIndex) {
                  return userInput;
                }
                return "";
              });

              finish(responses);
            };

            ws.send(
              JSON.stringify({
                type: "password_required",
                prompt: prompts[passwordPromptIndex].prompt,
              }),
            );
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

    const connectConfig: any = {
      host: ip,
      port,
      username,
      tryKeyboard: true,
      keepaliveInterval: 30000,
      keepaliveCountMax: 3,
      readyTimeout: 30000,
      tcpKeepAlive: true,
      tcpKeepAliveInitialDelay: 30000,
      timeout: 30000,
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
    } else if (
      resolvedCredentials.authType === "key" &&
      resolvedCredentials.key
    ) {
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
      sshLogger.error("SSH key authentication requested but no key provided");
      ws.send(
        JSON.stringify({
          type: "error",
          message: "SSH key authentication requested but no key provided",
        }),
      );
      return;
    } else {
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

    totpPromptSent = false;
    isKeyboardInteractive = false;
    keyboardInteractiveResponded = false;
    keyboardInteractiveFinish = null;
    isConnecting = false;
    isConnected = false;

    setTimeout(() => {
      isCleaningUp = false;
    }, 100);
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
