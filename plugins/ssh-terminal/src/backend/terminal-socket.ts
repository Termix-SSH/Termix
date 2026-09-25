import { AsyncResource } from "async_hooks";
import { StringDecoder } from "string_decoder";
import { WebSocket, type RawData } from "ws";
import ssh2Pkg, {
  type Client as SSHClientType,
  type ClientChannel,
  type PseudoTtyOptions,
} from "ssh2";
import {
  PluginSshInteractionError,
  type PluginContext,
  type PluginSshHost,
  type PluginSshPrepared,
  type PluginWebSocketConnection,
} from "@termix/plugin-sdk/backend";
import {
  asObject,
  asString,
  getErrorMessage,
  hostAddressMismatch,
  HOST_ADDRESS_MISMATCH_MESSAGE,
  HOST_NOT_ON_THIS_SERVER_MESSAGE,
  isRetriableDnsError,
  isWindowsSftpPath,
  MemoryAgent,
  parseWsMessage,
  resolveHostForSshConnect,
  resolveServerHostId,
  resolveServerJumpHosts,
  sftpPathToLocalPath,
  toTerminalDimension,
  type TerminalLogger,
} from "./helpers.js";
import { SSHAuthManager } from "./keyboard-prompt.js";
import {
  isMessageAllowedForParticipant,
  type TerminalSessionManager,
} from "./session-manager.js";
import type {
  SessionGuestsV1,
  SessionSharingV1,
  SharedSessionRef,
  TmuxSessionsV1,
} from "./services.js";

const { Client, utils: ssh2Utils } = ssh2Pkg;

interface ConnectToHostData {
  cols: number;
  rows: number;
  hostConfig: {
    id: number;
    /** Names the host across a sync pair; `id` only names it locally. */
    syncId?: string | null;
    instanceId?: string;
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
    portKnockSequence?: Array<{
      port: number;
      protocol?: "tcp" | "udp";
      delay?: number;
    }>;
    terminalConfig?: {
      keepaliveInterval?: number;
      keepaliveCountMax?: number;
      [key: string]: unknown;
    };
    /** When true, ignore key material and force password auth (fallback path). */
    passwordFallbackOnly?: boolean;
  };
  initialPath?: string;
  executeCommand?: string;
  /** Attach straight to this tmux session once the shell is ready
   * (tmux monitor opens its panes through a real PTY this way). */
  tmuxAttachSession?: string;
}

interface ResizeData {
  cols: number;
  rows: number;
}

interface TOTPResponseData {
  code?: string;
}

export interface TerminalSocketDeps {
  ctx: PluginContext;
  log: TerminalLogger;
  sessionManager: TerminalSessionManager;
  /** The optional tmux.sessions service, as the acting user. */
  getTmux: () => TmuxSessionsV1 | null;
  /** The optional sessions.sharing service, as the acting user. */
  getSharing: () => SessionSharingV1 | null;
  /** Guest link resolution, published on ctx.registry by session sharing. */
  getGuests: () => SessionGuestsV1 | null;
}

/**
 * Serves /plugin-ws/ssh-terminal/terminal.
 *
 * The route is public with optional auth: a signed-in user arrives with a
 * token core verifies, and a share-link or room guest arrives with a token of
 * its own that is resolved here. Socket and ssh2 listeners are bound with
 * AsyncResource so every ctx call inside them still runs as the socket's user.
 */
