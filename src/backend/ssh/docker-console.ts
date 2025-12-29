import { Client as SSHClient } from "ssh2";
import { WebSocketServer, WebSocket } from "ws";
import { parse as parseUrl } from "url";
import { AuthManager } from "../utils/auth-manager.js";
import { sshData, sshCredentials } from "../database/db/schema.js";
import { and, eq } from "drizzle-orm";
import { getDb } from "../database/db/index.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { systemLogger } from "../utils/logger.js";
import type { SSHHost } from "../../types/index.js";

const dockerConsoleLogger = systemLogger;

interface SSHSession {
  client: SSHClient;
  stream: any;
  isConnected: boolean;
  containerId?: string;
  shell?: string;
}

const activeSessions = new Map<string, SSHSession>();

const wss = new WebSocketServer({
  port: 30008,
  verifyClient: async (info, callback) => {
    try {
      const url = parseUrl(info.req.url || "", true);
      const token = url.query.token as string;

      if (!token) {
        dockerConsoleLogger.warn("WebSocket connection rejected: No token", {
          operation: "ws_verify",
        });
        return callback(false, 401, "Authentication required");
      }

      const authManager = AuthManager.getInstance();
      const decoded = await authManager.verifyJWTToken(token);

      if (!decoded || !decoded.userId) {
        dockerConsoleLogger.warn(
          "WebSocket connection rejected: Invalid token",
          {
            operation: "ws_verify",
          },
        );
        return callback(false, 401, "Invalid token");
      }

      (info.req as any).userId = decoded.userId;

      callback(true);
    } catch (error) {
      dockerConsoleLogger.error("WebSocket verification error", error, {
        operation: "ws_verify",
      });
      callback(false, 500, "Authentication failed");
    }
  },
});

async function detectShell(
  session: SSHSession,
  containerId: string,
): Promise<string> {
  const shells = ["bash", "sh", "ash"];

  for (const shell of shells) {
    try {
      await new Promise<void>((resolve, reject) => {
        session.client.exec(
          `docker exec ${containerId} which ${shell}`,
          (err, stream) => {
            if (err) return reject(err);

            let output = "";
            stream.on("data", (data: Buffer) => {
              output += data.toString();
            });

            stream.on("close", (code: number) => {
              if (code === 0 && output.trim()) {
                resolve();
              } else {
                reject(new Error(`Shell ${shell} not found`));
              }
            });

            stream.stderr.on("data", () => {
              // Ignore stderr
            });
          },
        );
      });

      return shell;
    } catch {
      continue;
    }
  }

  return "sh";
}

