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

const wss = new WebSocketServer({
  port: 30002,
  verifyClient: async (info) => {
    try {
      const url = parseUrl(info.req.url!, true);
      const token = url.query.token as string;

      if (!token) {
        sshLogger.warn("WebSocket connection rejected: missing token", {
          operation: "websocket_auth_reject",
          reason: "missing_token",
          ip: info.req.socket.remoteAddress,
        });
        return false;
      }

      const payload = await authManager.verifyJWTToken(token);

      if (!payload) {
        sshLogger.warn("WebSocket connection rejected: invalid token", {
          operation: "websocket_auth_reject",
          reason: "invalid_token",
          ip: info.req.socket.remoteAddress,
        });
        return false;
      }

      if (payload.pendingTOTP) {
        sshLogger.warn(
          "WebSocket connection rejected: TOTP verification pending",
          {
            operation: "websocket_auth_reject",
            reason: "totp_pending",
            userId: payload.userId,
            ip: info.req.socket.remoteAddress,
          },
        );
        return false;
      }

      const existingConnections = userConnections.get(payload.userId);
      if (existingConnections && existingConnections.size >= 3) {
        sshLogger.warn("WebSocket connection rejected: too many connections", {
          operation: "websocket_auth_reject",
          reason: "connection_limit",
          userId: payload.userId,
          currentConnections: existingConnections.size,
          ip: info.req.socket.remoteAddress,
        });
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
      sshLogger.warn(
        "WebSocket connection rejected: missing token in connection",
        {
          operation: "websocket_connection_reject",
          reason: "missing_token",
          ip: req.socket.remoteAddress,
        },
      );
      ws.close(1008, "Authentication required");
      return;
    }

    const payload = await authManager.verifyJWTToken(token);
    if (!payload) {
      sshLogger.warn(
        "WebSocket connection rejected: invalid token in connection",
        {
          operation: "websocket_connection_reject",
          reason: "invalid_token",
          ip: req.socket.remoteAddress,
        },
      );
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
    sshLogger.warn("WebSocket connection rejected: data locked", {
      operation: "websocket_data_locked",
      userId,
      ip: req.socket.remoteAddress,
    });
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
  let pingInterval: NodeJS.Timeout | null = null;
  let keyboardInteractiveFinish: ((responses: string[]) => void) | null = null;
  let totpPromptSent = false;
  let keyboardInteractiveResponded = false;

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
      sshLogger.warn("WebSocket message rejected: data access expired", {
        operation: "websocket_message_rejected",
        userId,
        reason: "data_access_expired",
      });
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
          sshLogger.info("TOTP code received from user", {
            operation: "totp_response",
            userId,
            codeLength: totpCode.length,
          });

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

    sshConn = new Client();

    const connectionTimeout = setTimeout(() => {
      if (sshConn) {
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
    }, 60000);

    let resolvedCredentials = { password, key, keyPassword, keyType, authType };
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

      // Small delay to let connection stabilize after keyboard-interactive auth
      // This helps prevent "No response from server" errors with TOTP
      setTimeout(() => {
        // Check if connection still exists (might have been cleaned up)
        if (!sshConn) {
          sshLogger.warn(
            "SSH connection was cleaned up before shell could be created",
            {
              operation: "ssh_shell",
              hostId: id,
              ip,
              port,
              username,
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

        sshConn.shell(
          {
            rows: data.rows,
            cols: data.cols,
            term: "xterm-256color",
          } as PseudoTtyOptions,
          (err, stream) => {
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

            setupPingInterval();

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

            // Log activity to dashboard API
            if (id && hostConfig.userId) {
              (async () => {
                try {
                  // Fetch host name from database
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

                  sshLogger.info("Terminal activity logged", {
                    operation: "activity_log",
                    userId: hostConfig.userId,
                    hostId: id,
                    hostName,
                  });
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
      }, 100); // Small delay to stabilize connection after keyboard-interactive auth
    });

    sshConn.on("error", (err: Error) => {
      clearTimeout(connectionTimeout);
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
        const promptTexts = prompts.map((p) => p.prompt);
        sshLogger.info("Keyboard-interactive authentication requested", {
          operation: "ssh_keyboard_interactive",
          hostId: id,
          promptsCount: prompts.length,
          instructions: instructions || "none",
        });
        console.log(
          `[SSH Keyboard-Interactive] Host ${id}: ${prompts.length} prompts:`,
          promptTexts,
        );

        const totpPromptIndex = prompts.findIndex((p) =>
          /verification code|verification_code|token|otp|2fa|authenticator|google.*auth/i.test(
            p.prompt,
          ),
        );

        if (totpPromptIndex !== -1) {
          // TOTP prompt detected - need user input
          if (totpPromptSent) {
            sshLogger.warn("TOTP prompt already sent, ignoring duplicate", {
              operation: "ssh_keyboard_interactive",
              hostId: id,
            });
            return;
          }
          totpPromptSent = true;
          keyboardInteractiveResponded = true;

          keyboardInteractiveFinish = (totpResponses: string[]) => {
            const totpCode = (totpResponses[0] || "").trim();

            // Respond to ALL prompts, not just TOTP
            const responses = prompts.map((p, index) => {
              if (index === totpPromptIndex) {
                return totpCode;
              }
              if (/password/i.test(p.prompt) && resolvedCredentials.password) {
                return resolvedCredentials.password;
              }
              return "";
            });

            sshLogger.info("TOTP response being sent to SSH server", {
              operation: "totp_verification",
              hostId: id,
              totpCodeLength: totpCode.length,
              totalPrompts: prompts.length,
              responsesProvided: responses.filter((r) => r !== "").length,
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
          // Non-TOTP prompts (password, etc.) - respond automatically
          if (keyboardInteractiveResponded) {
            sshLogger.warn(
              "Already responded to keyboard-interactive, ignoring subsequent prompt",
              {
                operation: "ssh_keyboard_interactive",
                hostId: id,
                prompts: promptTexts,
              },
            );
            return;
          }
          keyboardInteractiveResponded = true;

          const responses = prompts.map((p) => {
            if (/password/i.test(p.prompt) && resolvedCredentials.password) {
              return resolvedCredentials.password;
            }
            return "";
          });

          sshLogger.info("Responding to keyboard-interactive prompts", {
            operation: "ssh_keyboard_interactive_response",
            hostId: id,
            hasPassword: !!resolvedCredentials.password,
            responsesProvided: responses.filter((r) => r !== "").length,
            totalPrompts: prompts.length,
            prompts: promptTexts,
          });

          console.log(
            `[SSH Auto Response] Host ${id}: Sending ${responses.length} responses, ${responses.filter((r) => r !== "").length} non-empty`,
          );
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
        serverHostKey: [
          "ssh-rsa",
          "rsa-sha2-256",
          "rsa-sha2-512",
          "ecdsa-sha2-nistp256",
          "ecdsa-sha2-nistp384",
          "ecdsa-sha2-nistp521",
          "ssh-ed25519",
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

    if (resolvedCredentials.authType === "key" && resolvedCredentials.key) {
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
      // Set password to offer both password and keyboard-interactive methods
      connectConfig.password = resolvedCredentials.password;
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

    sshConn.connect(connectConfig);
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
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
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
    keyboardInteractiveResponded = false;
    keyboardInteractiveFinish = null;
  }

  function setupPingInterval() {
    pingInterval = setInterval(() => {
      if (sshConn && sshStream) {
        try {
          sshStream.write("\x00");
        } catch (e: unknown) {
          sshLogger.error(
            "SSH keepalive failed: " +
              (e instanceof Error ? e.message : "Unknown error"),
          );
          cleanupSSH();
        }
      }
    }, 60000);
  }
});
