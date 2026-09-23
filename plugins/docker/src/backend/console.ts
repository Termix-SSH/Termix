// Core imports below point at TypeScript source so tsc can type-check them.
// The plugin build rewrites the prefix to the compiled output path; see
// packages/plugin-sdk/cli/lib/legacy-core-imports.mjs.
import { getErrorMessage } from "../../../../src/backend/utils/error-message.js";
import { StringDecoder } from "string_decoder";
import type { Client as SSHClient } from "ssh2";
import type { PluginSshHost } from "@termix/plugin-sdk/backend";
import { connectSsh } from "./ssh.js";
import { WebSocketServer, WebSocket } from "ws";
import { AuthManager } from "../../../../src/backend/utils/auth-manager.js";
import { systemLogger } from "../../../../src/backend/utils/logger.js";
import type { SSHHost } from "../../../../src/types/index.js";
import {
  containerCommand,
  getContainerRuntimeConfig,
  type ContainerRuntime,
} from "./container-runtime.js";
import {
  hostAddressMismatch,
  HOST_ADDRESS_MISMATCH_MESSAGE,
  HOST_NOT_ON_THIS_SERVER_MESSAGE,
} from "../../../../src/backend/hosts/host-identity.js";
import { extractWebSocketToken } from "../../../../src/backend/utils/ws-auth.js";
import {
  asObject,
  asString,
  MAX_WS_MESSAGE_BYTES,
  parseWsMessage,
  toTerminalDimension,
} from "../../../../src/backend/utils/ws-message.js";

const sshLogger = systemLogger;

interface SSHSession {
  client: SSHClient;
  stream: import("ssh2").ClientChannel | null;
  isConnected: boolean;
  containerId?: string;
  shell?: string;
  hostId?: number;
  containerRuntime?: ContainerRuntime;
}

const activeSessions = new Map<string, SSHSession>();

/**
 * Created by startConsoleServer(), not at module load.
 *
 * Importing this file used to bind a port as a side effect, which meant the
 * plugin could not be disabled and re-enabled: the module stays in the ESM
 * cache, so the second activate() got a server that had already been closed.
 * There is no port now -- core routes /plugin-ws/docker/console here -- but
 * the same lifecycle applies to the server object itself.
 */
let wss: WebSocketServer | null = null;

function handleConnection(ws: WebSocket, req: import("http").IncomingMessage) {
  void onConsoleConnection(ws, req);
}

/** Builds the console WebSocket server. Call from the plugin's activate(). */
export function startConsoleServer(): Promise<void> {
  if (wss) return Promise.resolve();

  const server = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_MESSAGE_BYTES,
  });

  // One bad socket must not take the server down.
  server.on("error", (error) => {
    sshLogger.error("Docker console WebSocket server error", error, {
      operation: "wss_error",
    });
  });
  server.on("connection", handleConnection);

  wss = server;
  return Promise.resolve();
}

/**
 * Hands one upgrade to the console server.
 *
 * Registered as a public ctx.ws route because onConsoleConnection does its own
 * per-message authentication, which is where the container and host checks
 * live too.
 */
export function handleConsoleUpgrade(
  request: import("http").IncomingMessage,
  socket: import("stream").Duplex,
  head: Buffer,
): void {
  const server = wss;
  if (!server) {
    socket.destroy();
    return;
  }
  server.handleUpgrade(request, socket, head, (ws) => {
    server.emit("connection", ws, request);
  });
}