async function createJumpHostChain(
  jumpHosts: any[],
  userId: string,
): Promise<SSHClient | null> {
  if (!jumpHosts || jumpHosts.length === 0) {
    return null;
  }

  let currentClient: SSHClient | null = null;

  for (let i = 0; i < jumpHosts.length; i++) {
    const jumpHostId = jumpHosts[i].hostId;

    const jumpHostData = await SimpleDBOps.select(
      getDb()
        .select()
        .from(sshData)
        .where(and(eq(sshData.id, jumpHostId), eq(sshData.userId, userId))),
      "ssh_data",
      userId,
    );

    if (jumpHostData.length === 0) {
      throw new Error(`Jump host ${jumpHostId} not found`);
    }

    const jumpHost = jumpHostData[0] as unknown as SSHHost;
    if (typeof jumpHost.jumpHosts === "string" && jumpHost.jumpHosts) {
      try {
        jumpHost.jumpHosts = JSON.parse(jumpHost.jumpHosts);
      } catch (e) {
        dockerConsoleLogger.error("Failed to parse jump hosts", e, {
          hostId: jumpHost.id,
        });
        jumpHost.jumpHosts = [];
      }
    }

    let resolvedCredentials: any = {
      password: jumpHost.password,
      sshKey: jumpHost.key,
      keyPassword: jumpHost.keyPassword,
      authType: jumpHost.authType,
    };

    if (jumpHost.credentialId) {
      const credentials = await SimpleDBOps.select(
        getDb()
          .select()
          .from(sshCredentials)
          .where(
            and(
              eq(sshCredentials.id, jumpHost.credentialId as number),
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

    const client = new SSHClient();

    const config: any = {
      host: jumpHost.ip,
      port: jumpHost.port || 22,
      username: jumpHost.username,
      tryKeyboard: true,
      readyTimeout: 60000,
      keepaliveInterval: 30000,
      keepaliveCountMax: 120,
      tcpKeepAlive: true,
      tcpKeepAliveInitialDelay: 30000,
    };

    if (
      resolvedCredentials.authType === "password" &&
      resolvedCredentials.password
    ) {
      config.password = resolvedCredentials.password;
    } else if (
      resolvedCredentials.authType === "key" &&
      resolvedCredentials.sshKey
    ) {
      const cleanKey = resolvedCredentials.sshKey
        .trim()
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
      config.privateKey = Buffer.from(cleanKey, "utf8");
      if (resolvedCredentials.keyPassword) {
        config.passphrase = resolvedCredentials.keyPassword;
      }
    }

    if (currentClient) {
      await new Promise<void>((resolve, reject) => {
        currentClient!.forwardOut(
          "127.0.0.1",
          0,
          jumpHost.ip,
          jumpHost.port || 22,
          (err, stream) => {
            if (err) return reject(err);
            config.sock = stream;
            resolve();
          },
        );
      });
    }

    await new Promise<void>((resolve, reject) => {
      client.on("ready", () => resolve());
      client.on("error", reject);
      client.connect(config);
    });

    currentClient = client;
  }

  return currentClient;
}

wss.on("connection", async (ws: WebSocket, req) => {
  const userId = (req as any).userId;
  const sessionId = `docker-console-${Date.now()}-${Math.random()}`;

  let sshSession: SSHSession | null = null;

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "connect": {
          const { hostConfig, containerId, shell, cols, rows } =
            message.data as {
              hostConfig: SSHHost;
              containerId: string;
              shell?: string;
              cols?: number;
              rows?: number;
            };

          if (
            typeof hostConfig.jumpHosts === "string" &&
            hostConfig.jumpHosts
          ) {
            try {
              hostConfig.jumpHosts = JSON.parse(hostConfig.jumpHosts);
            } catch (e) {
              dockerConsoleLogger.error("Failed to parse jump hosts", e, {
                hostId: hostConfig.id,
              });
              hostConfig.jumpHosts = [];
            }
          }

          if (!hostConfig || !containerId) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Host configuration and container ID are required",
              }),
            );
            return;
          }

          if (!hostConfig.enableDocker) {
            ws.send(
              JSON.stringify({
                type: "error",
                message:
                  "Docker is not enabled for this host. Enable it in Host Settings.",
              }),
            );
            return;
          }

          try {
            let resolvedCredentials: any = {
              password: hostConfig.password,
              sshKey: hostConfig.key,
              keyPassword: hostConfig.keyPassword,
              authType: hostConfig.authType,
            };

            if (hostConfig.credentialId) {
              const credentials = await SimpleDBOps.select(
                getDb()
                  .select()
                  .from(sshCredentials)
                  .where(
                    and(
                      eq(sshCredentials.id, hostConfig.credentialId as number),
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
                    credential.private_key ||
                    credential.privateKey ||
                    credential.key,
                  keyPassword:
                    credential.key_password || credential.keyPassword,
                  authType: credential.auth_type || credential.authType,
                };
              }
            }

            const client = new SSHClient();

            const config: any = {
              host: hostConfig.ip,
              port: hostConfig.port || 22,
              username: hostConfig.username,
              tryKeyboard: true,
              readyTimeout: 60000,
              keepaliveInterval: 30000,
              keepaliveCountMax: 120,
              tcpKeepAlive: true,
              tcpKeepAliveInitialDelay: 30000,
            };

            if (
              resolvedCredentials.authType === "password" &&
              resolvedCredentials.password
            ) {
              config.password = resolvedCredentials.password;
            } else if (
              resolvedCredentials.authType === "key" &&
              resolvedCredentials.sshKey
            ) {
              const cleanKey = resolvedCredentials.sshKey
                .trim()
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n");
              config.privateKey = Buffer.from(cleanKey, "utf8");
              if (resolvedCredentials.keyPassword) {
                config.passphrase = resolvedCredentials.keyPassword;
              }
            }

            if (hostConfig.jumpHosts && hostConfig.jumpHosts.length > 0) {
              const jumpClient = await createJumpHostChain(
                hostConfig.jumpHosts,
                userId,
              );
              if (jumpClient) {
                const stream = await new Promise<any>((resolve, reject) => {
                  jumpClient.forwardOut(
                    "127.0.0.1",
                    0,
                    hostConfig.ip,
                    hostConfig.port || 22,
                    (err, stream) => {
                      if (err) return reject(err);
                      resolve(stream);
                    },
                  );
                });
                config.sock = stream;
              }
            }

            await new Promise<void>((resolve, reject) => {
              client.on("ready", () => resolve());
              client.on("error", reject);
              client.connect(config);
            });

            sshSession = {
              client,
              stream: null,
              isConnected: true,
              containerId,
            };

            activeSessions.set(sessionId, sshSession);

            let shellToUse = shell || "bash";

            if (shell) {
              try {
                await new Promise<void>((resolve, reject) => {
                  client.exec(
                    `docker exec ${containerId} which ${shell}`,
                    (err, stream) => {
                      if (err) return reject(err);

                      let output = "";
                      stream.on("data", (data: Buffer) => {
                        output += data.toString();
                      });

                      stream.on("close", (code: number) => {
                        if (code === 0 && output.trim()) {
                          resolve();
                        } else {
                          reject(new Error(`Shell ${shell} not available`));
                        }
                      });

                      stream.stderr.on("data", () => {
                        // Ignore stderr
                      });
                    },
                  );
                });
              } catch {
                dockerConsoleLogger.warn(
                  `Requested shell ${shell} not found, detecting available shell`,
                  {
                    operation: "shell_validation",
                    sessionId,
                    containerId,
                    requestedShell: shell,
                  },
                );
                shellToUse = await detectShell(sshSession, containerId);
              }
            } else {
              shellToUse = await detectShell(sshSession, containerId);
            }

            sshSession.shell = shellToUse;

            const execCommand = `docker exec -it ${containerId} /bin/${shellToUse}`;

            client.exec(
              execCommand,
              {
                pty: {
                  term: "xterm-256color",
                  cols: cols || 80,
                  rows: rows || 24,
                },
              },
              (err, stream) => {
                if (err) {
                  dockerConsoleLogger.error(
                    "Failed to create docker exec",
                    err,
                    {
                      operation: "docker_exec",
                      sessionId,
                      containerId,
                    },
                  );

                  ws.send(
                    JSON.stringify({
                      type: "error",
                      message: `Failed to start console: ${err.message}`,
                    }),
                  );
                  return;
                }

                sshSession!.stream = stream;

                stream.on("data", (data: Buffer) => {
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(
                      JSON.stringify({
                        type: "output",
                        data: data.toString("utf8"),
                      }),
                    );
                  }
                });

                stream.stderr.on("data", (data: Buffer) => {});

                stream.on("close", () => {
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(
                      JSON.stringify({
                        type: "disconnected",
                        message: "Console session ended",
                      }),
                    );
                  }

                  if (sshSession) {
                    sshSession.client.end();
                    activeSessions.delete(sessionId);
                  }
                });

                ws.send(
                  JSON.stringify({
                    type: "connected",
                    data: {
                      shell: shellToUse,
                      requestedShell: shell,
                      shellChanged: shell && shell !== shellToUse,
                    },
                  }),
                );
              },
            );
          } catch (error) {
            dockerConsoleLogger.error("Failed to connect to container", error, {
              operation: "console_connect",
              sessionId,
              containerId: message.data.containerId,
            });

            ws.send(
              JSON.stringify({
                type: "error",
                message:
                  error instanceof Error
                    ? error.message
                    : "Failed to connect to container",
              }),
            );
          }
          break;
        }

        case "input": {
          if (sshSession && sshSession.stream) {
            sshSession.stream.write(message.data);
          }
          break;
        }

        case "resize": {
          if (sshSession && sshSession.stream) {
            const { cols, rows } = message.data;
            sshSession.stream.setWindow(rows, cols);
          }
          break;
        }

        case "disconnect": {
          if (sshSession) {
            if (sshSession.stream) {
              sshSession.stream.end();
            }
            sshSession.client.end();
            activeSessions.delete(sessionId);

            ws.send(
              JSON.stringify({
                type: "disconnected",
                message: "Disconnected from container",
              }),
            );
          }
          break;
        }

        case "ping": {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "pong" }));
          }
          break;
        }

        default:
          dockerConsoleLogger.warn("Unknown message type", {
            operation: "ws_message",
            type: message.type,
          });
      }
    } catch (error) {
      dockerConsoleLogger.error("WebSocket message error", error, {
        operation: "ws_message",
        sessionId,
      });

      ws.send(
        JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : "An error occurred",
        }),
      );
    }
  });

  ws.on("close", () => {
    if (sshSession) {
      if (sshSession.stream) {
        sshSession.stream.end();
      }
      sshSession.client.end();
      activeSessions.delete(sessionId);
    }
  });

  ws.on("error", (error) => {
    dockerConsoleLogger.error("WebSocket error", error, {
      operation: "ws_error",
      sessionId,
    });

    if (sshSession) {
      if (sshSession.stream) {
        sshSession.stream.end();
      }
      sshSession.client.end();
      activeSessions.delete(sessionId);
    }
  });
});

process.on("SIGTERM", () => {
  activeSessions.forEach((session, sessionId) => {
    if (session.stream) {
      session.stream.end();
    }
    session.client.end();
  });

  activeSessions.clear();

  wss.close(() => {
    process.exit(0);
  });
});
