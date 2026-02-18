import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";
import { useXTerm } from "react-xtermjs";
import { FitAddon } from "@xterm/addon-fit";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { RobustClipboardProvider } from "@/lib/clipboard-provider";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTranslation } from "react-i18next";
import { isElectron, getCookie, getSnippets } from "@/ui/main-axios.ts";
import { getBasePath } from "@/lib/base-path";
import { useTheme } from "@/components/theme-provider";
import {
  TERMINAL_THEMES,
  DEFAULT_TERMINAL_CONFIG,
  TERMINAL_FONTS,
} from "@/constants/terminal-themes.ts";
import type { TerminalConfig } from "@/types";
import { TOTPDialog } from "@/ui/desktop/navigation/dialogs/TOTPDialog.tsx";
import { SSHAuthDialog } from "@/ui/desktop/navigation/dialogs/SSHAuthDialog.tsx";
import { WarpgateDialog } from "@/ui/desktop/navigation/dialogs/WarpgateDialog.tsx";
import {
  ConnectionLogProvider,
  useConnectionLog,
} from "@/ui/desktop/navigation/connection-log/ConnectionLogContext.tsx";
import { ConnectionLog } from "@/ui/desktop/navigation/connection-log/ConnectionLog.tsx";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";

interface HostConfig {
  id?: number;
  ip: string;
  port: number;
  username: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  authType?: string;
  credentialId?: number;
  terminalConfig?: TerminalConfig;
  name?: string;
  [key: string]: unknown;
}

interface TerminalHandle {
  disconnect: () => void;
  fit: () => void;
  sendInput: (data: string) => void;
  notifyResize: () => void;
  refresh: () => void;
}

interface SSHTerminalProps {
  hostConfig: HostConfig;
  isVisible: boolean;
  title?: string;
}