async function detectShell(
  session: SSHSession,
  containerId: string,
): Promise<string> {
  const shells = ["bash", "sh", "ash"];

  for (const shell of shells) {
    try {
      await new Promise<void>((resolve, reject) => {
        session.client.exec(
          containerCommand(
            session.containerRuntime,
            `exec ${containerId} which ${shell}`,
          ),
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

async function onConsoleConnection(
  ws: WebSocket,
  req: import("http").IncomingMessage,
) {
  const token = extractWebSocketToken(req);

  if (!token) {
    ws.close(1008, "Authentication required");
    return;
  }

  const authManagerInstance = AuthManager.getInstance();
  let payload;
  try {
    payload = await authManagerInstance.verifyJWTToken(token);
  } catch (error) {
    sshLogger.warn("Docker console JWT verification failed", {
      operation: "docker_console_auth_error",
      error: getErrorMessage(error),
    });
    ws.close(1008, "Authentication required");
    return;
  }
  if (!payload?.userId || payload.pendingTOTP) {
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

  const cleanup = () => {
    clearInterval(wsPingInterval);
    if (!sshSession) return;
    sshSession.stream?.end();
    sshSession.client.end();
    activeSessions.delete(sessionId);
    sshSession = null;
  };

  ws.on("message", async (data) => {
    try {
      const message = parseWsMessage(data);

      switch (message.type) {
        case "connect": {
          const connectData = asObject(message.data);
          const hostConfig = asObject(
            connectData.hostConfig,
          ) as unknown as SSHHost;
          const containerId = asString(connectData.containerId);
          const shell = asString(connectData.shell) || undefined;
          const cols = toTerminalDimension(connectData.cols) || 80;
          const rows = toTerminalDimension(connectData.rows) || 24;

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
            const { resolveHostById, resolveHostBySyncId } =
              await import("../../../../src/backend/hosts/host-resolver.js");
            // syncId names the host on both sides of a sync pair; the numeric
            // id only names it in the database the client is displaying.
            const hostSyncId = hostConfig?.syncId;
            const resolvedHost = hostSyncId
              ? await resolveHostBySyncId(hostSyncId, userId)
              : await resolveHostById(hostId, userId);

            if (!resolvedHost) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: hostSyncId
                    ? HOST_NOT_ON_THIS_SERVER_MESSAGE
                    : "Host not found",
                }),
              );
              return;
            }

            // The connection below dials resolvedHost.ip outright, so if this
            // server has a different machine under the id the client sent, the
            // console opens on that machine's Docker daemon instead.
            if (
              !hostSyncId &&
              hostAddressMismatch(hostConfig?.ip, resolvedHost.ip)
            ) {
              sshLogger.error(
                "Refusing Docker console: host id resolves to a different address here",
                undefined,
                {
                  operation: "docker_console_host_id_mismatch",
                  hostId,
                  userId,
                  clientIp: hostConfig?.ip,
                  resolvedIp: resolvedHost.ip,
                },
              );
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: HOST_ADDRESS_MISMATCH_MESSAGE,
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

            // The console socket is public and authenticates itself, so the
            // acting user is carried on the host rather than the request.
            const { client } = await connectSsh(
              {
                ...(resolvedHost as unknown as PluginSshHost),
                userId,
              } as PluginSshHost,
              { purpose: "docker-console", timeoutMs: 65000 },
            );

            const { runtime: containerRuntime } = getContainerRuntimeConfig(
              resolvedHost.dockerConfig,
            );

            sshSession = {
              client,
              stream: null,
              isConnected: true,
              containerId,
              hostId: resolvedHost.id,
              containerRuntime,
            };

            activeSessions.set(sessionId, sshSession);

            let shellToUse = shell || "bash";

            if (shell) {
              try {
                await new Promise<void>((resolve, reject) => {
                  client.exec(
                    containerCommand(
                      containerRuntime,
                      `exec ${containerId} which ${shell}`,
                    ),
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

            const execCommand = containerCommand(
              containerRuntime,
              `exec -it ${containerId} /bin/${shellToUse}`,
            );
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
                  cols,
                  rows,
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

                // Buffers incomplete multi-byte UTF-8 sequences across chunk
                // boundaries so box-drawing/special characters don't get
                // corrupted when a character is split across TCP packets.
                const decoder = new StringDecoder("utf-8");

                stream.on("data", (data: Buffer) => {
                  if (ws.readyState === WebSocket.OPEN) {
                    const text = decoder.write(data);
                    if (!text) return;
                    ws.send(
                      JSON.stringify({
                        type: "output",
                        data: text,
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
              containerId,
            });

            ws.send(
              JSON.stringify({
                type: "error",
                message: getErrorMessage(
                  error,
                  "Failed to connect to container",
                ),
              }),
            );
          }
          break;
        }

        case "input": {
          if (sshSession && sshSession.stream) {
            const input = asString(message.data);
            if (input) sshSession.stream.write(input);
          }
          break;
        }

        case "resize": {
          if (sshSession && sshSession.stream) {
            const dimensions = asObject(message.data);
            const cols = toTerminalDimension(dimensions.cols);
            const rows = toTerminalDimension(dimensions.rows);
            if (cols && rows)
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
          message: getErrorMessage(error, "An error occurred"),
        }),
      );
    }
  });

  ws.on("close", () => {
    sshLogger.info("Docker console disconnected", {
      operation: "docker_console_disconnect",
      sessionId,
      userId,
      hostId: sshSession?.hostId,
      containerId: sshSession?.containerId,
    });
    cleanup();
  });

  ws.on("error", (error) => {
    sshLogger.error("WebSocket error", error, {
      operation: "ws_error",
      sessionId,
    });

    cleanup();
  });
}

/**
 * Closes every live console session and the WebSocket server. Called from the
 * plugin's deactivate().
 *
 * There is deliberately no process signal handler here. Core owns shutdown:
 * gracefulShutdown in src/backend/starter.ts calls shutdownPlugins(), which
 * runs every plugin's deactivate. A plugin calling process.exit() itself
 * skipped the rest of that sequence, including other plugins and the
 * database flush.
 */
export function closeConsoleServer(): Promise<void> {
  activeSessions.forEach((session) => {
    if (session.stream) {
      session.stream.end();
    }
    session.client.end();
  });

  activeSessions.clear();

  const server = wss;
  wss = null;
  if (!server) return Promise.resolve();

  server.off("connection", handleConnection);
  for (const client of server.clients) {
    try {
      client.close(1001, "Docker plugin disabled");
    } catch {
      // Already gone.
    }
  }
  return new Promise((resolve) => server.close(() => resolve()));
}