export function createTerminalSocket(deps: TerminalSocketDeps) {
  const { ctx, log: sshLogger, sessionManager } = deps;
  const authLogger = sshLogger;
  const bind = <A extends unknown[], R>(fn: (...args: A) => R) =>
    AsyncResource.bind(fn);
  const sockets = new Set<WebSocket>();

  function closeAll(): void {
    for (const ws of sockets) {
      try {
        ws.close(1001, "Terminal plugin disabled");
      } catch {
        // Already gone.
      }
    }
    sockets.clear();
  }

  /** Joins an anonymous guest socket to a live shared session, read-only or not per the share. */
  async function attachShareGuest(
    ws: WebSocket,
    share: SharedSessionRef,
    guests: SessionGuestsV1,
  ): Promise<void> {
    const session = sessionManager.getSession(share.sessionId);
    if (!session || !session.isConnected) {
      ws.close(1008, "Session has ended");
      return;
    }

    const joined = sessionManager.joinAsParticipant(share.sessionId, ws, {
      userId: null,
      permissionLevel: share.permissionLevel,
      guestLabel: "Guest",
      shareId: share.id,
    });
    if (!joined) {
      ws.close(1008, "Session is no longer active");
      return;
    }

    guests.recordJoin(share.id).catch(() => {});

    const buffered = sessionManager.getBuffer(joined);
    if (buffered) {
      ws.send(JSON.stringify({ type: "data", data: buffered }));
    }
    ws.send(
      JSON.stringify({ type: "sessionAttached", sessionId: share.sessionId }),
    );
    ws.send(JSON.stringify({ type: "connected", message: "Joined session" }));

    const currentSessionId: string = share.sessionId;

    let wsAlive = true;
    ws.on("pong", () => {
      wsAlive = true;
    });
    const wsPingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        if (!wsAlive) {
          ws.terminate();
          return;
        }
        wsAlive = false;
        ws.ping();
      } else {
        clearInterval(wsPingInterval);
      }
    }, 30000);

    ws.on("close", () => {
      clearInterval(wsPingInterval);
      sessionManager.removeParticipant(currentSessionId, ws);
      sshLogger.info("Guest left shared terminal session", {
        operation: "terminal_guest_disconnect",
        sessionId: currentSessionId,
        shareId: share.id,
      });
    });

    ws.on("message", (msg: RawData) => {
      let type: string;
      let data: unknown;
      try {
        ({ type, data } = parseWsMessage(msg));
      } catch {
        return;
      }

      const liveSession = sessionManager.getSession(currentSessionId);
      const participant = liveSession
        ? sessionManager.getParticipantForWs(liveSession, ws)
        : null;
      if (!isMessageAllowedForParticipant(participant, type)) {
        return;
      }

      switch (type) {
        case "input": {
          if (typeof data !== "string") break;
          const inputData = data;
          sessionManager.bufferInput(currentSessionId, inputData);
          const inputStream = liveSession?.sshStream;
          if (inputStream) {
            try {
              inputStream.write(Buffer.from(inputData, "utf8"));
            } catch {
              inputStream.write(Buffer.from(inputData, "latin1"));
            }
          }
          break;
        }
        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;
        case "disconnect":
          sessionManager.removeParticipant(currentSessionId, ws);
          break;
        default:
          break;
      }
    });
  }

  /**
   * A share-link (?shareToken) or collab room (?roomGuestToken) guest. Never
   * touches user credentials: guests join an already-live stream. Session
   * sharing resolves the token; without it guest links are refused.
   */
  async function handleGuestConnection(
    ws: WebSocket,
    connection: PluginWebSocketConnection,
    tokens: { shareToken?: string; roomGuestToken?: string },
  ): Promise<void> {
    const guests = deps.getGuests();
    if (!guests) {
      ws.close(1008, "Session sharing is not available");
      return;
    }
    const resolved = await guests.resolve({
      ...tokens,
      clientIp: connection.clientIp,
    });
    if ("reason" in resolved) {
      ws.close(1008, resolved.reason);
      return;
    }
    return attachShareGuest(ws, resolved.share, guests);
  }

  async function handleConnection(
    connection: PluginWebSocketConnection,
  ): Promise<void> {
    const ws = connection.socket as WebSocket;
    const req = connection.request as import("http").IncomingMessage;
    const sessionId: string | undefined = undefined;
    sockets.add(ws);
    ws.once("close", () => sockets.delete(ws));

    ws.on("error", (error) => {
      sshLogger.error("WebSocket connection error", error, {
        operation: "ws_error",
        sessionId,
      });
    });

    const urlObj = new URL(req.url || "", "http://localhost");
    const shareToken = urlObj.searchParams.get("shareToken");

    if (shareToken) {
      await handleGuestConnection(ws, connection, { shareToken });
      return;
    }
    const roomGuestToken = urlObj.searchParams.get("roomGuestToken");
    if (roomGuestToken) {
      await handleGuestConnection(ws, connection, { roomGuestToken });
      return;
    }

    if (!connection.userId) {
      ws.close(1008, "Authentication required");
      return;
    }
    const userId = connection.userId;

    if (!connection.isDataUnlocked()) {
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

    sshLogger.info("Terminal WebSocket connection established", {
      operation: "terminal_ws_connect",
      sessionId,
      userId,
    });

    let currentSessionId: string | null = null;
    let sshConn: SSHClientType | null = null;
    let sshStream: ClientChannel | null = null;
    let lastJumpClient: SSHClientType | null = null;
    let keyboardInteractiveFinish: ((responses: string[]) => void) | null =
      null;
    let totpPromptSent = false;
    let totpTimeout: NodeJS.Timeout | null = null;
    let isKeyboardInteractive = false;
    let keyboardInteractiveResponded = false;
    let isConnecting = false;
    let isConnected = false;
    let isCleaningUp = false;
    let isShellInitializing = false;
    let isDuplicateConnDiscarded = false;
    // The keyboard-interactive handler whose browser sign-in is pending.
    let browserSignInId: string | null = null;
    let browserSignInTimeout: NodeJS.Timeout | null = null;
    let isAwaitingAuthCredentials = false;

    let wsAlive = true;

    ws.on("pong", () => {
      wsAlive = true;
    });

    const wsPingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        if (!wsAlive) {
          sshLogger.warn(
            "WebSocket pong timeout - terminating zombie connection",
            {
              operation: "ws_pong_timeout",
              userId,
              sessionId: currentSessionId,
            },
          );
          ws.terminate();
          return;
        }
        wsAlive = false;
        ws.ping();
      }
    }, 30000);

    ws.on(
      "close",
      bind(() => {
        clearInterval(wsPingInterval);
        void deps
          .getSharing()
          ?.unsubscribeRoom(ws)
          .catch(() => {});
        sshLogger.info("Terminal WebSocket disconnected", {
          operation: "terminal_ws_disconnect",
          sessionId,
          userId,
        });

        if (currentSessionId) {
          const session = sessionManager.getSession(currentSessionId);
          if (session?.isConnected) {
            const participant = sessionManager.getParticipantForWs(session, ws);
            if (participant && !participant.isOwner) {
              sessionManager.removeParticipant(currentSessionId, ws);
            } else {
              // Only detach if this WS is still the owner's attached socket, or
              // no owner is currently attached. If a refresh reconnected and
              // reattached a new WS before this close event fired, we must not
              // clobber that new attachment.
              const ownerStillAttached = Array.from(
                session.participants.values(),
              ).some((p) => p.isOwner && p.ws !== ws);
              if (!ownerStillAttached) {
                sessionManager.detachWs(currentSessionId);
              }
            }
          } else {
            sessionManager.destroySession(currentSessionId);
            currentSessionId = null;
          }
        }
        cleanupAuthState();
      }),
    );

    function resetConnectionState() {
      isConnecting = false;
      isConnected = false;
      isKeyboardInteractive = false;
      keyboardInteractiveResponded = false;
      keyboardInteractiveFinish = null;
      totpPromptSent = false;
      browserSignInId = null;
    }

    ws.on(
      "message",
      bind(async (msg: RawData) => {
        if (!connection.isDataUnlocked()) {
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

        let type: string;
        let data: unknown;
        try {
          ({ type, data } = parseWsMessage(msg));
        } catch (e) {
          sshLogger.warn("Rejected malformed WebSocket message", {
            operation: "websocket_message_invalid",
            userId,
            error: getErrorMessage(e),
          });
          ws.send(
            JSON.stringify({ type: "error", message: "Invalid message" }),
          );
          return;
        }

        // Server-side gate: non-owner participants (read-only or read-write
        // guests/joiners) may only send input/ping/disconnect - everything else
        // (auth flows, tmux, resize, etc.) is owner-only and silently ignored.
        if (type !== "joinSharedSession") {
          const gateSession = currentSessionId
            ? sessionManager.getSession(currentSessionId)
            : null;
          const gateParticipant = gateSession
            ? sessionManager.getParticipantForWs(gateSession, ws)
            : null;
          if (!isMessageAllowedForParticipant(gateParticipant, type)) {
            return;
          }
        }

        try {
          switch (type) {
            case "connectToHost": {
              const connectData = data as ConnectToHostData;
              if (!connectData?.hostConfig) {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: "Missing host configuration",
                  }),
                );
                break;
              }
              connectData.hostConfig.userId = userId;
              handleConnectToHost(connectData).catch((error) => {
                const errMsg = getErrorMessage(error);
                if (
                  errMsg.includes("Cannot parse privateKey") &&
                  errMsg.includes("no passphrase")
                ) {
                  isAwaitingAuthCredentials = true;
                  ws.send(
                    JSON.stringify({
                      type: "passphrase_required",
                      message:
                        "The SSH key is encrypted. Please enter the passphrase to unlock it.",
                    }),
                  );
                  return;
                }
                sshLogger.error("Failed to connect to host", error, {
                  operation: "ssh_connect",
                  userId,
                  hostId: connectData.hostConfig?.id,
                  ip: connectData.hostConfig?.ip,
                });
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: "Failed to connect to host: " + errMsg,
                  }),
                );
              });
              break;
            }

            case "attachSession": {
              const attachData = data as {
                sessionId: string;
                cols: number;
                rows: number;
                tabInstanceId?: string;
              };
              sshLogger.info("Attempting to attach session", {
                operation: "terminal_attach_session",
                sessionId: attachData.sessionId,
                tabInstanceId: attachData.tabInstanceId,
                userId,
                requestedCols: attachData.cols,
                requestedRows: attachData.rows,
              });
              const session = sessionManager.attachWs(
                attachData.sessionId,
                userId,
                ws,
                attachData.tabInstanceId,
              );
              if (session) {
                sshLogger.success("Session attached successfully", {
                  operation: "terminal_attach_success",
                  sessionId: attachData.sessionId,
                  sessionCreatedAt: session.createdAt,
                  wasDetached: !!session.lastDetachedAt,
                  detachedDuration: session.lastDetachedAt
                    ? Date.now() - session.lastDetachedAt
                    : 0,
                });
                currentSessionId = attachData.sessionId;
                sshStream = session.sshStream;
                sshConn = session.sshConn;
                isConnecting = false;
                isConnected = true;
                const buffered = sessionManager.getBuffer(session);
                if (buffered) {
                  ws.send(JSON.stringify({ type: "data", data: buffered }));
                }
                const attachCols = toTerminalDimension(attachData.cols);
                const attachRows = toTerminalDimension(attachData.rows);
                if (
                  attachCols &&
                  attachRows &&
                  (attachCols !== session.cols || attachRows !== session.rows)
                ) {
                  session.sshStream?.setWindow(
                    attachRows,
                    attachCols,
                    attachRows,
                    attachCols,
                  );
                  session.cols = attachCols;
                  session.rows = attachRows;
                }

                ws.send(
                  JSON.stringify({
                    type: "sessionAttached",
                    sessionId: attachData.sessionId,
                  }),
                );
                ws.send(
                  JSON.stringify({
                    type: "connected",
                    message: "Session reattached",
                  }),
                );
              } else {
                sshLogger.warn(
                  "Session attachment failed - will create new connection",
                  {
                    operation: "terminal_attach_failed",
                    sessionId: attachData.sessionId,
                    tabInstanceId: attachData.tabInstanceId,
                    userId,
                    reason: "session_not_found_or_invalid",
                  },
                );
                ws.send(
                  JSON.stringify({
                    type: "sessionExpired",
                    sessionId: attachData.sessionId,
                  }),
                );
              }
              break;
            }

            case "listSessions": {
              const sessions = sessionManager.getUserSessions(userId);
              ws.send(
                JSON.stringify({
                  type: "sessionList",
                  sessions: sessions.map((s) => ({
                    id: s.id,
                    hostId: s.hostId,
                    hostName: s.hostName,
                    createdAt: s.createdAt,
                    lastDetachedAt: s.lastDetachedAt,
                    tmuxSessionName: s.tmuxSessionName,
                  })),
                }),
              );
              break;
            }

            case "resize": {
              const resizeData = data as ResizeData;
              handleResize(resizeData);
              break;
            }

            case "disconnect": {
              const disconnectSession = currentSessionId
                ? sessionManager.getSession(currentSessionId)
                : null;
              const disconnectParticipant = disconnectSession
                ? sessionManager.getParticipantForWs(disconnectSession, ws)
                : null;
              if (disconnectParticipant && !disconnectParticipant.isOwner) {
                if (currentSessionId) {
                  sessionManager.removeParticipant(currentSessionId, ws);
                  currentSessionId = null;
                }
                break;
              }
              if (currentSessionId) {
                sessionManager.destroySession(currentSessionId);
                currentSessionId = null;
              }
              cleanupAuthState();
              sshConn = null;
              sshStream = null;
              break;
            }

            case "get_cwd": {
              const activeConn =
                sessionManager.getSession(currentSessionId)?.sshConn ?? sshConn;
              if (!activeConn) {
                ws.send(JSON.stringify({ type: "cwd", path: "/" }));
                break;
              }
              activeConn.exec("pwd", (err, execStream) => {
                if (err) {
                  ws.send(JSON.stringify({ type: "cwd", path: "/" }));
                  return;
                }
                let stdout = "";
                execStream.on("data", (chunk: Buffer) => {
                  stdout += chunk.toString("utf-8");
                });
                execStream.stderr.on("data", () => {});
                execStream.on("close", () => {
                  const cwd = stdout.trim() || "/";
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: "cwd", path: cwd }));
                  }
                });
              });
              break;
            }

            case "open_file_in_editor": {
              const requestedPath = asString(asObject(data).path);
              const activeConn =
                sessionManager.getSession(currentSessionId)?.sshConn ?? sshConn;
              if (!activeConn || !requestedPath) {
                ws.send(
                  JSON.stringify({
                    type: "open_file_in_editor",
                    path: requestedPath || "/",
                  }),
                );
                break;
              }
              const escapedPath = requestedPath.replace(/'/g, "'\\''");
              activeConn.exec(
                `realpath '${escapedPath}' 2>/dev/null || echo '${escapedPath}'`,
                (err, execStream) => {
                  if (err) {
                    ws.send(
                      JSON.stringify({
                        type: "open_file_in_editor",
                        path: requestedPath,
                      }),
                    );
                    return;
                  }
                  let stdout = "";
                  execStream.on("data", (chunk: Buffer) => {
                    stdout += chunk.toString("utf-8");
                  });
                  execStream.stderr.on("data", () => {});
                  execStream.on("close", () => {
                    const resolvedPath = stdout.trim() || requestedPath;
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(
                        JSON.stringify({
                          type: "open_file_in_editor",
                          path: resolvedPath,
                        }),
                      );
                    }
                  });
                },
              );
              break;
            }

            case "input": {
              if (typeof data !== "string") break;
              const inputData = data;
              if (currentSessionId) {
                sessionManager.bufferInput(currentSessionId, inputData);
              }
              const inputStream =
                sessionManager.getSession(currentSessionId)?.sshStream ??
                sshStream;
              if (inputStream) {
                if (inputData === "\t") {
                  inputStream.write(inputData);
                } else if (
                  typeof inputData === "string" &&
                  inputData.startsWith("\x1b")
                ) {
                  inputStream.write(inputData);
                } else {
                  try {
                    inputStream.write(Buffer.from(inputData, "utf8"));
                  } catch (error) {
                    sshLogger.error(
                      "Error writing input to SSH stream",
                      error,
                      {
                        operation: "ssh_input_encoding",
                        userId,
                        dataLength: inputData.length,
                      },
                    );
                    inputStream.write(Buffer.from(inputData, "latin1"));
                  }
                }
              }
              break;
            }

            case "ping":
              ws.send(JSON.stringify({ type: "pong" }));
              break;

            case "tmux_attach": {
              const tmuxData = data as { sessionName: string };
              const session = currentSessionId
                ? sessionManager.getSession(currentSessionId)
                : null;
              const tmux = deps.getTmux();
              if (session?.sshStream && tmux) {
                const existingName = tmuxData.sessionName || undefined;
                if (existingName) {
                  void tmux
                    .attachOrCreate(session.sshStream, existingName)
                    .catch(() => {});
                  session.tmuxSessionName = existingName;
                  sshLogger.info("User selected tmux session to attach", {
                    operation: "tmux_user_attach",
                    sessionName: existingName,
                    hostId: session.hostId,
                  });
                  ws.send(
                    JSON.stringify({
                      type: "tmux_session_attached",
                      sessionName: existingName,
                    }),
                  );
                } else {
                  const newName = `termix-${session.hostId}-${Date.now().toString(36).slice(-4)}`;
                  void tmux
                    .attachOrCreate(session.sshStream, undefined, newName)
                    .catch(() => {});
                  const sshConn = session.sshConn;
                  if (sshConn) {
                    (async () => {
                      const confirmed = await tmux.waitForSession(
                        sshConn,
                        newName,
                      );
                      session.tmuxSessionName = confirmed;
                      sshLogger.info("User requested new tmux session", {
                        operation: "tmux_user_create",
                        sessionName: confirmed,
                        hostId: session.hostId,
                      });
                      ws.send(
                        JSON.stringify({
                          type: "tmux_session_created",
                          sessionName: confirmed,
                        }),
                      );
                    })();
                  }
                }
              }
              break;
            }

            case "tmux_detach": {
              const session = currentSessionId
                ? sessionManager.getSession(currentSessionId)
                : null;
              if (session?.sshConn && session.tmuxSessionName) {
                const tmuxName = session.tmuxSessionName;
                session.sshStream?.write("\x02d");
                session.tmuxSessionName = null;
                sshLogger.info("User detached from tmux session", {
                  operation: "tmux_user_detach",
                  sessionName: tmuxName,
                  hostId: session.hostId,
                });
                ws.send(
                  JSON.stringify({
                    type: "tmux_detached",
                    sessionName: tmuxName,
                  }),
                );
              }
              break;
            }

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
                sshLogger.warn(
                  "TOTP response received but no callback available",
                  {
                    operation: "totp_response_error",
                    userId,
                    hasCallback: !!keyboardInteractiveFinish,
                    hasCode: !!totpData?.code,
                  },
                );
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message:
                      "TOTP authentication state lost. Please reconnect.",
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
                    message:
                      "Password authentication state lost. Please reconnect.",
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

              if (!credentialsData?.hostConfig) {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: "Missing host configuration",
                  }),
                );
                break;
              }

              if (credentialsData.password) {
                credentialsData.hostConfig.password = credentialsData.password;
                credentialsData.hostConfig.authType = "password";
                (
                  credentialsData.hostConfig as Record<string, unknown>
                ).userProvidedPassword = true;
              } else if (credentialsData.sshKey) {
                credentialsData.hostConfig.key = credentialsData.sshKey;
                credentialsData.hostConfig.keyPassword =
                  credentialsData.keyPassword;
                credentialsData.hostConfig.authType = "key";
              } else if (credentialsData.keyPassword) {
                credentialsData.hostConfig.keyPassword =
                  credentialsData.keyPassword;
              }

              isAwaitingAuthCredentials = false;
              if (currentSessionId) {
                sessionManager.destroySession(currentSessionId);
                currentSessionId = null;
              }
              cleanupAuthState();
              sshConn = null;
              sshStream = null;

              const reconnectData: ConnectToHostData = {
                cols: credentialsData.cols,
                rows: credentialsData.rows,
                hostConfig: credentialsData.hostConfig,
              };

              handleConnectToHost(reconnectData).catch((error) => {
                const errMsg = getErrorMessage(error);
                if (
                  errMsg.includes("Cannot parse privateKey") &&
                  errMsg.includes("no passphrase")
                ) {
                  isAwaitingAuthCredentials = true;
                  ws.send(
                    JSON.stringify({
                      type: "passphrase_required",
                      message:
                        "The SSH key is encrypted. Please enter the passphrase to unlock it.",
                    }),
                  );
                  return;
                }
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
                      "Failed to connect with provided credentials: " + errMsg,
                  }),
                );
              });
              break;
            }

            case "collab_subscribe": {
              const { roomId } = (data ?? {}) as { roomId?: string };
              if (typeof roomId !== "string" || !roomId) break;
              try {
                const sharing = deps.getSharing();
                const joined = sharing
                  ? await sharing.subscribeRoom(roomId, ws)
                  : false;
                if (!joined) {
                  ws.send(
                    JSON.stringify({
                      type: "error",
                      message: "Room not found",
                    }),
                  );
                }
              } catch (error) {
                sshLogger.error("Failed to subscribe to collab room", error, {
                  operation: "collab_subscribe_error",
                  userId,
                });
              }
              break;
            }

            case "collab_unsubscribe": {
              const { roomId } = (data ?? {}) as { roomId?: string };
              void deps
                .getSharing()
                ?.unsubscribeRoom(
                  ws,
                  typeof roomId === "string" ? roomId : undefined,
                )
                .catch(() => {});
              break;
            }

            case "joinSharedSession": {
              const joinData = data as {
                shareId: string;
                tabInstanceId?: string;
              };
              try {
                const sharing = deps.getSharing();
                const authorized = sharing
                  ? await sharing.authorizeJoin(joinData.shareId)
                  : null;
                if (!sharing || !authorized) {
                  ws.send(
                    JSON.stringify({
                      type: "error",
                      message: "Share not found or not accessible",
                    }),
                  );
                  break;
                }
                const { share, displayName } = authorized;

                const joinedSession = sessionManager.joinAsParticipant(
                  share.sessionId,
                  ws,
                  {
                    userId,
                    permissionLevel: share.permissionLevel,
                    displayName,
                    tabInstanceId: joinData.tabInstanceId,
                    shareId: share.id,
                  },
                );
                if (!joinedSession) {
                  ws.send(
                    JSON.stringify({
                      type: "error",
                      message: "Shared session is no longer active",
                    }),
                  );
                  break;
                }

                currentSessionId = share.sessionId;
                sshStream = joinedSession.sshStream;
                sshConn = joinedSession.sshConn;
                isConnecting = false;
                isConnected = true;

                sharing.recordJoin(share.id).catch(() => {});

                const buffered = sessionManager.getBuffer(joinedSession);
                if (buffered) {
                  ws.send(JSON.stringify({ type: "data", data: buffered }));
                }
                ws.send(
                  JSON.stringify({
                    type: "sessionAttached",
                    sessionId: share.sessionId,
                  }),
                );
                ws.send(
                  JSON.stringify({
                    type: "connected",
                    message: "Joined session",
                  }),
                );
              } catch (error) {
                sshLogger.error("Failed to join shared session", error, {
                  operation: "terminal_join_shared_session_error",
                  userId,
                  shareId: joinData.shareId,
                });
                ws.send(
                  JSON.stringify({
                    type: "error",
                    message: "Failed to join shared session",
                  }),
                );
              }
              break;
            }

            default:
              if (await handleSignInMessage(type, data)) break;
              sshLogger.warn("Unknown message type received", {
                operation: "websocket_message_unknown_type",
                userId,
                messageType: type,
              });
          }
        } catch (error) {
          // A malformed payload must never escape into the process-level
          // unhandledRejection handler, which exits the server.
          sshLogger.error("Error handling WebSocket message", error, {
            operation: "websocket_message_handler_error",
            userId,
            messageType: type,
          });
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Failed to process message",
              }),
            );
          }
        }
      }),
    );

    /**
     * Starts the browser sign-in behind an "<interaction>_auth_required"
     * message. The provider for the host's auth type wins; otherwise the first
     * provider that owns this interaction.
     */
    async function startAuthInteraction(
      interaction: string,
      hostId: number,
      payload: unknown,
    ): Promise<void> {
      await ctx.ssh.startInteraction(interaction, {
        hostId,
        socket: ws,
        requestOrigin: connection.requestOrigin,
        payload: (payload ?? {}) as Record<string, unknown>,
      });
    }

    /**
     * Messages a sign-in's UI sends: "<interaction>_start_auth", "_cancel"
     * and "_auth_completed" for a provider's browser step, and
     * "<handler>_auth_continue" for a pending keyboard-interactive browser
     * round. False for anything else.
     */
    async function handleSignInMessage(
      type: string,
      data: unknown,
    ): Promise<boolean> {
      const match =
        /^([a-z0-9-]+)_(start_auth|cancel|auth_completed|auth_continue)$/.exec(
          type,
        );
      if (!match) return false;
      const [, name, action] = match;
      const payload = (data ?? {}) as Record<string, unknown>;
      const hostId = Number(payload.hostId);

      if (action === "start_auth") {
        try {
          await startAuthInteraction(name, hostId, payload);
        } catch (error) {
          sshLogger.error("Failed to start sign-in", error, {
            operation: "sign_in_start_error",
            interaction: name,
            userId,
            hostId,
          });
          ws.send(
            JSON.stringify({
              type: `${name}_error`,
              requestId: "",
              hostId,
              error:
                error instanceof PluginSshInteractionError
                  ? error.message
                  : getErrorMessage(error, "Failed to start authentication"),
            }),
          );
        }
        return true;
      }

      if (action === "cancel") {
        try {
          await ctx.ssh.cancelInteraction(name, {
            requestId:
              typeof payload.requestId === "string"
                ? payload.requestId
                : undefined,
            hostId: Number.isInteger(hostId) ? hostId : undefined,
          });
          resetConnectionState();
        } catch (error) {
          sshLogger.error("Failed to cancel sign-in", error, {
            operation: "sign_in_cancel_error",
            interaction: name,
            userId,
          });
        }
        return true;
      }

      if (action === "auth_continue") {
        if (name === browserSignInId && keyboardInteractiveFinish) {
          if (browserSignInTimeout) {
            clearTimeout(browserSignInTimeout);
            browserSignInTimeout = null;
          }
          keyboardInteractiveFinish([""]);
          keyboardInteractiveFinish = null;
          browserSignInId = null;
        }
        return true;
      }

      const completed = payload as {
        hostId: number;
        cols?: number;
        rows?: number;
        hostConfig?: ConnectToHostData["hostConfig"];
      };
      resetConnectionState();
      const reconnectConfig: ConnectToHostData = {
        cols: completed.cols || 80,
        rows: completed.rows || 24,
        hostConfig:
          completed.hostConfig ||
          ({
            id: completed.hostId,
            ip: "",
            port: 22,
            username: "",
            userId,
          } as ConnectToHostData["hostConfig"]),
      };
      handleConnectToHost(reconnectConfig).catch((error) => {
        sshLogger.error("Failed to reconnect after sign-in", error, {
          operation: "sign_in_reconnect_error",
          interaction: name,
          userId,
          hostId: completed.hostId,
        });
        ws.send(
          JSON.stringify({
            type: "error",
            message:
              "Failed to connect after authentication: " +
              getErrorMessage(error),
          }),
        );
      });
      return true;
    }

    async function handleConnectToHost(data: ConnectToHostData) {
      const { hostConfig, initialPath, executeCommand, tmuxAttachSession } =
        data;
      const {
        id,
        syncId: hostSyncId,
        ip: rawIp,
        port: clientPort,
        username: clientUsername,
        password,
        key,
        keyPassword,
        keyType,
        authType,
        credentialId,
      } = hostConfig;
      const clientIp = rawIp?.replace(/^\[|\]$/g, "").trim() || rawIp;
      let ip = clientIp;
      let port = clientPort;
      let username = clientUsername;
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
        details?: Record<string, unknown>,
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
          JSON.stringify({
            type: "error",
            message: "Invalid username provided",
          }),
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

      const onConnectionTimeout = () => {
        if (sshConn && isConnecting && !isConnected) {
          sshLogger.error("SSH connection timeout", undefined, {
            operation: "ssh_connect",
            hostId: id,
            ip,
            port,
            username,
          });
          ws.send(
            JSON.stringify({
              type: "error",
              message: "SSH connection timeout",
            }),
          );
          if (currentSessionId) {
            sessionManager.destroySession(currentSessionId);
            currentSessionId = null;
          }
          cleanupAuthState(connectionTimeout);
        }
      };

      // Reassigned when an auth provider's onBanner holds the connection open
      // (Tailscale SSH check mode), so the short connect timeout does not tear
      // down a connection the server is deliberately waiting on.
      let connectionTimeout = setTimeout(onConnectionTimeout, 120000);

      let bannerHoldPending = false;
      let authRetries = 0;
      let isAuthRetrying = false;
      let prepared: PluginSshPrepared | null = null;
      let connectTarget: PluginSshHost | null = null;
      let clearOnlineStatus: (() => void) | null = null;

      let resolvedHostData:
        | (Record<string, unknown> & {
            id?: number;
            ip?: string;
            port?: number;
            username?: string;
            password?: string;
            key?: string;
            keyPassword?: string;
            keyType?: string;
            authType?: string;
            jumpHosts?: Array<{ hostId: number }>;
            useSocks5?: boolean;
            socks5Host?: string;
            socks5Port?: number;
            socks5Username?: string;
            socks5Password?: string;
            socks5ProxyChain?: unknown;
            portKnockSequence?: ConnectToHostData["hostConfig"]["portKnockSequence"];
            terminalConfig?: ConnectToHostData["hostConfig"]["terminalConfig"];
          })
        | null = null;

      if (id && userId) {
        try {
          // Prefer the sync identity. A numeric id belongs to whichever database
          // produced it, so on a sync server it names a different host than the
          // desktop app meant; syncId is the same string on both sides.
          resolvedHostData = (await ctx.ssh.resolveHost(id, {
            syncId: hostSyncId,
          })) as unknown as typeof resolvedHostData | null;

          if (hostSyncId && !resolvedHostData) {
            sshLogger.error(
              "Refusing to connect: host is not known to this server",
              undefined,
              {
                operation: "ssh_connect_host_sync_id_unknown",
                hostId: id,
                userId,
              },
            );
            ws.send(
              JSON.stringify({
                type: "error",
                message: HOST_NOT_ON_THIS_SERVER_MESSAGE,
              }),
            );
            cleanupAuthState(connectionTimeout);
            return;
          }

          // Older clients send only the numeric id, which cannot be trusted to
          // mean the same host here. Everything below is taken from the row it
          // lands on -- the address, the credentials, the jump hosts, the stored
          // host key -- so compare the address before using any of it.
          if (
            !hostSyncId &&
            hostAddressMismatch(clientIp, resolvedHostData?.ip)
          ) {
            sshLogger.error(
              "Refusing to connect: host id resolves to a different address here",
              undefined,
              {
                operation: "ssh_connect_host_id_mismatch",
                hostId: id,
                userId,
                clientIp,
                resolvedIp: resolvedHostData?.ip,
              },
            );
            ws.send(
              JSON.stringify({
                type: "error",
                message: HOST_ADDRESS_MISMATCH_MESSAGE,
              }),
            );
            cleanupAuthState(connectionTimeout);
            return;
          }

          if (resolvedHostData) {
            const resolvedJumpHosts = resolveServerJumpHosts(
              hostConfig.jumpHosts,
              resolvedHostData.jumpHosts,
              hostSyncId,
            );
            if (resolvedJumpHosts !== hostConfig.jumpHosts) {
              hostConfig.jumpHosts = resolvedJumpHosts;
              sendLog(
                "jump",
                "info",
                `Loaded ${resolvedJumpHosts?.length ?? 0} jump host(s) from server-side host data`,
              );
            }

            if (resolvedHostData.useSocks5) {
              hostConfig.useSocks5 = resolvedHostData.useSocks5;
              hostConfig.socks5Host = resolvedHostData.socks5Host;
              hostConfig.socks5Port = resolvedHostData.socks5Port;
              hostConfig.socks5Username = resolvedHostData.socks5Username;
              hostConfig.socks5Password = resolvedHostData.socks5Password;
              hostConfig.socks5ProxyChain = resolvedHostData.socks5ProxyChain;
            }

            if (!hostConfig.terminalConfig && resolvedHostData.terminalConfig) {
              hostConfig.terminalConfig = resolvedHostData.terminalConfig;
            }

            if (
              (!hostConfig.portKnockSequence ||
                hostConfig.portKnockSequence.length === 0) &&
              resolvedHostData.portKnockSequence &&
              resolvedHostData.portKnockSequence.length > 0
            ) {
              hostConfig.portKnockSequence = resolvedHostData.portKnockSequence;
              sendLog(
                "port_knock",
                "info",
                `Loaded ${resolvedHostData.portKnockSequence.length} port knock(s) from server-side host data`,
              );
            }
          }
        } catch (error) {
          sshLogger.warn(`Failed to resolve server-side host data for ${id}`, {
            operation: "ssh_host_data",
            hostId: id,
            error: getErrorMessage(error),
          });
        }
      }

      const serverHostId = resolveServerHostId(id, resolvedHostData);

      // Resolve credentials server-side when frontend doesn't provide them
      let resolvedCredentials = {
        username,
        password,
        key,
        keyPassword,
        keyType,
        authType,
        certPublicKey: undefined as string | undefined,
      };
      const authMethodNotAvailable = false;
      if (id && userId && !password && !key) {
        try {
          if (resolvedHostData) {
            ip = resolvedHostData.ip || ip;
            port = resolvedHostData.port || port;
            username = resolvedHostData.username || username;
            resolvedCredentials = {
              username: resolvedHostData.username || username,
              password: resolvedHostData.password,
              key: resolvedHostData.key,
              keyPassword: keyPassword || resolvedHostData.keyPassword,
              keyType: resolvedHostData.keyType,
              authType: resolvedHostData.authType,
              certPublicKey: resolvedHostData.certPublicKey as
                string | undefined,
            };
            sendLog(
              "auth",
              "info",
              "Credentials resolved from server-side host data",
            );
          }
        } catch (error) {
          sshLogger.warn(`Failed to resolve host credentials for ${id}`, {
            operation: "ssh_credentials",
            hostId: id,
            error: getErrorMessage(error),
          });
        }
      } else if (credentialId && id && userId) {
        try {
          if (resolvedHostData) {
            ip = resolvedHostData.ip || ip;
            port = resolvedHostData.port || port;
            username = resolvedHostData.username || username;
            resolvedCredentials = {
              username: resolvedHostData.username || username,
              password: resolvedHostData.password,
              key: resolvedHostData.key,
              // Preserve user-supplied keyPassword (e.g. from passphrase dialog) over the empty DB value
              keyPassword: keyPassword || resolvedHostData.keyPassword,
              keyType: resolvedHostData.keyType,
              authType: resolvedHostData.authType,
              certPublicKey: resolvedHostData.certPublicKey as
                string | undefined,
            };
          }
        } catch (error) {
          sshLogger.warn(`Failed to resolve credentials for host ${id}`, {
            operation: "ssh_credentials",
            hostId: id,
            credentialId,
            error: getErrorMessage(error),
          });
        }
      }

      if (hostConfig.passwordFallbackOnly && resolvedCredentials.password) {
        resolvedCredentials = {
          ...resolvedCredentials,
          key: undefined,
          keyPassword: undefined,
          keyType: undefined,
          certPublicKey: undefined,
          authType: "password",
        };
      }

      const connectsViaJumpHosts = !!(
        hostConfig.jumpHosts &&
        hostConfig.jumpHosts.length > 0 &&
        hostConfig.userId
      );

      let connectHost = ip;
      if (connectsViaJumpHosts) {
        // The target is only reachable through the jump host's network (e.g. a
        // VPN-only address), so DNS must be resolved there, not on this host.
        sendLog(
          "dns",
          "info",
          `Skipping local address resolution of ${ip} (resolved by jump host)`,
        );
      } else {
        sendLog("dns", "info", `Starting address resolution of ${ip}`);
        try {
          const resolution = await resolveHostForSshConnect(ip);
          connectHost = resolution.host;
          if (resolution.resolvedAddress && resolution.resolvedAddress !== ip) {
            sendLog(
              "dns",
              "success",
              `Resolved ${ip} to ${resolution.resolvedAddress}`,
              { attempts: resolution.attempts },
            );
          }
        } catch (error) {
          const message = getErrorMessage(error);
          sshLogger.error("SSH hostname resolution failed", error, {
            operation: "terminal_dns_resolve",
            hostId: id,
            ip,
            port,
            transient: isRetriableDnsError(error),
          });
          sendLog(
            "dns",
            "error",
            `DNS resolution failed for ${ip}: ${message}`,
          );
          ws.send(
            JSON.stringify({
              type: "error",
              message: isRetriableDnsError(error)
                ? "SSH error: DNS lookup temporarily failed. Check the Docker/container DNS configuration or try again."
                : "SSH error: Could not resolve hostname from the Termix server container.",
            }),
          );
          cleanupAuthState(connectionTimeout);
          return;
        }
      }
      sendLog("tcp", "info", `Connecting to ${ip} port ${port}`);

      // A provider can hold the handshake open pending an out-of-band step
      // (Tailscale SSH check mode delivers its re-auth URL as an auth banner,
      // then blocks while the user logs in via the browser).
      sshConn.on(
        "banner",
        bind((banner: string) => {
          if (!prepared?.onBanner) return;
          const decision = prepared.onBanner(banner);
          if (!decision) return;

          const authType = prepared.authType;

          if (decision.action === "hold") {
            bannerHoldPending = true;
            clearTimeout(connectionTimeout);
            connectionTimeout = setTimeout(
              onConnectionTimeout,
              decision.timeoutMs,
            );
            sendLog("auth", "info", decision.message);
            ws.send(
              JSON.stringify({
                type: `${authType}_check_required`,
                hostId: id,
                ...decision.details,
              }),
            );
            return;
          }

          if (bannerHoldPending) {
            bannerHoldPending = false;
            sendLog("auth", "info", `${authType} check completed`);
            ws.send(
              JSON.stringify({
                type: `${authType}_check_completed`,
                hostId: id,
                ...decision.details,
              }),
            );
          }
        }),
      );

      sshConn.on(
        "ready",
        bind(() => {
          if (serverHostId != null) {
            clearOnlineStatus ??= ctx.hosts.trackSession(serverHostId);
          }
          clearTimeout(connectionTimeout);
          isAuthRetrying = false;
          if (bannerHoldPending) {
            bannerHoldPending = false;
            ws.send(
              JSON.stringify({
                type: `${prepared?.authType}_check_completed`,
                hostId: id,
              }),
            );
          }
          sshLogger.success("SSH connection established", {
            operation: "terminal_ssh_connected",
            sessionId,
            userId,
            hostId: id,
            ip,
          });

          void ctx.audit.record({
            action: "ssh_connect",
            resourceType: "host",
            resourceId: String(id),
            resourceName: `${username}@${ip}:${port}`,
            success: true,
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
          sendLog(
            "auth",
            "success",
            `Authentication successful for ${username}`,
          );
          sendLog("connected", "success", "Connection established");

          const hostDisplayName = `${username}@${ip}:${port}`;
          const tabInstanceId = hostConfig.instanceId;
          // The recordings.writer provider decides per host and user.
          const sessionLoggingEnabled = true;
          currentSessionId = sessionManager.createSession(
            userId,
            id,
            hostDisplayName,
            data.cols,
            data.rows,
            tabInstanceId,
            sessionLoggingEnabled,
          );

          // If createSession returned an existing live session (duplicate tabInstanceId),
          // close the newly-established SSH connection and attach this WS to the live session instead.
          const existingSession = sessionManager.getSession(currentSessionId);
          if (
            existingSession &&
            existingSession.sshStream &&
            !existingSession.sshStream.destroyed &&
            existingSession.sshConn !== sshConn
          ) {
            const reusedSessionId = currentSessionId;
            sshLogger.info(
              "Reusing existing live session after duplicate connectToHost, closing new SSH conn",
              {
                operation: "terminal_reuse_existing_session",
                sessionId: reusedSessionId,
                tabInstanceId,
                userId,
              },
            );
            // Null out currentSessionId before ending the duplicate connection so
            // the sshConn "close" handler does not destroy the reused session.
            // Set isDuplicateConnDiscarded so the close handler does not send a
            // "disconnected" message to the new WS that is now attached to the live session.
            // Null out currentSessionId before ending the duplicate connection so
            // the sshConn "close" handler does not destroy the reused session.
            // Set isDuplicateConnDiscarded so the close handler exits without
            // sending a "disconnected" message to the new WS.
            currentSessionId = null;
            isDuplicateConnDiscarded = true;
            clearTimeout(connectionTimeout);
            try {
              sshConn?.end();
            } catch {
              /* ignore */
            }
            sshConn = null;
            sshStream = null;

            // Point this WS handler's closure at the live session so the input
            // handler can forward keystrokes via currentSessionId.
            currentSessionId = reusedSessionId;
            sshStream = existingSession.sshStream;
            sshConn = existingSession.sshConn;
            isConnecting = false;
            isConnected = true;
            sessionManager.attachWs(reusedSessionId, userId, ws, tabInstanceId);

            const buffered = sessionManager.getBuffer(existingSession);
            if (buffered) {
              ws.send(JSON.stringify({ type: "data", data: buffered }));
            }
            ws.send(
              JSON.stringify({
                type: "sessionCreated",
                sessionId: reusedSessionId,
              }),
            );
            ws.send(
              JSON.stringify({
                type: "sessionAttached",
                sessionId: reusedSessionId,
              }),
            );
            ws.send(
              JSON.stringify({
                type: "connected",
                message: "Session reattached",
              }),
            );
            return;
          }

          sshLogger.info("Terminal session created after SSH ready", {
            operation: "terminal_session_created",
            sessionId: currentSessionId,
            userId,
            hostId: id,
            tabInstanceId,
            ip,
            port,
          });

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
            if (currentSessionId) {
              sessionManager.destroySession(currentSessionId);
              currentSessionId = null;
            }
            cleanupAuthState(connectionTimeout);
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
            if (currentSessionId) {
              sessionManager.destroySession(currentSessionId);
              currentSessionId = null;
            }
            cleanupAuthState(connectionTimeout);
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
              sshLogger.error(
                "Shell creation timeout - no response from server",
                {
                  operation: "ssh_shell_timeout",
                  hostId: id,
                  ip,
                  port,
                  username,
                },
              );
              isShellInitializing = false;
              ws.send(
                JSON.stringify({
                  type: "error",
                  message:
                    "Shell creation timeout. The server may not support interactive shells or the connection was interrupted.",
                }),
              );
              if (currentSessionId) {
                sessionManager.destroySession(currentSessionId);
                currentSessionId = null;
              }
              cleanupAuthState(connectionTimeout);
            }
          }, 15000);

          conn.shell(
            {
              rows: data.rows,
              cols: data.cols,
              term: "xterm-256color",
            } as PseudoTtyOptions,
            bind((err: Error | undefined, stream: ClientChannel) => {
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
                if (currentSessionId) {
                  sessionManager.destroySession(currentSessionId);
                  currentSessionId = null;
                }
                cleanupAuthState(connectionTimeout);
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

              if (currentSessionId) {
                sessionManager.setSSHState(
                  currentSessionId,
                  sshConn!,
                  stream,
                  lastJumpClient,
                );
                sessionManager.attachWs(currentSessionId, userId, ws);

                ws.send(
                  JSON.stringify({
                    type: "sessionCreated",
                    sessionId: currentSessionId,
                  }),
                );

                sshLogger.info("Session ready for persistence", {
                  operation: "session_ready",
                  sessionId: currentSessionId,
                  userId,
                  hostId: id,
                });
              }

              const boundSessionId = currentSessionId;
              // A single TCP/SSH packet boundary can split a multi-byte UTF-8
              // character (e.g. the box-drawing glyphs mc/htop use for borders).
              // Buffer.toString("utf-8") on each chunk independently replaces the
              // split bytes with U+FFFD, which shows up as corrupted/inserted
              // characters. StringDecoder carries incomplete trailing bytes over
              // to the next chunk so multi-byte characters decode correctly.
              const decoder = new StringDecoder("utf-8");

              stream.on("data", (data: Buffer) => {
                try {
                  const utf8String = decoder.write(data);

                  if (!utf8String) return;

                  const session = sessionManager.getSession(boundSessionId);
                  if (session) {
                    sessionManager.bufferOutput(boundSessionId!, utf8String);
                    sessionManager.broadcast(boundSessionId!, {
                      type: "data",
                      data: utf8String,
                    });
                  }
                } catch (error) {
                  sshLogger.error("Error encoding terminal data", error, {
                    operation: "terminal_data_encoding",
                    hostId: id,
                    dataLength: data.length,
                  });
                  const fallback = data.toString("latin1");
                  const session = sessionManager.getSession(boundSessionId);
                  if (session) {
                    sessionManager.bufferOutput(boundSessionId!, fallback);
                    sessionManager.broadcast(boundSessionId!, {
                      type: "data",
                      data: fallback,
                    });
                  }
                }
              });

              stream.on("close", (code: number | null) => {
                const session = sessionManager.getSession(boundSessionId);
                if (session) {
                  if (code != null) {
                    sessionManager.broadcast(boundSessionId!, {
                      type: "session_ended",
                      code,
                    });
                  } else {
                    sessionManager.broadcast(boundSessionId!, {
                      type: "disconnected",
                      message: "Connection lost",
                      graceful: true,
                    });
                  }
                }
                if (boundSessionId) {
                  sessionManager.destroySession(boundSessionId);
                  if (currentSessionId === boundSessionId) {
                    currentSessionId = null;
                  }
                }
              });

              stream.on("error", (err: Error) => {
                sshLogger.error("SSH stream error", err, {
                  operation: "ssh_stream",
                  hostId: id,
                  ip,
                  port,
                  username,
                });
                const session = sessionManager.getSession(boundSessionId);
                if (session) {
                  sessionManager.broadcast(boundSessionId!, {
                    type: "error",
                    message: "SSH stream error: " + err.message,
                  });
                }
              });

              const autoTmux = hostConfig.terminalConfig?.autoTmux === true;

              // Helper to run initialPath/executeCommand after the shell
              // (or tmux session) is ready
              const runPostShellCommands = (delay: number) => {
                setTimeout(() => {
                  if (initialPath && initialPath.trim() !== "") {
                    let cdCommand: string;
                    if (isWindowsSftpPath(initialPath)) {
                      const winPath = sftpPathToLocalPath(initialPath);
                      const escaped = winPath.replace(/"/g, '""');
                      cdCommand = `cd "${escaped}"\r`;
                    } else {
                      cdCommand = `cd "${initialPath.replace(/"/g, '\\"')}"\r`;
                    }
                    stream.write(cdCommand);
                  }
                  if (executeCommand && executeCommand.trim() !== "") {
                    setTimeout(() => {
                      stream.write(`${executeCommand}\r`);
                    }, 300);
                  }
                }, delay);
              };

              const tmux = deps.getTmux();
              if (tmuxAttachSession && conn && tmux) {
                // Direct attach (tmux monitor): the session is known to exist, so
                // skip detection and reuse the same path as the manual
                // "tmux_attach" websocket message.
                void tmux
                  .attachOrCreate(stream, tmuxAttachSession)
                  .catch(() => {});
                {
                  const session = sessionManager.getSession(boundSessionId);
                  if (session) session.tmuxSessionName = tmuxAttachSession;
                }
                sshLogger.info("Attached to requested tmux session", {
                  operation: "tmux_direct_attach",
                  sessionName: tmuxAttachSession,
                  hostId: id,
                });
                ws.send(
                  JSON.stringify({
                    type: "tmux_session_attached",
                    sessionName: tmuxAttachSession,
                  }),
                );
              } else if (autoTmux && conn && tmux) {
                (async () => {
                  try {
                    const detection = await tmux.detect(conn);
                    if (!detection.available) {
                      sshLogger.warn("tmux not found on remote host", {
                        operation: "tmux_detection",
                        hostId: id,
                      });
                      ws.send(
                        JSON.stringify({
                          type: "tmux_unavailable",
                          message:
                            "tmux is not installed on the remote host. Falling back to standard shell.",
                        }),
                      );
                      runPostShellCommands(0);
                    } else if (detection.sessions.length === 0) {
                      const newName = `termix-${id}-${Date.now().toString(36).slice(-4)}`;
                      void tmux
                        .attachOrCreate(stream, undefined, newName)
                        .catch(() => {});
                      const confirmed = await tmux.waitForSession(
                        conn,
                        newName,
                      );
                      const session = sessionManager.getSession(boundSessionId);
                      if (session) {
                        session.tmuxSessionName = confirmed;
                      }
                      sshLogger.info("Created new tmux session", {
                        operation: "tmux_new_session",
                        sessionName: confirmed,
                        hostId: id,
                      });
                      ws.send(
                        JSON.stringify({
                          type: "tmux_session_created",
                          sessionName: confirmed,
                        }),
                      );
                      runPostShellCommands(0);
                    } else {
                      sshLogger.info(
                        "Multiple tmux sessions found, sending list to frontend",
                        {
                          operation: "tmux_sessions_available",
                          sessions: detection.sessions,
                          hostId: id,
                        },
                      );
                      ws.send(
                        JSON.stringify({
                          type: "tmux_sessions_available",
                          sessions: detection.sessions,
                        }),
                      );
                      // Commands deferred until user picks a session
                    }
                  } catch (error) {
                    sshLogger.error("tmux detection failed", error, {
                      operation: "tmux_detection_error",
                      hostId: id,
                    });
                    // Fallback: run commands in plain shell
                    runPostShellCommands(0);
                  }
                })();
              } else {
                // No tmux -- run commands directly as before
                runPostShellCommands(0);
              }

              ws.send(
                JSON.stringify({ type: "connected", message: "SSH connected" }),
              );

              if (id && hostConfig.userId) {
                try {
                  ctx.events.emit("host.login", {
                    hostId: id,
                    userId: hostConfig.userId,
                    sshUser: username,
                    fromIp: connection.clientIp,
                  });
                } catch (error) {
                  sshLogger.warn("Failed to dispatch login event", {
                    operation: "login_event_dispatch_error",
                    hostId: id,
                    error: getErrorMessage(error),
                  });
                }

                const hostName =
                  resolvedHostData?.userId === hostConfig.userId &&
                  typeof resolvedHostData?.name === "string" &&
                  resolvedHostData.name
                    ? resolvedHostData.name
                    : `${username}@${ip}:${port}`;
                ctx.hosts
                  .recordActivity(id, "terminal", hostName)
                  .catch((error) => {
                    sshLogger.warn("Failed to log terminal activity", {
                      operation: "activity_log_error",
                      userId: hostConfig.userId,
                      hostId: id,
                      error: getErrorMessage(error),
                    });
                  });
              }
            }),
          );
        }),
      );

      sshConn.on(
        "error",
        bind((err: Error) => {
          clearTimeout(connectionTimeout);

          sendLog("error", "error", `Connection error: ${err.message}`);

          sshLogger.error("SSH connection error", err, {
            operation: "ssh_connect",
            hostId: id,
            ip,
            port,
            username,
            authType: resolvedCredentials.authType,
            browserSignInId,
            isKeyboardInteractive,
            hasKeyboardInteractiveFinish: !!keyboardInteractiveFinish,
            keyboardInteractiveResponded,
          });

          // The provider decides what an auth failure means: clear a cached
          // certificate and ask for a new sign-in, retry once, or give up with
          // its own message.
          const authFollowUp = prepared?.onAuthFailed
            ? prepared.onAuthFailed({
                error: err,
                retries: authRetries,
                canRetry: !connectConfig.sock && !bannerHoldPending,
                methodNotAvailable: authMethodNotAvailable,
              })
            : undefined;

          if (authFollowUp?.status === "interaction-required") {
            if (currentSessionId) {
              sessionManager.destroySession(currentSessionId);
              currentSessionId = null;
            }
            cleanupAuthState(connectionTimeout);
            sendLog("auth", "error", authFollowUp.message);
            ws.send(
              JSON.stringify({
                type: `${authFollowUp.interaction}_auth_required`,
                hostId: id,
                message: authFollowUp.message,
              }),
            );
            return;
          }

          if (
            err.message.includes("Cannot parse privateKey") &&
            err.message.includes("no passphrase")
          ) {
            sendLog(
              "auth",
              "error",
              "SSH key is encrypted but no passphrase was provided",
            );
            isAwaitingAuthCredentials = true;
            if (currentSessionId) {
              sessionManager.destroySession(currentSessionId);
              currentSessionId = null;
            }
            cleanupAuthState(connectionTimeout);
            ws.send(
              JSON.stringify({
                type: "passphrase_required",
                message:
                  "The SSH key is encrypted. Please enter the passphrase to unlock it.",
              }),
            );
            return;
          }

          if (authFollowUp?.status === "retry") {
            authRetries++;
            sendLog("auth", "info", authFollowUp.message);
            sshLogger.info("Retrying SSH auth with provider changes", {
              operation: "ssh_auth_retry",
              hostId: id,
              userId,
            });

            clearTimeout(connectionTimeout);
            connectionTimeout = setTimeout(
              onConnectionTimeout,
              (connectConfig.readyTimeout as number | undefined) ?? 120000,
            );

            Object.assign(connectConfig, authFollowUp.patch);

            // ssh2's connect() ends an open socket and reconnects on close, keeping
            // every listener attached, so the same client can be reused here.
            isAuthRetrying = true;
            sshConn.connect(connectConfig);
            return;
          }

          if (authFollowUp?.status === "error") {
            sendLog("auth", "error", authFollowUp.message);
            if (currentSessionId) {
              sessionManager.destroySession(currentSessionId);
              currentSessionId = null;
            }
            cleanupAuthState(connectionTimeout);
            ws.send(
              JSON.stringify({ type: "error", message: authFollowUp.message }),
            );
            return;
          }

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
            isAwaitingAuthCredentials = true;
            if (currentSessionId) {
              sessionManager.destroySession(currentSessionId);
              currentSessionId = null;
            }
            cleanupAuthState(connectionTimeout);
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
            err.message.includes(
              "All configured authentication methods failed",
            ) &&
            !isKeyboardInteractive &&
            !keyboardInteractiveResponded
          ) {
            isAwaitingAuthCredentials = true;
            if (currentSessionId) {
              sessionManager.destroySession(currentSessionId);
              currentSessionId = null;
            }
            cleanupAuthState(connectionTimeout);
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
          } else if (err.message.includes("ENETUNREACH")) {
            const isIPv6 = ip && ip.includes(":");
            errorMessage = isIPv6
              ? "SSH error: Network unreachable. IPv6 may not be available in this environment. If running in Docker, enable IPv6 in the Docker daemon and network configuration."
              : "SSH error: Network unreachable. Check your network configuration and routing.";
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
          if (currentSessionId) {
            sessionManager.destroySession(currentSessionId);
            currentSessionId = null;
          }
          cleanupAuthState(connectionTimeout);
        }),
      );

      sshConn.on(
        "close",
        bind(() => {
          // The +password retry ends the socket before reconnecting; that close is
          // part of the retry, not a disconnect.
          if (isAuthRetrying) {
            return;
          }

          clearOnlineStatus?.();
          clearOnlineStatus = null;

          clearTimeout(connectionTimeout);
          sshLogger.info("SSH connection closed", {
            operation: "terminal_ssh_disconnected",
            sessionId,
            userId,
            hostId: id,
          });

          if (isDuplicateConnDiscarded) {
            cleanupAuthState(connectionTimeout);
            return;
          }

          if (isAwaitingAuthCredentials) {
            if (currentSessionId) {
              sessionManager.destroySession(currentSessionId);
              currentSessionId = null;
            }
            cleanupAuthState(connectionTimeout);
            return;
          }

          if (isShellInitializing || (isConnected && !sshStream)) {
            sshLogger.warn(
              "SSH connection closed during shell initialization",
              {
                operation: "ssh_close_during_init",
                hostId: id,
                ip,
                port,
                username,
                isShellInitializing,
                hasStream: !!sshStream,
              },
            );
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message:
                    "Connection closed during shell initialization. The server may have rejected the shell request.",
                }),
              );
            }
          } else {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "disconnected",
                  message: "Connection closed",
                }),
              );
            }
          }
          if (currentSessionId) {
            sessionManager.destroySession(currentSessionId);
            currentSessionId = null;
          }
          cleanupAuthState(connectionTimeout);
        }),
      );

      const sshAuthManager = new SSHAuthManager({
        ssh: ctx.ssh,
        log: sshLogger,
        userId,
        ws,
        hostId: id || 0,
        isKeyboardInteractive,
        keyboardInteractiveResponded,
        keyboardInteractiveFinish,
        totpPromptSent,
        browserSignInId,
        totpTimeout,
        browserSignInTimeout,
        totpAttempts: 0,
      });

      sshConn.on(
        "keyboard-interactive",
        bind(
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
              resolvedCredentials as unknown as Parameters<
                typeof sshAuthManager.handleKeyboardInteractive
              >[5],
              // The resolved host carries the plugin host settings that
              // keyboard-interactive handlers read.
              connectTarget ?? hostConfig,
            );

            isKeyboardInteractive =
              sshAuthManager.context.isKeyboardInteractive;
            keyboardInteractiveResponded =
              sshAuthManager.context.keyboardInteractiveResponded;
            keyboardInteractiveFinish =
              sshAuthManager.context.keyboardInteractiveFinish;
            totpPromptSent = sshAuthManager.context.totpPromptSent;
            browserSignInId = sshAuthManager.context.browserSignInId;
            totpTimeout = sshAuthManager.context.totpTimeout;
            browserSignInTimeout = sshAuthManager.context.browserSignInTimeout;
          },
        ),
      );

      const effectiveAuthType =
        resolvedCredentials.authType ||
        (resolvedCredentials.key
          ? "key"
          : resolvedCredentials.password
            ? "password"
            : undefined);
      if (!effectiveAuthType) {
        sshLogger.error("No valid authentication method provided");
        ws.send(
          JSON.stringify({
            type: "error",
            message: "No valid authentication method provided",
          }),
        );
        return;
      }

      connectTarget = {
        ...(resolvedHostData ?? {}),
        id: serverHostId ?? id,
        ip,
        port,
        username,
        userId: hostConfig.userId,
        authType: effectiveAuthType,
        password: resolvedCredentials.password,
        key: resolvedCredentials.key,
        keyPassword: resolvedCredentials.keyPassword,
        keyType: resolvedCredentials.keyType,
        certPublicKey: resolvedCredentials.certPublicKey,
        forceKeyboardInteractive: hostConfig.forceKeyboardInteractive,
        terminalConfig: hostConfig.terminalConfig,
        jumpHosts: hostConfig.jumpHosts,
        useSocks5: hostConfig.useSocks5,
        socks5Host: hostConfig.socks5Host,
        socks5Port: hostConfig.socks5Port,
        socks5Username: hostConfig.socks5Username,
        socks5Password: hostConfig.socks5Password,
        socks5ProxyChain: hostConfig.socks5ProxyChain,
        portKnockSequence: hostConfig.portKnockSequence,
      } as PluginSshHost;

      const built = await ctx.ssh.prepare(connectTarget, {
        purpose: "terminal",
        profile: "terminal",
        client: sshConn,
        serverHostId: serverHostId ?? undefined,
        hostKeySocket: ws,
        interactive: true,
        log: (level, message) => sendLog("auth", level, message),
      });
      const connectConfig = built.config;
      // DNS was resolved above, and skipped when jump hosts do it instead.
      connectConfig.host = connectHost;
      prepared = built;

      if (built.outcome.status !== "ready") {
        const outcome = built.outcome;
        if (outcome.status === "interaction-required") {
          ws.send(
            JSON.stringify({
              type: `${outcome.interaction}_auth_required`,
              hostId: id,
            }),
          );
          return;
        }
        if (
          outcome.status === "error" &&
          outcome.code === "passphrase-required"
        ) {
          sendLog(
            "auth",
            "error",
            "SSH key is encrypted but no passphrase was provided",
          );
          isAwaitingAuthCredentials = true;
          cleanupAuthState(connectionTimeout);
          ws.send(
            JSON.stringify({
              type: "passphrase_required",
              message: outcome.message,
            }),
          );
          return;
        }
        sshLogger.error("SSH auth could not be prepared", {
          operation: "terminal_auth_prepare",
          hostId: id,
          authType: effectiveAuthType,
          error: outcome.message,
        });
        sendLog("auth", "error", outcome.message);
        ws.send(JSON.stringify({ type: "error", message: outcome.message }));
        return;
      }

      if (hostConfig.terminalConfig?.agentForwarding) {
        if (connectConfig.privateKey) {
          try {
            const parsed = ssh2Utils.parseKey(
              connectConfig.privateKey as Buffer,
              connectConfig.passphrase as string | undefined,
            );
            if (parsed && !(parsed instanceof Error)) {
              connectConfig.agent = new MemoryAgent(parsed);
              connectConfig.agentForward = true;
              sendLog("auth", "info", "SSH agent forwarding enabled");
            }
          } catch {
            sshLogger.warn("Failed to set up agent forwarding", {
              operation: "agent_forward_setup",
              hostId: id,
            });
          }
        } else if (connectConfig.agent) {
          connectConfig.agentForward = true;
          sendLog(
            "auth",
            "info",
            "SSH agent forwarding enabled (external agent)",
          );
        }
      }

      const proxyChain = Array.isArray(connectTarget.socks5ProxyChain)
        ? connectTarget.socks5ProxyChain
        : [];
      const viaProxy =
        !!connectTarget.useSocks5 &&
        (!!connectTarget.socks5Host || proxyChain.length > 0);

      let transport: Awaited<ReturnType<typeof ctx.ssh.openTransport>>;
      try {
        transport = await ctx.ssh.openTransport(connectTarget, connectConfig, {
          // Resolved above, or deliberately left to the jump host.
          resolveDns: false,
          log: (level, message) => sendLog("handshake", level, message),
        });
      } catch (error) {
        sshLogger.error("SSH transport failed", error, {
          operation: "ssh_transport",
          hostId: id,
          ip,
          port,
        });
        ws.send(
          JSON.stringify({
            type: "error",
            message:
              error instanceof Error && error.name === "JumpHostChainError"
                ? `Failed to connect through jump hosts: ${error.message}`
                : getErrorMessage(error),
          }),
        );
        if (currentSessionId) {
          sessionManager.destroySession(currentSessionId);
          currentSessionId = null;
        }
        cleanupAuthState(connectionTimeout);
        return;
      }
      lastJumpClient = transport.jumpClient as SSHClientType | null;

      sendLog(
        "handshake",
        "info",
        transport.via === "jump"
          ? "Starting SSH session through jump host" +
              (viaProxy ? " (via proxy)" : "")
          : transport.via === "proxy"
            ? "Starting SSH session (via proxy)"
            : "Starting SSH session",
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
        via: transport.via,
      });
      sshConn.connect(connectConfig);
    }

    function handleResize(data: ResizeData) {
      const cols = toTerminalDimension(data?.cols);
      const rows = toTerminalDimension(data?.rows);
      if (!cols || !rows) return;

      const resizeStream =
        sessionManager.getSession(currentSessionId)?.sshStream ?? sshStream;
      if (resizeStream && resizeStream.setWindow) {
        resizeStream.setWindow(rows, cols, rows, cols);
        const session = sessionManager.getSession(currentSessionId);
        if (session) {
          session.cols = cols;
          session.rows = rows;
          sessionManager.bufferResize(session.id, cols, rows);
        }
        ws.send(JSON.stringify({ type: "resized", cols, rows }));
      }
    }

    function cleanupAuthState(timeoutId?: NodeJS.Timeout) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (totpTimeout) {
        clearTimeout(totpTimeout);
        totpTimeout = null;
      }

      if (browserSignInTimeout) {
        clearTimeout(browserSignInTimeout);
        browserSignInTimeout = null;
      }

      sshStream = null;
      sshConn = null;
      lastJumpClient = null;

      resetConnectionState();
      isCleaningUp = false;
      isAwaitingAuthCredentials = false;
    }

    // Note: PTY-level keepalive (writing \x00 to the stream) was removed.
    // It was causing ^@ characters to appear in terminals with echoctl enabled.
    // SSH-level keepalive is configured via connectConfig (keepaliveInterval,
    // keepaliveCountMax, tcpKeepAlive), which handles connection health monitoring
    // without producing visible output on the terminal.
    //
    // See: https://github.com/Termix-SSH/Support/issues/232
    // See: https://github.com/Termix-SSH/Support/issues/309
  }

  return { handleConnection, closeAll };
}
