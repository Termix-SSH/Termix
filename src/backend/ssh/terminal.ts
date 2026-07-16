import { WebSocketServer, WebSocket, type RawData } from "ws";
import ssh2Pkg, {
  type Client as SSHClientType,
  type ClientChannel,
  type PseudoTtyOptions,
} from "ssh2";
const { Client, utils: ssh2Utils } = ssh2Pkg;
import { buildSSHAlgorithms } from "../utils/ssh-algorithms.js";
import axios from "axios";
import { getDb } from "../database/db/index.js";
import { hosts } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { sshLogger, authLogger } from "../utils/logger.js";
import { logAudit } from "../utils/audit-logger.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { AuthManager } from "../utils/auth-manager.js";
import { UserCrypto } from "../utils/user-crypto.js";
import {
  createSocks5Connection,
  type SOCKS5Config,
} from "../utils/socks5-helper.js";
import { SSHAuthManager } from "./auth-manager.js";
import type { ProxyNode } from "../../types/index.js";
import { SSHHostKeyVerifier } from "./host-key-verifier.js";
import { createJumpHostChain } from "./terminal-jump-hosts.js";
import { sessionManager } from "./terminal-session-manager.js";
import {
  detectTmux,
  attachOrCreateTmuxSession,
  waitForTmuxSession,
} from "./tmux-helper.js";
import {
  applyAgentAuth,
  MemoryAgent,
  performPortKnocking,
} from "./terminal-auth-helpers.js";
import { isWindowsSftpPath, sftpPathToLocalPath } from "./transfer-paths.js";
import { preparePrivateKeyForSSH2 } from "../utils/ssh-key-utils.js";
import { triggerLoginAlert } from "../utils/alert-trigger.js";
import { isRetriableDnsError, resolveHostForSshConnect } from "./ssh-dns.js";

interface ConnectToHostData {
  cols: number;
  rows: number;
  hostConfig: {
    id: number;
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
    passwordFallbackOnly?: boolean;
    passwordFallbackAttempted?: boolean;
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
    enableSessionLogging?: boolean;
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
});

