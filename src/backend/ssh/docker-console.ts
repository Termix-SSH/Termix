import { Client as SSHClient } from "ssh2";
import { WebSocketServer, WebSocket } from "ws";
import { AuthManager } from "../utils/auth-manager.js";
import { hosts, sshCredentials } from "../database/db/schema.js";
import { and, eq } from "drizzle-orm";
import { getDb } from "../database/db/index.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { systemLogger } from "../utils/logger.js";
import type { SSHHost } from "../../types/index.js";

const sshLogger = systemLogger;

interface SSHSession {
  client: SSHClient;
  stream: import("ssh2").ClientChannel | null;
  isConnected: boolean;
  containerId?: string;
  shell?: string;
  hostId?: number;
}

const activeSessions = new Map<string, SSHSession>();

const wss = new WebSocketServer({
  host: "0.0.0.0",
  port: 30009,
  verifyClient: async (info) => {
    try {
      let token: string | undefined;

      const cookieHeader = info.req.headers.cookie;
      if (cookieHeader) {
        const match = cookieHeader.match(/(?:^|;\s*)jwt=([^;]+)/);
        if (match) token = decodeURIComponent(match[1]);
      }

      if (!token) {
        const authHeader = info.req.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
          token = authHeader.slice("Bearer ".length);
        }
      }

      if (!token) {
        return false;
      }

      const authManager = AuthManager.getInstance();
      const decoded = await authManager.verifyJWTToken(token);

      if (!decoded || !decoded.userId) {
        return false;
      }

      return true;
    } catch {
      return false;
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

            stream.stderr.on("data", () => {});
            stream.stderr.on("error", () => {});
            stream.on("error", (streamErr) => {
              reject(streamErr);
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
  jumpHosts: Array<{ hostId: number }>,
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
        .from(hosts)
        .where(and(eq(hosts.id, jumpHostId), eq(hosts.userId, userId))),
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
        sshLogger.error("Failed to parse jump hosts", e, {
          hostId: jumpHost.id,
        });
        jumpHost.jumpHosts = [];
      }
    }

    let resolvedCredentials: {
      password?: string;
      sshKey?: string;
      keyPassword?: string;
      authType?: string;
    } = {
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
          password: credential.password as string | undefined,
          sshKey: credential.privateKey as string | undefined,
          keyPassword: credential.keyPassword as string | undefined,
          authType: credential.authType as string | undefined,
        };
      }
    }

    const client = new SSHClient();

    const config: Record<string, unknown> = {
      host: jumpHost.ip?.replace(/^\[|\]$/g, "") || jumpHost.ip,
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
  let token: string | undefined;

  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)jwt=([^;]+)/);
    if (match) token = decodeURIComponent(match[1]);
  }

  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice("Bearer ".length);
    }
  }

  if (!token) {
    ws.close(1008, "Authentication required");
    return;
  }

  const authManagerInstance = AuthManager.getInstance();
  const payload = await authManagerInstance.verifyJWTToken(token);
  if (!payload || !payload.userId) {
    ws.close(1008, "Authentication required");
    return;
  }

  const userId = payload.userId;
  const sessionId = `docker-console-${Date.now()}-${Math.random()}`;
  sshLogger.info("Docker console WebSocket connected", {
    operation: "docker_console_connect",
    sessionId,
    userId,
  });

  let sshSession: SSHSession | null = null;

  const wsPingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30000);

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

          const hostId = hostConfig?.id;

          if (!hostId || !containerId) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Host configuration and container ID are required",
              }),
            );
            return;
          }

          if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerId)) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Invalid container ID",
              }),
            );
            return;
          }

          const allowedShells = ["bash", "sh", "ash", "zsh"];
          if (shell && !allowedShells.includes(shell)) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Invalid shell",
              }),
            );
            return;
          }

          if (!hostConfig.enableDocker) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Docker is not enabled on this host",
              }),
            );
            return;
          }

          try {
            // Resolve host with credentials server-side
            const { resolveHostById } = await import("./host-resolver.js");
            const resolvedHost = await resolveHostById(hostId, userId);

            if (!resolvedHost) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Host not found",
                }),
              );
              return;
            }

            if (!resolvedHost.enableDocker) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message:
                    "Docker is not enabled for this host. Enable it in Host Settings.",
                }),
              );
              return;
            }

            const client = new SSHClient();

            const config: Record<string, unknown> = {
              host: resolvedHost.ip?.replace(/^\[|\]$/g, "") || resolvedHost.ip,
              port: resolvedHost.port || 22,
              username: resolvedHost.username,
              tryKeyboard: true,
              readyTimeout: 60000,
              keepaliveInterval: 30000,
              keepaliveCountMax: 120,
              tcpKeepAlive: true,
              tcpKeepAliveInitialDelay: 30000,
            };

            if (resolvedHost.authType === "password" && resolvedHost.password) {
              config.password = resolvedHost.password;
            } else if (resolvedHost.authType === "key" && resolvedHost.key) {
              const cleanKey = resolvedHost.key
                .trim()
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n");
              config.privateKey = Buffer.from(cleanKey, "utf8");
              if (resolvedHost.keyPassword) {
                config.passphrase = resolvedHost.keyPassword;
              }
            }

            if (resolvedHost.jumpHosts && resolvedHost.jumpHosts.length > 0) {
              const jumpClient = await createJumpHostChain(
                resolvedHost.jumpHosts,
                userId,
              );
              if (jumpClient) {
                const stream = await new Promise<import("ssh2").ClientChannel>(
                  (resolve, reject) => {
                    jumpClient.forwardOut(
                      "127.0.0.1",
                      0,
                      resolvedHost.ip,
                      resolvedHost.port || 22,
                      (err, stream) => {
                        if (err) return reject(err);
                        resolve(stream);
                      },
                    );
                  },
                );
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
              hostId: resolvedHost.id,
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

                      stream.stderr.on("data", () => {});
                      stream.stderr.on("error", () => {});
                      stream.on("error", (streamErr) => {
                        reject(streamErr);
                      });
                    },
                  );
                });
              } catch {
                sshLogger.warn(
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
            sshLogger.info("Attaching to Docker container", {
              operation: "docker_attach",
              sessionId,
              userId,
              hostId: resolvedHost.id,
              containerId,
            });

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
                  sshLogger.error("Failed to create docker exec", err, {
                    operation: "docker_exec",
                    sessionId,
                    containerId,
                  });

                  ws.send(
                    JSON.stringify({
                      type: "error",
                      message: `Failed to start console: ${err.message}`,
                    }),
                  );
                  return;
                }

                sshSession!.stream = stream;
                sshLogger.success("Docker container attached", {
                  operation: "docker_attach_success",
                  sessionId,
                  userId,
                  hostId: resolvedHost.id,
                  containerId,
                });

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

                stream.stderr.on("data", () => {});
                stream.stderr.on("error", () => {});

                stream.on("error", (streamErr) => {
                  sshLogger.error("Docker console stream error", streamErr, {
                    operation: "docker_console_stream_error",
                    sessionId,
                    containerId,
                  });
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(
                      JSON.stringify({
                        type: "error",
                        message: `Console error: ${streamErr.message}`,
                      }),
                    );
                  }
                });

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
            sshLogger.error("Failed to connect to container", error, {
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
            sshSession.stream.setWindow(rows, cols, rows, cols);
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
          sshLogger.warn("Unknown message type", {
            operation: "ws_message",
            type: message.type,
          });
      }
    } catch (error) {
      sshLogger.error("WebSocket message error", error, {
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
    clearInterval(wsPingInterval);
    sshLogger.info("Docker console disconnected", {
      operation: "docker_console_disconnect",
      sessionId,
      userId,
      hostId: sshSession?.hostId,
      containerId: sshSession?.containerId,
    });
    if (sshSession) {
      if (sshSession.stream) {
        sshSession.stream.end();
      }
      sshSession.client.end();
      activeSessions.delete(sessionId);
    }
  });

  ws.on("error", (error) => {
    sshLogger.error("WebSocket error", error, {
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
  activeSessions.forEach((session) => {
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