const TerminalInner = forwardRef<TerminalHandle, SSHTerminalProps>(
  function SSHTerminal({ hostConfig, isVisible }, ref) {
    const { t } = useTranslation();
    const { instance: terminal, ref: xtermRef } = useXTerm();
    const { theme: appTheme } = useTheme();
    const { addLog, isExpanded: isConnectionLogExpanded } = useConnectionLog();

    const config = { ...DEFAULT_TERMINAL_CONFIG, ...hostConfig.terminalConfig };

    const isDarkMode =
      appTheme === "dark" ||
      (appTheme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    let themeColors;
    if (config.theme === "termix") {
      themeColors = isDarkMode
        ? TERMINAL_THEMES.termixDark.colors
        : TERMINAL_THEMES.termixLight.colors;
    } else {
      themeColors =
        TERMINAL_THEMES[config.theme]?.colors ||
        TERMINAL_THEMES.termixDark.colors;
    }
    const backgroundColor = themeColors.background;

    const fitAddonRef = useRef<FitAddon | null>(null);
    const webSocketRef = useRef<WebSocket | null>(null);
    const resizeTimeout = useRef<NodeJS.Timeout | null>(null);
    const wasDisconnectedBySSH = useRef(false);
    const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const [visible, setVisible] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const connectionErrorRef = useRef<string | null>(null);

    const updateConnectionError = useCallback((error: string | null) => {
      connectionErrorRef.current = error;
      setConnectionError(error);
    }, []);

    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [totpRequired, setTotpRequired] = useState(false);
    const [totpPrompt, setTotpPrompt] = useState<string>("");
    const [isPasswordPrompt, setIsPasswordPrompt] = useState(false);
    const [showAuthDialog, setShowAuthDialog] = useState(false);
    const [authDialogReason, setAuthDialogReason] = useState<
      "no_keyboard" | "auth_failed" | "timeout"
    >("no_keyboard");
    const [warpgateAuthRequired, setWarpgateAuthRequired] = useState(false);
    const [warpgateAuthUrl, setWarpgateAuthUrl] = useState<string>("");
    const [warpgateSecurityKey, setWarpgateSecurityKey] = useState<string>("");

    const isVisibleRef = useRef<boolean>(false);
    const isFittingRef = useRef(false);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttempts = useRef(0);
    const maxReconnectAttempts = 3;
    const isUnmountingRef = useRef(false);
    const shouldNotReconnectRef = useRef(false);
    const isReconnectingRef = useRef(false);
    const isConnectingRef = useRef(false);
    const connectionAttemptIdRef = useRef(0);
    const totpTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const warpgateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const pendingSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const notifyTimerRef = useRef<NodeJS.Timeout | null>(null);
    const DEBOUNCE_MS = 140;

    useEffect(() => {
      isUnmountingRef.current = false;
      shouldNotReconnectRef.current = false;
      isReconnectingRef.current = false;
      isConnectingRef.current = false;
      reconnectAttempts.current = 0;

      return () => {};
    }, [hostConfig.id]);

    useEffect(() => {
      isVisibleRef.current = isVisible;
    }, [isVisible]);

    useEffect(() => {
      const checkAuth = () => {
        const jwtToken = getCookie("jwt");
        const isAuth = !!(jwtToken && jwtToken.trim() !== "");

        setIsAuthenticated((prev) => {
          if (prev !== isAuth) {
            return isAuth;
          }
          return prev;
        });
      };

      checkAuth();

      const authCheckInterval = setInterval(checkAuth, 5000);

      return () => clearInterval(authCheckInterval);
    }, []);

    function hardRefresh() {
      try {
        if (
          terminal &&
          typeof (
            terminal as { refresh?: (start: number, end: number) => void }
          ).refresh === "function"
        ) {
          (
            terminal as { refresh?: (start: number, end: number) => void }
          ).refresh(0, terminal.rows - 1);
        }
      } catch (error) {
        console.error("Terminal operation failed:", error);
      }
    }

    function performFit() {
      if (
        !fitAddonRef.current ||
        !terminal ||
        !isVisibleRef.current ||
        isFittingRef.current
      ) {
        return;
      }

      isFittingRef.current = true;

      requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit();
          if (terminal && terminal.cols > 0 && terminal.rows > 0) {
            scheduleNotify(terminal.cols, terminal.rows);
          }
          hardRefresh();
        } finally {
          isFittingRef.current = false;
        }
      });
    }

    function scheduleNotify(cols: number, rows: number) {
      if (!(cols > 0 && rows > 0)) return;
      pendingSizeRef.current = { cols, rows };
      if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
      notifyTimerRef.current = setTimeout(() => {
        const next = pendingSizeRef.current;
        const last = lastSentSizeRef.current;
        if (!next) return;
        if (last && last.cols === next.cols && last.rows === next.rows) return;
        if (webSocketRef.current?.readyState === WebSocket.OPEN) {
          webSocketRef.current.send(
            JSON.stringify({ type: "resize", data: next }),
          );
          lastSentSizeRef.current = next;
        }
      }, DEBOUNCE_MS);
    }

    function handleTotpSubmit(code: string) {
      if (webSocketRef.current && code) {
        if (totpTimeoutRef.current) {
          clearTimeout(totpTimeoutRef.current);
          totpTimeoutRef.current = null;
        }
        webSocketRef.current.send(
          JSON.stringify({
            type: isPasswordPrompt ? "password_response" : "totp_response",
            data: { code },
          }),
        );
        setTotpRequired(false);
        setTotpPrompt("");
        setIsPasswordPrompt(false);
      }
    }

    function handleTotpCancel() {
      if (totpTimeoutRef.current) {
        clearTimeout(totpTimeoutRef.current);
        totpTimeoutRef.current = null;
      }
      setTotpRequired(false);
      setTotpPrompt("");
      webSocketRef.current?.close();
    }

    function handleWarpgateContinue() {
      if (webSocketRef.current) {
        if (warpgateTimeoutRef.current) {
          clearTimeout(warpgateTimeoutRef.current);
          warpgateTimeoutRef.current = null;
        }
        webSocketRef.current.send(
          JSON.stringify({
            type: "warpgate_auth_continue",
            data: {},
          }),
        );
        setWarpgateAuthRequired(false);
        setWarpgateAuthUrl("");
        setWarpgateSecurityKey("");
      }
    }

    function handleWarpgateCancel() {
      if (warpgateTimeoutRef.current) {
        clearTimeout(warpgateTimeoutRef.current);
        warpgateTimeoutRef.current = null;
      }
      setWarpgateAuthRequired(false);
      setWarpgateAuthUrl("");
      setWarpgateSecurityKey("");
      webSocketRef.current?.close();
    }

    function handleWarpgateOpenUrl() {
      if (warpgateAuthUrl) {
        window.open(warpgateAuthUrl, "_blank", "noopener,noreferrer");
      }
    }

    function handleAuthDialogSubmit(credentials: {
      password?: string;
      sshKey?: string;
      keyPassword?: string;
    }) {
      if (webSocketRef.current && terminal) {
        webSocketRef.current.send(
          JSON.stringify({
            type: "reconnect_with_credentials",
            data: {
              cols: terminal.cols,
              rows: terminal.rows,
              password: credentials.password,
              sshKey: credentials.sshKey,
              keyPassword: credentials.keyPassword,
              hostConfig: {
                ...hostConfig,
                password: credentials.password,
                key: credentials.sshKey,
                keyPassword: credentials.keyPassword,
              },
            },
          }),
        );
        setShowAuthDialog(false);
        setIsConnecting(true);
      }
    }

    function handleAuthDialogCancel() {
      setShowAuthDialog(false);
      webSocketRef.current?.close();
    }

    useImperativeHandle(
      ref,
      () => ({
        disconnect: () => {
          isUnmountingRef.current = true;
          shouldNotReconnectRef.current = true;
          isReconnectingRef.current = false;
          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
          }
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
          }
          if (totpTimeoutRef.current) {
            clearTimeout(totpTimeoutRef.current);
            totpTimeoutRef.current = null;
          }
          if (warpgateTimeoutRef.current) {
            clearTimeout(warpgateTimeoutRef.current);
            warpgateTimeoutRef.current = null;
          }
          webSocketRef.current?.close();
        },
        fit: () => {
          fitAddonRef.current?.fit();
          if (terminal) scheduleNotify(terminal.cols, terminal.rows);
          hardRefresh();
        },
        sendInput: (data: string) => {
          if (webSocketRef.current?.readyState === 1) {
            webSocketRef.current.send(JSON.stringify({ type: "input", data }));
          }
        },
        notifyResize: () => {
          try {
            const cols = terminal?.cols ?? undefined;
            const rows = terminal?.rows ?? undefined;
            if (typeof cols === "number" && typeof rows === "number") {
              scheduleNotify(cols, rows);
              hardRefresh();
            }
          } catch (error) {
            console.error("Terminal operation failed:", error);
          }
        },
        refresh: () => hardRefresh(),
      }),
      [terminal],
    );

    function attemptReconnection() {
      if (
        isUnmountingRef.current ||
        shouldNotReconnectRef.current ||
        isReconnectingRef.current ||
        isConnectingRef.current ||
        wasDisconnectedBySSH.current ||
        reconnectTimeoutRef.current !== null
      ) {
        return;
      }

      if (reconnectAttempts.current >= maxReconnectAttempts) {
        updateConnectionError(t("terminal.maxReconnectAttemptsReached"));
        setIsConnecting(false);
        shouldNotReconnectRef.current = true;
        addLog({
          type: "error",
          stage: "connection",
          message: t("terminal.maxReconnectAttemptsReached"),
        });
        return;
      }

      isReconnectingRef.current = true;

      if (terminal) {
        terminal.clear();
      }

      reconnectAttempts.current++;

      addLog({
        type: "info",
        stage: "connection",
        message: t("terminal.reconnecting", {
          attempt: reconnectAttempts.current,
          max: maxReconnectAttempts,
        }),
      });

      const delay = Math.min(
        2000 * Math.pow(2, reconnectAttempts.current - 1),
        8000,
      );

      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;

        if (
          isUnmountingRef.current ||
          shouldNotReconnectRef.current ||
          wasDisconnectedBySSH.current
        ) {
          isReconnectingRef.current = false;
          return;
        }

        if (reconnectAttempts.current > maxReconnectAttempts) {
          isReconnectingRef.current = false;
          return;
        }

        const jwtToken = getCookie("jwt");
        if (!jwtToken || jwtToken.trim() === "") {
          console.warn("Reconnection cancelled - no authentication token");
          isReconnectingRef.current = false;
          updateConnectionError(t("terminal.authenticationRequired"));
          setIsConnecting(false);
          shouldNotReconnectRef.current = true;
          addLog({
            type: "error",
            stage: "auth",
            message: t("terminal.authenticationRequired"),
          });
          return;
        }

        if (terminal && hostConfig) {
          terminal.clear();
          const cols = terminal.cols;
          const rows = terminal.rows;
          connectToHost(cols, rows);
        }

        isReconnectingRef.current = false;
      }, delay);
    }

    function connectToHost(cols: number, rows: number) {
      if (isConnectingRef.current) {
        return;
      }

      isConnectingRef.current = true;
      connectionAttemptIdRef.current++;

      if (!isReconnectingRef.current) {
        reconnectAttempts.current = 0;
        shouldNotReconnectRef.current = false;
      }

      const isDev =
        process.env.NODE_ENV === "development" &&
        (window.location.port === "3000" ||
          window.location.port === "5173" ||
          window.location.port === "");

      const jwtToken = getCookie("jwt");

      if (!jwtToken || jwtToken.trim() === "") {
        console.error("No JWT token available for WebSocket connection");
        setIsConnected(false);
        setIsConnecting(false);
        updateConnectionError("Authentication required");
        isConnectingRef.current = false;
        return;
      }

      const baseWsUrl = isDev
        ? `${window.location.protocol === "https:" ? "wss" : "ws"}://localhost:30002`
        : isElectron()
          ? (() => {
              const baseUrl =
                (window as { configuredServerUrl?: string })
                  .configuredServerUrl || "http://127.0.0.1:30001";
              const wsProtocol = baseUrl.startsWith("https://")
                ? "wss://"
                : "ws://";
              const wsHost = baseUrl.replace(/^https?:\/\//, "");
              return `${wsProtocol}${wsHost}/ssh/websocket/`;
            })()
          : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}${getBasePath()}/ssh/websocket/`;

      if (
        webSocketRef.current &&
        webSocketRef.current.readyState !== WebSocket.CLOSED
      ) {
        webSocketRef.current.close();
      }

      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }

      const wsUrl = `${baseWsUrl}?token=${encodeURIComponent(jwtToken)}`;

      const ws = new WebSocket(wsUrl);
      webSocketRef.current = ws;
      wasDisconnectedBySSH.current = false;
      updateConnectionError(null);
      shouldNotReconnectRef.current = false;
      isReconnectingRef.current = false;
      setIsConnecting(true);

      setupWebSocketListeners(ws, cols, rows);
    }

    function setupWebSocketListeners(
      ws: WebSocket,
      cols: number,
      rows: number,
    ) {
      ws.addEventListener("open", () => {
        connectionTimeoutRef.current = setTimeout(() => {
          if (
            !isConnected &&
            !totpRequired &&
            !isPasswordPrompt &&
            !connectionErrorRef.current
          ) {
            if (terminal) {
              terminal.clear();
            }
            const timeoutMessage = t("terminal.connectionTimeout");
            updateConnectionError(timeoutMessage);
            addLog({
              type: "error",
              stage: "connection",
              message: timeoutMessage,
            });
            if (webSocketRef.current) {
              webSocketRef.current.close();
            }
            if (reconnectAttempts.current > 0) {
              attemptReconnection();
            } else {
              setIsConnecting(false);
              shouldNotReconnectRef.current = true;
            }
          }
        }, 35000);

        ws.send(
          JSON.stringify({
            type: "connectToHost",
            data: { cols, rows, hostConfig },
          }),
        );
        terminal.onData((data) => {
          ws.send(JSON.stringify({ type: "input", data }));
        });

        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 30000);
      });

      ws.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "data") {
            if (typeof msg.data === "string") {
              terminal.write(msg.data);
            } else {
              terminal.write(String(msg.data));
            }
          } else if (msg.type === "error") {
            const errorMessage = msg.message || t("terminal.unknownError");

            addLog({
              type: "error",
              stage: "connection",
              message: errorMessage,
            });

            if (
              errorMessage.toLowerCase().includes("connection") ||
              errorMessage.toLowerCase().includes("timeout") ||
              errorMessage.toLowerCase().includes("network")
            ) {
              updateConnectionError(errorMessage);
              setIsConnected(false);
              if (terminal) {
                terminal.clear();
              }
              setIsConnecting(false);
              wasDisconnectedBySSH.current = false;
              return;
            }

            if (
              (errorMessage.toLowerCase().includes("auth") &&
                errorMessage.toLowerCase().includes("failed")) ||
              errorMessage.toLowerCase().includes("permission denied") ||
              (errorMessage.toLowerCase().includes("invalid") &&
                (errorMessage.toLowerCase().includes("password") ||
                  errorMessage.toLowerCase().includes("key"))) ||
              errorMessage.toLowerCase().includes("incorrect password")
            ) {
              updateConnectionError(errorMessage);
              setIsConnecting(false);
              shouldNotReconnectRef.current = true;
              if (webSocketRef.current) {
                webSocketRef.current.close();
              }
              return;
            }

            updateConnectionError(errorMessage);
            setIsConnecting(false);
          } else if (msg.type === "connected") {
            setIsConnected(true);
            setIsConnecting(false);
            isConnectingRef.current = false;
            updateConnectionError(null);
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            if (reconnectAttempts.current > 0) {
              addLog({
                type: "success",
                stage: "connection",
                message: t("terminal.reconnected"),
              });
            } else {
              addLog({
                type: "success",
                stage: "connection",
                message: t("terminal.connected"),
              });
            }
            reconnectAttempts.current = 0;
            isReconnectingRef.current = false;

            setTimeout(async () => {
              const terminalConfig = {
                ...DEFAULT_TERMINAL_CONFIG,
                ...hostConfig.terminalConfig,
              };

              if (
                terminalConfig.environmentVariables &&
                terminalConfig.environmentVariables.length > 0
              ) {
                for (const envVar of terminalConfig.environmentVariables) {
                  if (envVar.key && envVar.value && ws.readyState === 1) {
                    ws.send(
                      JSON.stringify({
                        type: "input",
                        data: `export ${envVar.key}="${envVar.value}"\n`,
                      }),
                    );
                  }
                }
              }

              if (terminalConfig.startupSnippetId) {
                try {
                  const snippets = await getSnippets();
                  const snippet = snippets.find(
                    (s: { id: number }) =>
                      s.id === terminalConfig.startupSnippetId,
                  );
                  if (snippet && ws.readyState === 1) {
                    ws.send(
                      JSON.stringify({
                        type: "input",
                        data: snippet.content + "\n",
                      }),
                    );
                  }
                } catch (err) {
                  console.warn("Failed to execute startup snippet:", err);
                }
              }

              if (terminalConfig.autoMosh && ws.readyState === 1) {
                ws.send(
                  JSON.stringify({
                    type: "input",
                    data: terminalConfig.moshCommand + "\n",
                  }),
                );
              }
            }, 100);
          } else if (msg.type === "disconnected") {
            wasDisconnectedBySSH.current = true;
            isConnectingRef.current = false;
            setIsConnected(false);
            if (terminal) {
              terminal.clear();
            }
            setIsConnecting(false);
          } else if (msg.type === "totp_required") {
            setTotpRequired(true);
            setTotpPrompt(msg.prompt || t("terminal.totpCodeLabel"));
            setIsPasswordPrompt(false);
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            if (totpTimeoutRef.current) {
              clearTimeout(totpTimeoutRef.current);
            }
            totpTimeoutRef.current = setTimeout(() => {
              setTotpRequired(false);
              if (webSocketRef.current) {
                webSocketRef.current.close();
              }
            }, 180000);
          } else if (msg.type === "password_required") {
            setTotpRequired(true);
            setTotpPrompt(msg.prompt || t("common.password"));
            setIsPasswordPrompt(true);
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            if (totpTimeoutRef.current) {
              clearTimeout(totpTimeoutRef.current);
            }
            totpTimeoutRef.current = setTimeout(() => {
              setTotpRequired(false);
              if (webSocketRef.current) {
                webSocketRef.current.close();
              }
            }, 180000);
          } else if (msg.type === "warpgate_auth_required") {
            setWarpgateAuthRequired(true);
            setWarpgateAuthUrl(msg.url || "");
            setWarpgateSecurityKey(msg.securityKey || "N/A");
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            if (warpgateTimeoutRef.current) {
              clearTimeout(warpgateTimeoutRef.current);
            }
            warpgateTimeoutRef.current = setTimeout(() => {
              setWarpgateAuthRequired(false);
              if (webSocketRef.current) {
                webSocketRef.current.close();
              }
            }, 300000);
          } else if (msg.type === "keyboard_interactive_available") {
            setIsConnecting(false);
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
          } else if (msg.type === "auth_method_not_available") {
            setAuthDialogReason("no_keyboard");
            setShowAuthDialog(true);
            setIsConnecting(false);
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
          } else if (msg.type === "connection_log") {
            if (msg.data) {
              addLog({
                type: msg.data.level || "info",
                stage: msg.data.stage || "auth",
                message: msg.data.message,
                details: msg.data.details,
              });
            }
          }
        } catch (error) {
          console.error("Terminal operation failed:", error);
        }
      });

      const currentAttemptId = connectionAttemptIdRef.current;

      ws.addEventListener("close", (event) => {
        if (currentAttemptId !== connectionAttemptIdRef.current) {
          return;
        }

        setIsConnected(false);
        isConnectingRef.current = false;
        if (terminal) {
          terminal.clear();
        }

        if (totpTimeoutRef.current) {
          clearTimeout(totpTimeoutRef.current);
          totpTimeoutRef.current = null;
        }

        if (event.code === 1006) {
          console.error(
            "[WebSocket] Abnormal closure detected - possible HTTPS/proxy issue",
          );
          addLog({
            type: "error",
            stage: "connection",
            message: t("terminal.websocketAbnormalClose"),
          });
          updateConnectionError(t("terminal.websocketAbnormalClose"));
          setIsConnecting(false);
          shouldNotReconnectRef.current = true;
          return;
        }

        if (event.code === 1008) {
          console.error("WebSocket authentication failed:", event.reason);
          addLog({
            type: "error",
            stage: "auth",
            message: "Authentication failed - please re-login",
          });
          updateConnectionError("Authentication failed - please re-login");
          setIsConnecting(false);
          shouldNotReconnectRef.current = true;

          localStorage.removeItem("jwt");

          setTimeout(() => {
            window.location.reload();
          }, 1000);

          return;
        }

        if (
          !isConnected &&
          event.wasClean &&
          (event.code === 1005 || event.code === 1000)
        ) {
          console.error("[WebSocket] Connection rejected by server");
          addLog({
            type: "error",
            stage: "connection",
            message: t("terminal.connectionRejected"),
          });
          updateConnectionError(t("terminal.connectionRejected"));
          setIsConnecting(false);
          shouldNotReconnectRef.current = true;
          return;
        }

        const shouldAttemptReconnection =
          !wasDisconnectedBySSH.current &&
          !isUnmountingRef.current &&
          !shouldNotReconnectRef.current &&
          !isConnectingRef.current;

        if (shouldAttemptReconnection) {
          wasDisconnectedBySSH.current = false;
          attemptReconnection();
        } else {
          setIsConnecting(false);
        }
      });

      ws.addEventListener("error", (event) => {
        if (currentAttemptId !== connectionAttemptIdRef.current) {
          return;
        }

        console.error("[WebSocket] Error:", event);

        setIsConnected(false);
        isConnectingRef.current = false;
        updateConnectionError(t("terminal.websocketError"));
        if (terminal) {
          terminal.clear();
        }
        setIsConnecting(false);

        if (totpTimeoutRef.current) {
          clearTimeout(totpTimeoutRef.current);
          totpTimeoutRef.current = null;
        }
      });
    }

    useEffect(() => {
      if (!terminal || !xtermRef.current || !hostConfig) return;

      if (!isAuthenticated) {
        return;
      }

      const fontConfig = TERMINAL_FONTS.find(
        (f) => f.value === config.fontFamily,
      );
      const fontFamily = fontConfig?.fallback || TERMINAL_FONTS[0].fallback;

      terminal.options = {
        cursorBlink: config.cursorBlink,
        cursorStyle: config.cursorStyle,
        scrollback: config.scrollback,
        fontSize: config.fontSize,
        fontFamily,
        allowTransparency: true,
        convertEol: false,
        windowsMode: false,
        macOptionIsMeta: false,
        macOptionClickForcesSelection: false,
        rightClickSelectsWord: config.rightClickSelectsWord,
        fastScrollModifier: config.fastScrollModifier,
        fastScrollSensitivity: config.fastScrollSensitivity,
        allowProposedApi: true,
        minimumContrastRatio: config.minimumContrastRatio,
        letterSpacing: config.letterSpacing,
        lineHeight: config.lineHeight,
        bellStyle: config.bellStyle as "none" | "sound" | "visual" | "both",
        theme: {
          background: themeColors.background,
          foreground: themeColors.foreground,
          cursor: themeColors.cursor,
          cursorAccent: themeColors.cursorAccent,
          selectionBackground: themeColors.selectionBackground,
          selectionForeground: themeColors.selectionForeground,
          black: themeColors.black,
          red: themeColors.red,
          green: themeColors.green,
          yellow: themeColors.yellow,
          blue: themeColors.blue,
          magenta: themeColors.magenta,
          cyan: themeColors.cyan,
          white: themeColors.white,
          brightBlack: themeColors.brightBlack,
          brightRed: themeColors.brightRed,
          brightGreen: themeColors.brightGreen,
          brightYellow: themeColors.brightYellow,
          brightBlue: themeColors.brightBlue,
          brightMagenta: themeColors.brightMagenta,
          brightCyan: themeColors.brightCyan,
          brightWhite: themeColors.brightWhite,
        },
      };

      const fitAddon = new FitAddon();
      const clipboardProvider = new RobustClipboardProvider();
      const clipboardAddon = new ClipboardAddon(undefined, clipboardProvider);
      const unicode11Addon = new Unicode11Addon();
      const webLinksAddon = new WebLinksAddon();

      fitAddonRef.current = fitAddon;
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(clipboardAddon);
      terminal.loadAddon(unicode11Addon);
      terminal.loadAddon(webLinksAddon);

      terminal.unicode.activeVersion = "11";

      terminal.open(xtermRef.current);

      const resizeObserver = new ResizeObserver(() => {
        if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
        resizeTimeout.current = setTimeout(() => {
          if (!isVisibleRef.current || !isReady) return;
          performFit();
        }, 150);
      });

      resizeObserver.observe(xtermRef.current);

      const readyFonts =
        (document as { fonts?: { ready?: Promise<unknown> } }).fonts
          ?.ready instanceof Promise
          ? (document as { fonts?: { ready?: Promise<unknown> } }).fonts.ready
          : Promise.resolve();

      readyFonts.then(() => {
        requestAnimationFrame(() => {
          fitAddon.fit();
          if (terminal && terminal.cols > 0 && terminal.rows > 0) {
            scheduleNotify(terminal.cols, terminal.rows);
          }
          hardRefresh();

          const jwtToken = getCookie("jwt");
          if (!jwtToken || jwtToken.trim() === "") {
            setIsConnected(false);
            setIsConnecting(false);
            updateConnectionError("Authentication required");
            setVisible(true);
            setIsReady(true);
            return;
          }

          const cols = terminal.cols;
          const rows = terminal.rows;

          if (isConnectingRef.current) {
            setVisible(true);
            setIsReady(true);
            return;
          }

          if (terminal.cols > 0 && terminal.rows > 0) {
            connectToHost(cols, rows);
          }

          setVisible(true);
          setIsReady(true);
        });
      });

      return () => {
        resizeObserver.disconnect();
        clipboardProvider.dispose();
        if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
        if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        webSocketRef.current?.close();
        setVisible(false);
        setIsReady(false);
        isFittingRef.current = false;
      };
    }, [xtermRef, terminal, hostConfig, isAuthenticated, isDarkMode]);

    useEffect(() => {
      return () => {
        isUnmountingRef.current = true;
        shouldNotReconnectRef.current = true;
        isReconnectingRef.current = false;
        setIsConnecting(false);
        if (reconnectTimeoutRef.current)
          clearTimeout(reconnectTimeoutRef.current);
        if (connectionTimeoutRef.current)
          clearTimeout(connectionTimeoutRef.current);
        if (totpTimeoutRef.current) clearTimeout(totpTimeoutRef.current);
        if (warpgateTimeoutRef.current)
          clearTimeout(warpgateTimeoutRef.current);
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        webSocketRef.current?.close();
      };
    }, []);

    useEffect(() => {
      if (!isVisible || !isReady || !fitAddonRef.current || !terminal) {
        return;
      }

      const fitTimeout = setTimeout(() => {
        performFit();
      }, 100);

      return () => clearTimeout(fitTimeout);
    }, [isVisible, isReady, terminal]);

    const hasConnectionError = !!connectionError;

    return (
      <div className="h-full w-full relative" style={{ backgroundColor }}>
        <div
          ref={xtermRef}
          className="h-full w-full m-1 overflow-hidden"
          style={{
            visibility:
              isConnected && isReady && !connectionError ? "visible" : "hidden",
          }}
        />

        <SimpleLoader
          visible={isConnecting && !isConnectionLogExpanded}
          message={t("terminal.connecting")}
          backgroundColor={backgroundColor}
        />

        <ConnectionLog
          isConnecting={isConnecting}
          isConnected={isConnected}
          hasConnectionError={hasConnectionError}
          position={hasConnectionError ? "top" : "bottom"}
        />

        <TOTPDialog
          isOpen={totpRequired}
          prompt={totpPrompt}
          onSubmit={handleTotpSubmit}
          onCancel={handleTotpCancel}
          backgroundColor={backgroundColor}
        />

        <SSHAuthDialog
          isOpen={showAuthDialog}
          reason={authDialogReason}
          onSubmit={handleAuthDialogSubmit}
          onCancel={handleAuthDialogCancel}
          hostInfo={{
            ip: hostConfig.ip,
            port: hostConfig.port,
            username: hostConfig.username,
            name: hostConfig.name,
          }}
          backgroundColor={backgroundColor}
        />

        <WarpgateDialog
          isOpen={warpgateAuthRequired}
          url={warpgateAuthUrl}
          securityKey={warpgateSecurityKey}
          onContinue={handleWarpgateContinue}
          onCancel={handleWarpgateCancel}
          onOpenUrl={handleWarpgateOpenUrl}
          backgroundColor={backgroundColor}
        />
      </div>
    );
  },
);

export const Terminal = forwardRef<TerminalHandle, SSHTerminalProps>(
  function Terminal(props, ref) {
    return (
      <ConnectionLogProvider>
        <TerminalInner {...props} ref={ref} />
      </ConnectionLogProvider>
    );
  },
);

const style = document.createElement("style");
style.innerHTML = `
@font-face {
  font-family: 'Caskaydia Cove Nerd Font Mono';
  src: url('./fonts/CaskaydiaCoveNerdFontMono-Regular.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Caskaydia Cove Nerd Font Mono';
  src: url('./fonts/CaskaydiaCoveNerdFontMono-Bold.ttf') format('truetype');
  font-weight: bold;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Caskaydia Cove Nerd Font Mono';
  src: url('./fonts/CaskaydiaCoveNerdFontMono-Italic.ttf') format('truetype');
  font-weight: normal;
  font-style: italic;
  font-display: swap;
}

@font-face {
  font-family: 'Caskaydia Cove Nerd Font Mono';
  src: url('./fonts/CaskaydiaCoveNerdFontMono-BoldItalic.ttf') format('truetype');
  font-weight: bold;
  font-style: italic;
  font-display: swap;
}

.xterm .xterm-viewport::-webkit-scrollbar {
  width: 8px;
  background: transparent;
}
.xterm .xterm-viewport::-webkit-scrollbar-thumb {
  background: rgba(0,0,0,0.3);
  border-radius: 4px;
}
.xterm .xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: rgba(0,0,0,0.5);
}
.xterm .xterm-viewport {
  scrollbar-width: thin;
  scrollbar-color: rgba(0,0,0,0.3) transparent;
}

.dark .xterm .xterm-viewport::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.3);
}
.dark .xterm .xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,0.5);
}
.dark .xterm .xterm-viewport {
  scrollbar-color: rgba(255,255,255,0.3) transparent;
}

.xterm {
  font-feature-settings: "liga" 1, "calt" 1;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.xterm .xterm-screen {
  font-family: 'Caskaydia Cove Nerd Font Mono', 'SF Mono', Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace !important;
  font-variant-ligatures: contextual;
}

.xterm .xterm-screen .xterm-char {
  font-feature-settings: "liga" 1, "calt" 1;
}
`;
document.head.appendChild(style);