wss.on("connection", async (ws: WebSocket, req) => {
  let userId: string | undefined;
  let sessionId: string | undefined;

  try {
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
      const urlObj = new URL(req.url || "", "http://localhost");
      const qp = urlObj.searchParams.get("token");
      if (qp) token = qp;
    }

    if (!token) {
      ws.close(1008, "Authentication required");
      return;
    }

    const payload = await authManager.verifyJWTToken(token);
    if (!payload?.userId || payload.pendingTOTP) {
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

  let currentSessionId: string | null = null;
  let sshConn: SSHClientType | null = null;
  let sshStream: ClientChannel | null = null;
  let lastJumpClient: SSHClientType | null = null;
  let keyboardInteractiveFinish: ((responses: string[]) => void) | null = null;
  let totpPromptSent = false;
  let totpTimeout: NodeJS.Timeout | null = null;
  let isKeyboardInteractive = false;
  let keyboardInteractiveResponded = false;
  let isConnecting = false;
  let isConnected = false;
  let isCleaningUp = false;
  let isShellInitializing = false;
  let isDuplicateConnDiscarded = false;
  let warpgateAuthPromptSent = false;
  let warpgateAuthTimeout: NodeJS.Timeout | null = null;
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

  ws.on("close", () => {
    clearInterval(wsPingInterval);
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

    if (currentSessionId) {
      const session = sessionManager.getSession(currentSessionId);
      if (session?.isConnected) {
        // Only detach if this WS is still the one attached to the session.
        // If a refresh reconnected and reattached a new WS before this close
        // event fired, we must not clobber that new attachment.
        if (session.attachedWs === ws || session.attachedWs === null) {
          sessionManager.detachWs(currentSessionId);
        }
      } else {
        sessionManager.destroySession(currentSessionId);
        currentSessionId = null;
      }
    }
    cleanupAuthState();
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
          const errMsg =
            error instanceof Error ? error.message : "Unknown error";
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
          if (
            attachData.cols !== session.cols ||
            attachData.rows !== session.rows
          ) {
            session.sshStream?.setWindow(
              attachData.rows,
              attachData.cols,
              attachData.rows,
              attachData.cols,
            );
            session.cols = attachData.cols;
            session.rows = attachData.rows;
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

      case "disconnect":
        if (currentSessionId) {
          sessionManager.destroySession(currentSessionId);
          currentSessionId = null;
        }
        cleanupAuthState();
        sshConn = null;
        sshStream = null;
        break;

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
            const attachedWs =
              sessionManager.getSession(currentSessionId)?.attachedWs ?? ws;
            if (attachedWs.readyState === WebSocket.OPEN) {
              attachedWs.send(JSON.stringify({ type: "cwd", path: cwd }));
            }
          });
        });
        break;
      }

      case "open_file_in_editor": {
        const { path: requestedPath } = data as { path: string };
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
              const attachedWs =
                sessionManager.getSession(currentSessionId)?.attachedWs ?? ws;
              if (attachedWs.readyState === WebSocket.OPEN) {
                attachedWs.send(
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
        const inputData = data as string;
        if (currentSessionId) {
          sessionManager.bufferInput(currentSessionId, inputData);
        }
        const inputStream =
          sessionManager.getSession(currentSessionId)?.sshStream ?? sshStream;
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
              sshLogger.error("Error writing input to SSH stream", error, {
                operation: "ssh_input_encoding",
                userId,
                dataLength: inputData.length,
              });
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
        if (session?.sshStream) {
          const existingName = tmuxData.sessionName || undefined;
          if (existingName) {
            attachOrCreateTmuxSession(session.sshStream, existingName);
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
            attachOrCreateTmuxSession(session.sshStream, undefined, newName);
            const sshConn = session.sshConn;
            if (sshConn) {
              (async () => {
                const confirmed = await waitForTmuxSession(sshConn, newName);
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
            JSON.stringify({ type: "tmux_detached", sessionName: tmuxName }),
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
          (
            credentialsData.hostConfig as Record<string, unknown>
          ).userProvidedPassword = true;
        } else if (credentialsData.sshKey) {
          credentialsData.hostConfig.key = credentialsData.sshKey;
          credentialsData.hostConfig.keyPassword = credentialsData.keyPassword;
          credentialsData.hostConfig.authType = "key";
        } else if (credentialsData.keyPassword) {
          credentialsData.hostConfig.keyPassword = credentialsData.keyPassword;
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
          const errMsg =
            error instanceof Error ? error.message : "Unknown error";
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
              message: "Failed to connect with provided credentials: " + errMsg,
            }),
          );
        });
        break;
      }

      case "opkssh_start_auth": {
        const opksshData = data as { hostId: number };
        try {
          const { startOPKSSHAuth } = await import("./opkssh-auth.js");
          const { getRequestBaseUrl } =
            await import("../utils/request-origin.js");
          const db = getDb();
          const hostRow = await db
            .select()
            .from(hosts)
            .where(eq(hosts.id, opksshData.hostId))
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
          const requestOrigin = getRequestBaseUrl(req);
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
          hostConfig?: ConnectToHostData["hostConfig"];
        };

        resetConnectionState();

        const reconnectConfig: ConnectToHostData = {
          cols: completedData.cols || 80,
          rows: completedData.rows || 24,
          hostConfig:
            completedData.hostConfig ||
            ({
              id: completedData.hostId,
              ip: "",
              port: 22,
              username: "",
              userId,
            } as ConnectToHostData["hostConfig"]),
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

      case "vault_start_auth": {
        const vaultData = data as { hostId: number };
        try {
          const { loadVaultProfileForHost, startVaultAuth } =
            await import("./vault-oidc-auth.js");
          const { getRequestBaseUrl } =
            await import("../utils/request-origin.js");
          const profile = await loadVaultProfileForHost(vaultData.hostId);
          if (!profile) {
            ws.send(
              JSON.stringify({
                type: "vault_error",
                hostId: vaultData.hostId,
                error: "No Vault signer profile configured for this host",
              }),
            );
            break;
          }
          const requestOrigin = getRequestBaseUrl(req);
          await startVaultAuth(
            userId,
            vaultData.hostId,
            profile,
            ws,
            requestOrigin,
          );
        } catch (error) {
          sshLogger.error("Failed to start Vault auth", error, {
            operation: "vault_start_auth_error",
            userId,
            hostId: vaultData.hostId,
          });
          ws.send(
            JSON.stringify({
              type: "vault_error",
              hostId: vaultData.hostId,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to start Vault authentication",
            }),
          );
        }
        break;
      }

      case "vault_cancel": {
        const cancelData = data as { hostId: number };
        try {
          const { cancelVaultAuthByHost } =
            await import("./vault-oidc-auth.js");
          cancelVaultAuthByHost(userId, cancelData.hostId);
          resetConnectionState();
        } catch (error) {
          sshLogger.error("Failed to cancel Vault auth", error, {
            operation: "vault_cancel_error",
            userId,
          });
        }
        break;
      }

      case "vault_auth_completed": {
        const completedData = data as {
          hostId: number;
          cols?: number;
          rows?: number;
          hostConfig?: ConnectToHostData["hostConfig"];
        };

        resetConnectionState();

        const reconnectConfig: ConnectToHostData = {
          cols: completedData.cols || 80,
          rows: completedData.rows || 24,
          hostConfig:
            completedData.hostConfig ||
            ({
              id: completedData.hostId,
              ip: "",
              port: 22,
              username: "",
              userId,
            } as ConnectToHostData["hostConfig"]),
        };

        handleConnectToHost(reconnectConfig).catch((error) => {
          sshLogger.error("Failed to reconnect after Vault auth", error, {
            operation: "vault_reconnect_error",
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
    const { hostConfig, initialPath, executeCommand, tmuxAttachSession } = data;
    const {
      id,
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
        if (currentSessionId) {
          sessionManager.destroySession(currentSessionId);
          currentSessionId = null;
        }
        cleanupAuthState(connectionTimeout);
      }
    }, 120000);

    let resolvedHostData:
      | (Record<string, unknown> & {
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
          enableSessionLogging?: boolean;
        })
      | null = null;

    if (id && userId) {
      try {
        const { resolveHostById } = await import("./host-resolver.js");
        resolvedHostData = (await resolveHostById(
          id,
          userId,
        )) as unknown as typeof resolvedHostData;

        if (resolvedHostData) {
          ip = resolvedHostData.ip || ip;
          port = resolvedHostData.port || port;
          username = resolvedHostData.username || username;

          if (
            (!hostConfig.jumpHosts || hostConfig.jumpHosts.length === 0) &&
            resolvedHostData.jumpHosts &&
            resolvedHostData.jumpHosts.length > 0
          ) {
            hostConfig.jumpHosts = resolvedHostData.jumpHosts;
            sendLog(
              "jump",
              "info",
              `Loaded ${resolvedHostData.jumpHosts.length} jump host(s) from server-side host data`,
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
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

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
          resolvedCredentials = {
            username,
            password: resolvedHostData.password,
            key: resolvedHostData.key,
            keyPassword: keyPassword || resolvedHostData.keyPassword,
            keyType: resolvedHostData.keyType,
            authType: resolvedHostData.authType,
            certPublicKey: resolvedHostData.certPublicKey as string | undefined,
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
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    } else if (credentialId && id && userId) {
      try {
        if (resolvedHostData) {
          resolvedCredentials = {
            username,
            password: resolvedHostData.password,
            key: resolvedHostData.key,
            // Preserve user-supplied keyPassword (e.g. from passphrase dialog) over the empty DB value
            keyPassword: keyPassword || resolvedHostData.keyPassword,
            keyType: resolvedHostData.keyType,
            authType: resolvedHostData.authType,
            certPublicKey: resolvedHostData.certPublicKey as string | undefined,
          };
        }
      } catch (error) {
        sshLogger.warn(`Failed to resolve credentials for host ${id}`, {
          operation: "ssh_credentials",
          hostId: id,
          credentialId,
          error: error instanceof Error ? error.message : "Unknown error",
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

    sendLog("dns", "info", `Starting address resolution of ${ip}`);
    let connectHost = ip;
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
      const message = error instanceof Error ? error.message : "Unknown error";
      sshLogger.error("SSH hostname resolution failed", error, {
        operation: "terminal_dns_resolve",
        hostId: id,
        ip,
        port,
        transient: isRetriableDnsError(error),
      });
      sendLog("dns", "error", `DNS resolution failed for ${ip}: ${message}`);
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
    sendLog("tcp", "info", `Connecting to ${ip} port ${port}`);

    sshConn.on("ready", () => {
      clearTimeout(connectionTimeout);
      sshLogger.success("SSH connection established", {
        operation: "terminal_ssh_connected",
        sessionId,
        userId,
        hostId: id,
        ip,
      });

      logAudit({
        userId,
        username: userId,
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
      sendLog("auth", "success", `Authentication successful for ${username}`);
      sendLog("connected", "success", "Connection established");

      const hostDisplayName = `${username}@${ip}:${port}`;
      const tabInstanceId = hostConfig.instanceId;
      const sessionLoggingEnabled =
        resolvedHostData?.enableSessionLogging ??
        hostConfig.enableSessionLogging ??
        true;
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
          JSON.stringify({ type: "connected", message: "Session reattached" }),
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

          stream.on("data", (data: Buffer) => {
            try {
              const utf8String = data.toString("utf-8");

              if (!utf8String) return;

              const session = sessionManager.getSession(boundSessionId);
              if (session) {
                sessionManager.bufferOutput(boundSessionId!, utf8String);

                if (session.attachedWs?.readyState === WebSocket.OPEN) {
                  session.attachedWs.send(
                    JSON.stringify({ type: "data", data: utf8String }),
                  );
                }
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

                if (session.attachedWs?.readyState === WebSocket.OPEN) {
                  session.attachedWs.send(
                    JSON.stringify({ type: "data", data: fallback }),
                  );
                }
              }
            }
          });

          stream.on("close", (code: number | null) => {
            const session = sessionManager.getSession(boundSessionId);
            if (session?.attachedWs?.readyState === WebSocket.OPEN) {
              if (code != null) {
                session.attachedWs.send(
                  JSON.stringify({
                    type: "session_ended",
                    code,
                  }),
                );
              } else {
                session.attachedWs.send(
                  JSON.stringify({
                    type: "disconnected",
                    message: "Connection lost",
                    graceful: true,
                  }),
                );
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
            if (session?.attachedWs?.readyState === WebSocket.OPEN) {
              session.attachedWs.send(
                JSON.stringify({
                  type: "error",
                  message: "SSH stream error: " + err.message,
                }),
              );
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

          if (tmuxAttachSession && conn) {
            // Direct attach (tmux monitor): the session is known to exist, so
            // skip detection and reuse the same path as the manual
            // "tmux_attach" websocket message.
            attachOrCreateTmuxSession(stream, tmuxAttachSession);
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
          } else if (autoTmux && conn) {
            (async () => {
              try {
                const detection = await detectTmux(conn);
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
                  attachOrCreateTmuxSession(stream, undefined, newName);
                  const confirmed = await waitForTmuxSession(conn, newName);
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
            triggerLoginAlert(
              id,
              hostConfig.userId,
              username,
              req.socket.remoteAddress ?? "unknown",
            ).catch(() => {});
          }

          if (id && hostConfig.userId) {
            (async () => {
              try {
                const hostResults = await SimpleDBOps.select(
                  getDb()
                    .select()
                    .from(hosts)
                    .where(
                      and(
                        eq(hosts.id, id),
                        eq(hosts.userId, hostConfig.userId!),
                      ),
                    ),
                  "ssh_data",
                  hostConfig.userId!,
                );

                const hostName =
                  hostResults.length > 0 && hostResults[0].name
                    ? hostResults[0].name
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

      const isAuthFailure =
        err.message.includes("All configured authentication methods failed") ||
        err.message.includes("authentication failed") ||
        err.message.includes("Authentication failed") ||
        err.message.includes("Permission denied");

      if (
        resolvedCredentials.authType === "key" &&
        resolvedCredentials.password &&
        isAuthFailure &&
        !hostConfig.passwordFallbackAttempted
      ) {
        sendLog(
          "auth",
          "warning",
          "SSH key authentication failed; retrying with stored password",
        );
        sshLogger.warn("Retrying SSH connection with stored password", {
          operation: "terminal_key_password_fallback",
          hostId: id,
          userId,
        });
        if (currentSessionId) {
          sessionManager.destroySession(currentSessionId);
          currentSessionId = null;
        }
        cleanupAuthState(connectionTimeout);
        sshConn = null;
        sshStream = null;
        handleConnectToHost({
          ...data,
          hostConfig: {
            ...hostConfig,
            authType: "password",
            password: resolvedCredentials.password,
            key: undefined,
            keyPassword: undefined,
            keyType: undefined,
            passwordFallbackOnly: true,
            passwordFallbackAttempted: true,
          },
        }).catch((fallbackError) => {
          const fallbackMessage =
            fallbackError instanceof Error
              ? fallbackError.message
              : "Unknown error";
          sshLogger.error(
            "Password fallback connection failed",
            fallbackError,
            {
              operation: "terminal_key_password_fallback_error",
              hostId: id,
              userId,
            },
          );
          ws.send(
            JSON.stringify({
              type: "error",
              message:
                "Failed to retry with stored password: " + fallbackMessage,
            }),
          );
        });
        return;
      }

      if (
        resolvedCredentials.authType === "opkssh" &&
        err.message.includes("All configured authentication methods failed")
      ) {
        sshLogger.warn("OPKSSH authentication failed - invalidating token", {
          operation: "opkssh_auth_failed",
          hostId: id,
          userId,
          error: err.message,
        });

        (async () => {
          try {
            const { invalidateOPKSSHToken } = await import("./opkssh-auth.js");
            await invalidateOPKSSHToken(userId, id, "SSH auth failed");
          } catch (invalidateError) {
            sshLogger.error("Failed to invalidate OPKSSH token", {
              operation: "opkssh_token_invalidation_error",
              userId,
              hostId: id,
              error: invalidateError,
            });
          }
        })();

        if (currentSessionId) {
          sessionManager.destroySession(currentSessionId);
          currentSessionId = null;
        }
        cleanupAuthState(connectionTimeout);

        sendLog(
          "auth",
          "error",
          "OPKSSH certificate authentication failed. Please authenticate again.",
        );

        ws.send(
          JSON.stringify({
            type: "opkssh_auth_required",
            hostId: id,
            message:
              "OPKSSH authentication failed or expired. Please authenticate again.",
          }),
        );
        return;
      }

      if (
        resolvedCredentials.authType === "vault" &&
        err.message.includes("All configured authentication methods failed")
      ) {
        sshLogger.warn("Vault certificate authentication failed", {
          operation: "vault_auth_failed",
          hostId: id,
          userId,
          error: err.message,
        });

        (async () => {
          try {
            const profileId = (
              resolvedHostData?.vaultProfile as { id?: number } | undefined
            )?.id;
            if (profileId) {
              const { deleteVaultCert } =
                await import("./vault-signer-auth.js");
              await deleteVaultCert(userId, profileId);
            }
          } catch (invalidateError) {
            sshLogger.error("Failed to invalidate Vault certificate", {
              operation: "vault_cert_invalidation_error",
              userId,
              hostId: id,
              error: invalidateError,
            });
          }
        })();

        if (currentSessionId) {
          sessionManager.destroySession(currentSessionId);
          currentSessionId = null;
        }
        cleanupAuthState(connectionTimeout);

        sendLog(
          "auth",
          "error",
          "Vault certificate authentication failed. Please authenticate again.",
        );

        ws.send(
          JSON.stringify({
            type: "vault_auth_required",
            hostId: id,
            message:
              "Vault authentication failed or expired. Please authenticate again.",
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

      if (
        resolvedCredentials.authType === "tailscale" &&
        (authMethodNotAvailable ||
          err.message.includes("All configured authentication methods failed"))
      ) {
        sendLog(
          "auth",
          "error",
          "Tailscale SSH authentication failed. Ensure Tailscale is running on the server, SSH is advertised (tailscale set --ssh), and your ACL policy permits this connection.",
        );
        if (currentSessionId) {
          sessionManager.destroySession(currentSessionId);
          currentSessionId = null;
        }
        cleanupAuthState(connectionTimeout);
        ws.send(
          JSON.stringify({
            type: "error",
            message:
              "Tailscale SSH authentication failed. Ensure Tailscale is running on the server, SSH is advertised (tailscale set --ssh), and your ACL policy permits this connection.",
          }),
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
        err.message.includes("All configured authentication methods failed") &&
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
    });

    sshConn.on("close", () => {
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
        sshLogger.warn("SSH connection closed during shell initialization", {
          operation: "ssh_close_during_init",
          hostId: id,
          ip,
          port,
          username,
          isShellInitializing,
          hasStream: !!sshStream,
        });
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
          resolvedCredentials as unknown as Parameters<
            typeof sshAuthManager.handleKeyboardInteractive
          >[5],
          hostConfig,
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

    const hostKeepaliveInterval = hostConfig.terminalConfig?.keepaliveInterval;
    const hostKeepaliveCountMax = hostConfig.terminalConfig?.keepaliveCountMax;

    // Pre-fetch the stored host key before connect so the verifier callback
    // runs synchronously during SSH key exchange, avoiding LoginGraceTime
    // expiry on slow connections (especially through jump host tunnels).
    const preloadedHostData = await SSHHostKeyVerifier.preloadHostData(id);

    const connectConfig: Record<string, unknown> = {
      host: connectHost,
      port,
      username,
      tryKeyboard: resolvedCredentials.authType !== "tailscale",
      keepaliveInterval:
        typeof hostKeepaliveInterval === "number"
          ? Math.max(5000, hostKeepaliveInterval * 1000)
          : 30000,
      keepaliveCountMax:
        typeof hostKeepaliveCountMax === "number"
          ? Math.max(1, hostKeepaliveCountMax)
          : 5,
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
        preloadedHostData,
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
      algorithms: buildSSHAlgorithms(
        hostConfig.terminalConfig?.allowLegacyAlgorithms !== false,
      ),
    };

    if (
      resolvedCredentials.authType === "none" ||
      resolvedCredentials.authType === "tailscale"
    ) {
      // Tailscale SSH and "none": no static credentials needed
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
        connectConfig.privateKey = preparePrivateKeyForSSH2(
          resolvedCredentials.key,
          resolvedCredentials.keyPassword,
        );

        if (resolvedCredentials.keyPassword) {
          connectConfig.passphrase = resolvedCredentials.keyPassword;
        }

        if (resolvedCredentials.password) {
          connectConfig.password = resolvedCredentials.password;
        }

        // Apply CA-signed certificate if one is stored in the credential
        if (
          resolvedCredentials.certPublicKey &&
          resolvedCredentials.certPublicKey.trim()
        ) {
          try {
            const { setupCACertAuth } = await import("./opkssh-cert-auth.js");
            await setupCACertAuth(
              connectConfig,
              sshConn,
              connectConfig.privateKey as Buffer,
              resolvedCredentials.certPublicKey,
              username,
              resolvedCredentials.keyPassword,
            );
            sendLog("auth", "info", "CA certificate authentication configured");
            sshLogger.info("CA cert auth configured", {
              operation: "ca_cert_auth_configured",
              userId,
              hostId: id,
            });
          } catch (certError) {
            sendLog(
              "auth",
              "warning",
              "CA certificate setup failed – falling back to key-only auth",
            );
            sshLogger.warn("CA cert auth setup failed", {
              operation: "ca_cert_auth_setup_failed",
              userId,
              hostId: id,
              error:
                certError instanceof Error
                  ? certError.message
                  : String(certError),
            });
          }
        }
      } catch (keyError) {
        const message =
          keyError instanceof Error
            ? keyError.message
            : "Invalid private key format";
        sshLogger.error("SSH key format error: " + message);
        ws.send(
          JSON.stringify({
            type: "error",
            message: `SSH key format error: ${message}`,
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

        const { setupOPKSSHCertAuth } = await import("./opkssh-cert-auth.js");
        await setupOPKSSHCertAuth(connectConfig, sshConn, token, username);
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
    } else if (resolvedCredentials.authType === "vault") {
      sendLog("auth", "info", "Using Vault SSH signer authentication");
      try {
        const vaultProfile = resolvedHostData?.vaultProfile as
          | { id: number }
          | undefined;
        if (!vaultProfile?.id) {
          throw new Error("Host has no Vault signer profile configured");
        }

        const { getVaultCert } = await import("./vault-signer-auth.js");
        const cert = await getVaultCert(userId, vaultProfile.id);

        if (!cert) {
          sendLog(
            "auth",
            "info",
            "No valid Vault certificate found, requesting authentication",
          );
          ws.send(
            JSON.stringify({
              type: "vault_auth_required",
              hostId: id,
            }),
          );
          return;
        }

        sendLog("auth", "info", "Using cached Vault-signed certificate");

        const { setupOPKSSHCertAuth } = await import("./opkssh-cert-auth.js");
        await setupOPKSSHCertAuth(
          connectConfig,
          sshConn,
          { privateKey: cert.privateKey, sshCert: cert.sshCert },
          username,
        );
      } catch (vaultError) {
        sshLogger.error("Vault SSH signer authentication error", vaultError, {
          operation: "vault_auth_error",
          userId,
          hostId: id,
        });
        ws.send(
          JSON.stringify({
            type: "error",
            message:
              "Vault SSH signer authentication failed: " +
              (vaultError instanceof Error
                ? vaultError.message
                : "Unknown error"),
          }),
        );
        return;
      }
    } else if (resolvedCredentials.authType === "agent") {
      sendLog("auth", "info", "Using SSH agent authentication");
      const result = await applyAgentAuth(
        connectConfig as Record<string, unknown>,
        hostConfig.terminalConfig as Record<string, unknown> | undefined,
      );
      if ("error" in result) {
        ws.send(JSON.stringify({ type: "error", message: result.error }));
        return;
      }
      sendLog(
        "auth",
        "info",
        `SSH agent configured (socket: ${result.socketPath})`,
      );
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
      } else if (
        resolvedCredentials.authType === "agent" &&
        connectConfig.agent
      ) {
        connectConfig.agentForward = true;
        sendLog(
          "auth",
          "info",
          "SSH agent forwarding enabled (external agent)",
        );
      }
    }

    if (
      hostConfig.portKnockSequence &&
      hostConfig.portKnockSequence.length > 0
    ) {
      try {
        sshLogger.info(
          `Port knocking ${hostConfig.ip} (${hostConfig.portKnockSequence.length} ports)`,
          { operation: "port_knock", hostId: hostConfig.id },
        );
        await performPortKnocking(hostConfig.ip, hostConfig.portKnockSequence);
      } catch {
        sshLogger.warn("Port knocking failed, attempting connection anyway", {
          operation: "port_knock",
          hostId: hostConfig.id,
        });
      }
    }

    const proxyConfig: SOCKS5Config | null =
      hostConfig.useSocks5 &&
      (hostConfig.socks5Host ||
        (hostConfig.socks5ProxyChain &&
          (hostConfig.socks5ProxyChain as ProxyNode[]).length > 0))
        ? {
            useSocks5: hostConfig.useSocks5,
            socks5Host: hostConfig.socks5Host,
            socks5Port: hostConfig.socks5Port,
            socks5Username: hostConfig.socks5Username,
            socks5Password: hostConfig.socks5Password,
            socks5ProxyChain: hostConfig.socks5ProxyChain as ProxyNode[],
          }
        : null;

    const hasJumpHosts =
      hostConfig.jumpHosts &&
      hostConfig.jumpHosts.length > 0 &&
      hostConfig.userId;

    // Cloudflare Tunnel: connect via WebSocket proxy
    const cfConfig = hostConfig.terminalConfig as
      | Record<string, unknown>
      | undefined;
    if (cfConfig?.cfAccessClientId && cfConfig?.cfAccessClientSecret) {
      try {
        const WebSocket = (await import("ws")).default;
        const cfHostname = (cfConfig.cfTunnelHostname as string) || ip;
        const wsUrl = `wss://${cfHostname}/cdn-cgi/access/ssh-connect`;
        const cfWs = new WebSocket(wsUrl, {
          headers: {
            "CF-Access-Client-Id": cfConfig.cfAccessClientId as string,
            "CF-Access-Client-Secret": cfConfig.cfAccessClientSecret as string,
          },
        });

        await new Promise<void>((resolve, reject) => {
          cfWs.on("open", () => resolve());
          cfWs.on("error", (err) => reject(err));
          setTimeout(
            () => reject(new Error("Cloudflare tunnel timeout")),
            30000,
          );
        });

        const { Duplex } = await import("stream");
        const duplexStream = new Duplex({
          read() {},
          write(chunk, _encoding, callback) {
            cfWs.send(chunk, callback);
          },
        });
        cfWs.on("message", (data) => duplexStream.push(data));
        cfWs.on("close", () => duplexStream.push(null));

        connectConfig.sock =
          duplexStream as unknown as typeof connectConfig.sock;
        sendLog("handshake", "info", "Connected via Cloudflare Tunnel");
      } catch (cfError) {
        sshLogger.error("Cloudflare tunnel connection failed", cfError, {
          operation: "cf_tunnel_connect",
          hostId: id,
        });
        ws.send(
          JSON.stringify({
            type: "error",
            message:
              "Cloudflare tunnel connection failed: " +
              (cfError instanceof Error ? cfError.message : "Unknown error"),
          }),
        );
        cleanupAuthState(connectionTimeout);
        return;
      }
    }

    if (hasJumpHosts) {
      try {
        const jumpClient = await createJumpHostChain(
          hostConfig.jumpHosts!,
          hostConfig.userId!,
          proxyConfig,
        );

        if (!jumpClient) {
          sshLogger.error("Failed to establish jump host chain");
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Failed to connect through jump hosts",
            }),
          );
          if (currentSessionId) {
            sessionManager.destroySession(currentSessionId);
            currentSessionId = null;
          }
          cleanupAuthState(connectionTimeout);
          return;
        }
        lastJumpClient = jumpClient;

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
            if (currentSessionId) {
              sessionManager.destroySession(currentSessionId);
              currentSessionId = null;
            }
            cleanupAuthState(connectionTimeout);
            return;
          }

          connectConfig.sock = stream;
          sendLog(
            "handshake",
            "info",
            "Starting SSH session through jump host" +
              (proxyConfig ? " (via proxy)" : ""),
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
            viaProxy: !!proxyConfig,
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
        if (currentSessionId) {
          sessionManager.destroySession(currentSessionId);
          currentSessionId = null;
        }
        cleanupAuthState(connectionTimeout);
        return;
      }
    } else if (proxyConfig) {
      try {
        const proxySocket = await createSocks5Connection(ip, port, proxyConfig);
        if (proxySocket) {
          connectConfig.sock = proxySocket;
        }
      } catch (proxyError) {
        sshLogger.error("Proxy connection failed", proxyError, {
          operation: "proxy_connect",
          hostId: id,
          proxyHost: hostConfig.socks5Host,
          proxyPort: hostConfig.socks5Port || 1080,
        });
        ws.send(
          JSON.stringify({
            type: "error",
            message:
              "Proxy connection failed: " +
              (proxyError instanceof Error
                ? proxyError.message
                : "Unknown error"),
          }),
        );
        if (currentSessionId) {
          sessionManager.destroySession(currentSessionId);
          currentSessionId = null;
        }
        cleanupAuthState(connectionTimeout);
        return;
      }
      sendLog("handshake", "info", "Starting SSH session (via proxy)");
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
        viaProxy: true,
      });
      sshConn.connect(connectConfig);
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
    const resizeStream =
      sessionManager.getSession(currentSessionId)?.sshStream ?? sshStream;
    if (resizeStream && resizeStream.setWindow) {
      resizeStream.setWindow(data.rows, data.cols, data.rows, data.cols);
      const session = sessionManager.getSession(currentSessionId);
      if (session) {
        session.cols = data.cols;
        session.rows = data.rows;
        sessionManager.bufferResize(session.id, data.cols, data.rows);
      }
      ws.send(
        JSON.stringify({ type: "resized", cols: data.cols, rows: data.rows }),
      );
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

    if (warpgateAuthTimeout) {
      clearTimeout(warpgateAuthTimeout);
      warpgateAuthTimeout = null;
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
});
