import { WebSocketServer, WebSocket, type RawData } from "ws";
import { Client, type ClientChannel, type PseudoTtyOptions } from "ssh2";
import { db } from "../database/db/index.js";
import { sshCredentials } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { sshLogger } from "../utils/logger.js";
import { EncryptedDBOperations } from "../utils/encrypted-db-operations.js";

const wss = new WebSocketServer({ port: 8082 });

sshLogger.success("SSH Terminal WebSocket server started", {
  operation: "server_start",
  port: 8082,
});

wss.on("connection", (ws: WebSocket) => {
  let sshConn: Client | null = null;
  let sshStream: ClientChannel | null = null;
  let pingInterval: NodeJS.Timeout | null = null;

  ws.on("close", () => {
    cleanupSSH();
  });

  ws.on("message", (msg: RawData) => {
    let parsed: any;
    try {
      parsed = JSON.parse(msg.toString());
    } catch (e) {
      sshLogger.error("Invalid JSON received", e, {
        operation: "websocket_message",
        messageLength: msg.toString().length,
      });
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    const { type, data } = parsed;

    switch (type) {
      case "connectToHost":
        handleConnectToHost(data).catch((error) => {
          sshLogger.error("Failed to connect to host", error, {
            operation: "ssh_connect",
            hostId: data.hostConfig?.id,
            ip: data.hostConfig?.ip,
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

      case "resize":
        handleResize(data);
        break;

      case "disconnect":
        cleanupSSH();
        break;

      case "input":
        if (sshStream) {
          if (data === "\t") {
            sshStream.write(data);
          } else if (data.startsWith("\x1b")) {
            sshStream.write(data);
          } else {
            sshStream.write(Buffer.from(data, "utf8"));
          }
        }
        break;

      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;

      default:
        sshLogger.warn("Unknown message type received", {
          operation: "websocket_message",
          messageType: type,
        });
    }
  });

  async function handleConnectToHost(data: {
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
  }) {
    const { cols, rows, hostConfig, initialPath, executeCommand } = data;
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

    sshLogger.debug(`Terminal SSH setup`, {
      operation: "terminal_ssh",
      hostId: id,
      ip,
      authType,
      hasPassword: !!password,
      passwordLength: password?.length || 0,
      hasCredentialId: !!credentialId,
    });

    if (password) {
      sshLogger.debug(`Password preview: "${password.substring(0, 15)}..."`, {
        operation: "terminal_ssh_password",
      });
    } else {
      sshLogger.debug(`No password provided`, {
        operation: "terminal_ssh_password",
      });
    }

    let resolvedCredentials = { password, key, keyPassword, keyType, authType };
    if (credentialId && id && hostConfig.userId) {
      try {
        const credentials = await EncryptedDBOperations.select(
          db
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
            password: credential.password,
            key: credential.privateKey || credential.key, // prefer new privateKey field
            keyPassword: credential.keyPassword,
            keyType: credential.keyType,
            authType: credential.authType,
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

      sshConn!.shell(
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
            ws.send(JSON.stringify({ type: "data", data: data.toString() }));
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

          // Change to initial path if specified
          if (initialPath && initialPath.trim() !== "") {
            sshLogger.debug(`Changing to initial path: ${initialPath}`, {
              operation: "ssh_initial_path",
              hostId: id,
              path: initialPath,
            });

            // Send cd command to change directory
            const cdCommand = `cd "${initialPath.replace(/"/g, '\\"')}" && pwd\n`;
            stream.write(cdCommand);
          }

          // Execute command if specified
          if (executeCommand && executeCommand.trim() !== "") {
            sshLogger.debug(`Executing command: ${executeCommand}`, {
              operation: "ssh_execute_command",
              hostId: id,
              command: executeCommand,
            });

            // Wait a moment for the cd command to complete, then execute the command
            setTimeout(() => {
              const command = `${executeCommand}\n`;
              stream.write(command);
            }, 500);
          }

          ws.send(
            JSON.stringify({ type: "connected", message: "SSH connected" }),
          );
        },
      );
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

    const connectConfig: any = {
      host: ip,
      port,
      username,
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
        hmac: ["hmac-sha2-256", "hmac-sha2-512", "hmac-sha1", "hmac-md5"],
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

        if (
          resolvedCredentials.keyType &&
          resolvedCredentials.keyType !== "auto"
        ) {
          connectConfig.privateKeyType = resolvedCredentials.keyType;
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
      connectConfig.password = resolvedCredentials.password;
    }

    sshConn.connect(connectConfig);
  }

  function handleResize(data: { cols: number; rows: number }) {
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
      } catch (e: any) {
        sshLogger.error("Error closing stream: " + e.message);
      }
      sshStream = null;
    }

    if (sshConn) {
      try {
        sshConn.end();
      } catch (e: any) {
        sshLogger.error("Error closing connection: " + e.message);
      }
      sshConn = null;
    }
  }

  function setupPingInterval() {
    pingInterval = setInterval(() => {
      if (sshConn && sshStream) {
        try {
          sshStream.write("\x00");
        } catch (e: any) {
          sshLogger.error("SSH keepalive failed: " + e.message);
          cleanupSSH();
        }
      }
    }, 60000);
  }
});
