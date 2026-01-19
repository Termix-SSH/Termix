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
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getCookie,
  isElectron,
  logActivity,
  getSnippets,
  deleteCommandFromHistory,
  getCommandHistory,
} from "@/ui/main-axios.ts";
import { TOTPDialog } from "@/ui/desktop/navigation/TOTPDialog.tsx";
import { SSHAuthDialog } from "@/ui/desktop/navigation/SSHAuthDialog.tsx";
import {
  TERMINAL_THEMES,
  DEFAULT_TERMINAL_CONFIG,
  TERMINAL_FONTS,
} from "@/constants/terminal-themes.ts";
import type { TerminalConfig } from "@/types";
import { useTheme } from "@/components/theme-provider.tsx";
import { useCommandTracker } from "@/ui/hooks/useCommandTracker.ts";
import { highlightTerminalOutput } from "@/lib/terminal-syntax-highlighter.ts";
import { useCommandHistory as useCommandHistoryHook } from "@/ui/hooks/useCommandHistory.ts";
import { useCommandHistory } from "@/ui/desktop/apps/features/terminal/command-history/CommandHistoryContext.tsx";
import { CommandAutocomplete } from "./command-history/CommandAutocomplete.tsx";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";
import { useConfirmation } from "@/hooks/use-confirmation.ts";

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
  showTitle?: boolean;
  splitScreen?: boolean;
  onClose?: () => void;
  initialPath?: string;
  executeCommand?: string;
}

export const Terminal = forwardRef<TerminalHandle, SSHTerminalProps>(
  function SSHTerminal(
    {
      hostConfig,
      isVisible,
      splitScreen = false,
      onClose,
      initialPath,
      executeCommand,
    },
    ref,
  ) {
    if (
      typeof window !== "undefined" &&
      !(window as { testJWT?: () => string | null }).testJWT
    ) {
      (window as { testJWT?: () => string | null }).testJWT = () => {
        const jwt = getCookie("jwt");
        return jwt;
      };
    }

    const { t } = useTranslation();
    const { instance: terminal, ref: xtermRef } = useXTerm();
    const commandHistoryContext = useCommandHistory();
    const { confirmWithToast } = useConfirmation();
    const { theme: appTheme } = useTheme();

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
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isFitted, setIsFitted] = useState(false);
    const [, setConnectionError] = useState<string | null>(null);
    const [, setIsAuthenticated] = useState(false);
    const [totpRequired, setTotpRequired] = useState(false);
    const [totpPrompt, setTotpPrompt] = useState<string>("");
    const [isPasswordPrompt, setIsPasswordPrompt] = useState(false);
    const [showAuthDialog, setShowAuthDialog] = useState(false);
    const [authDialogReason, setAuthDialogReason] = useState<
      "no_keyboard" | "auth_failed" | "timeout"
    >("no_keyboard");
    const [keyboardInteractiveDetected, setKeyboardInteractiveDetected] =
      useState(false);
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
    const totpAttemptsRef = useRef(0);
    const totpTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const activityLoggedRef = useRef(false);
    const keyHandlerAttachedRef = useRef(false);

    const { trackInput, getCurrentCommand, updateCurrentCommand } =
      useCommandTracker({
        hostId: hostConfig.id,
        enabled: true,
        onCommandExecuted: (command) => {
          if (!autocompleteHistory.current.includes(command)) {
            autocompleteHistory.current = [
              command,
              ...autocompleteHistory.current,
            ];
          }
        },
      });

    const getCurrentCommandRef = useRef(getCurrentCommand);
    const updateCurrentCommandRef = useRef(updateCurrentCommand);

    useEffect(() => {
      getCurrentCommandRef.current = getCurrentCommand;
      updateCurrentCommandRef.current = updateCurrentCommand;
    }, [getCurrentCommand, updateCurrentCommand]);

    const [showAutocomplete, setShowAutocomplete] = useState(false);
    const [autocompleteSuggestions, setAutocompleteSuggestions] = useState<
      string[]
    >([]);
    const [autocompleteSelectedIndex, setAutocompleteSelectedIndex] =
      useState(0);
    const [autocompletePosition, setAutocompletePosition] = useState({
      top: 0,
      left: 0,
    });
    const autocompleteHistory = useRef<string[]>([]);
    const currentAutocompleteCommand = useRef<string>("");

    const showAutocompleteRef = useRef(false);
    const autocompleteSuggestionsRef = useRef<string[]>([]);
    const autocompleteSelectedIndexRef = useRef(0);

    const [showHistoryDialog, setShowHistoryDialog] = useState(false);
    const [commandHistory, setCommandHistory] = useState<string[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    const setIsLoadingRef = useRef(commandHistoryContext.setIsLoading);
    const setCommandHistoryContextRef = useRef(
      commandHistoryContext.setCommandHistory,
    );

    useEffect(() => {
      setIsLoadingRef.current = commandHistoryContext.setIsLoading;
      setCommandHistoryContextRef.current =
        commandHistoryContext.setCommandHistory;
    }, [
      commandHistoryContext.setIsLoading,
      commandHistoryContext.setCommandHistory,
    ]);

    useEffect(() => {
      if (showHistoryDialog && hostConfig.id) {
        setIsLoadingHistory(true);
        setIsLoadingRef.current(true);
        getCommandHistory(hostConfig.id!)
          .then((history) => {
            setCommandHistory(history);
            setCommandHistoryContextRef.current(history);
          })
          .catch((error) => {
            console.error("Failed to load command history:", error);
            setCommandHistory([]);
            setCommandHistoryContextRef.current([]);
          })
          .finally(() => {
            setIsLoadingHistory(false);
            setIsLoadingRef.current(false);
          });
      }
    }, [showHistoryDialog, hostConfig.id]);

    useEffect(() => {
      const autocompleteEnabled =
        localStorage.getItem("commandAutocomplete") === "true";

      if (hostConfig.id && autocompleteEnabled) {
        getCommandHistory(hostConfig.id!)
          .then((history) => {
            autocompleteHistory.current = history;
          })
          .catch((error) => {
            console.error("Failed to load autocomplete history:", error);
            autocompleteHistory.current = [];
          });
      } else {
        autocompleteHistory.current = [];
      }
    }, [hostConfig.id]);

    useEffect(() => {
      showAutocompleteRef.current = showAutocomplete;
    }, [showAutocomplete]);

    useEffect(() => {
      autocompleteSuggestionsRef.current = autocompleteSuggestions;
    }, [autocompleteSuggestions]);

    useEffect(() => {
      autocompleteSelectedIndexRef.current = autocompleteSelectedIndex;
    }, [autocompleteSelectedIndex]);

    const activityLoggingRef = useRef(false);
    const sudoPromptShownRef = useRef(false);

    const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const pendingSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const notifyTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastFittedSizeRef = useRef<{ cols: number; rows: number } | null>(
      null,
    );
    const DEBOUNCE_MS = 140;

    const logTerminalActivity = async () => {
      if (
        !hostConfig.id ||
        activityLoggedRef.current ||
        activityLoggingRef.current
      ) {
        return;
      }

      activityLoggingRef.current = true;
      activityLoggedRef.current = true;

      try {
        const hostName =
          hostConfig.name || `${hostConfig.username}@${hostConfig.ip}`;
        await logActivity("terminal", hostConfig.id, hostName);
      } catch (err) {
        console.warn("Failed to log terminal activity:", err);
        activityLoggedRef.current = false;
      } finally {
        activityLoggingRef.current = false;
      }
    };

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
        !isVisible ||
        isFittingRef.current
      ) {
        return;
      }

      const lastSize = lastFittedSizeRef.current;
      if (
        lastSize &&
        lastSize.cols === terminal.cols &&
        lastSize.rows === terminal.rows
      ) {
        return;
      }

      isFittingRef.current = true;

      try {
        fitAddonRef.current?.fit();
        if (terminal && terminal.cols > 0 && terminal.rows > 0) {
          scheduleNotify(terminal.cols, terminal.rows);
          lastFittedSizeRef.current = {
            cols: terminal.cols,
            rows: terminal.rows,
          };
        }
        setIsFitted(true);
      } finally {
        isFittingRef.current = false;
      }
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
      if (onClose) onClose();
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
      if (onClose) onClose();
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
          webSocketRef.current?.close();
          setIsConnected(false);
          setIsConnecting(false);
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

    function getUseRightClickCopyPaste() {
      return getCookie("rightClickCopyPaste") === "true";
    }

    function attemptReconnection() {
      if (
        isUnmountingRef.current ||
        shouldNotReconnectRef.current ||
        isReconnectingRef.current ||
        isConnectingRef.current ||
        wasDisconnectedBySSH.current
      ) {
        return;
      }

      if (reconnectAttempts.current >= maxReconnectAttempts) {
        toast.error(t("terminal.maxReconnectAttemptsReached"));
        if (onClose) {
          onClose();
        }
        return;
      }

      isReconnectingRef.current = true;

      if (terminal) {
        terminal.clear();
      }

      reconnectAttempts.current++;

      toast.info(
        t("terminal.reconnecting", {
          attempt: reconnectAttempts.current,
          max: maxReconnectAttempts,
        }),
      );

      const delay = Math.min(
        2000 * Math.pow(2, reconnectAttempts.current - 1),
        8000,
      );

      reconnectTimeoutRef.current = setTimeout(() => {
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
          setConnectionError("Authentication required for reconnection");
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
      }

      const isDev =
        !isElectron() &&
        process.env.NODE_ENV === "development" &&
        (window.location.port === "3000" ||
          window.location.port === "5173" ||
          window.location.port === "");

      const jwtToken = getCookie("jwt");

      if (!jwtToken || jwtToken.trim() === "") {
        console.error("No JWT token available for WebSocket connection");
        setIsConnected(false);
        setIsConnecting(false);
        setConnectionError("Authentication required");
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
          : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ssh/websocket/`;

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
      setConnectionError(null);
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
          if (!isConnected && !totpRequired && !isPasswordPrompt) {
            if (terminal) {
              terminal.clear();
            }
            toast.error(t("terminal.connectionTimeout"));
            if (webSocketRef.current) {
              webSocketRef.current.close();
            }
            if (reconnectAttempts.current > 0) {
              attemptReconnection();
            } else {
              shouldNotReconnectRef.current = true;
              if (onClose) {
                onClose();
              }
            }
          }
        }, 35000);

        ws.send(
          JSON.stringify({
            type: "connectToHost",
            data: { cols, rows, hostConfig, initialPath, executeCommand },
          }),
        );
        terminal.onData((data) => {
          trackInput(data);
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
              const syntaxHighlightingEnabled =
                localStorage.getItem("terminalSyntaxHighlighting") === "true";

              const outputData = syntaxHighlightingEnabled
                ? highlightTerminalOutput(msg.data)
                : msg.data;

              terminal.write(outputData);
              // Universal regex pattern for sudo password prompt
              // Matches "[sudo]" prefix + any text + ":" suffix, works for all languages
              // Also matches "sudo: a password is required" for some systems
              const sudoPasswordPattern =
                /(?:\[sudo\][^\n]*:\s*$|sudo:[^\n]*password[^\n]*required)/i;
              const passwordToFill =
                hostConfig.terminalConfig?.sudoPassword || hostConfig.password;
              if (
                config.sudoPasswordAutoFill &&
                sudoPasswordPattern.test(msg.data) &&
                passwordToFill &&
                !sudoPromptShownRef.current
              ) {
                sudoPromptShownRef.current = true;
                confirmWithToast(
                  t("terminal.sudoPasswordPopupTitle"),
                  async () => {
                    if (
                      webSocketRef.current &&
                      webSocketRef.current.readyState === WebSocket.OPEN
                    ) {
                      webSocketRef.current.send(
                        JSON.stringify({
                          type: "input",
                          data: passwordToFill + "\n",
                        }),
                      );
                    }
                    setTimeout(() => {
                      sudoPromptShownRef.current = false;
                    }, 3000);
                  },
                  t("common.confirm"),
                  t("common.cancel"),
                  { confirmOnEnter: true },
                );
                setTimeout(() => {
                  sudoPromptShownRef.current = false;
                }, 15000);
              }
            } else {
              const syntaxHighlightingEnabled =
                localStorage.getItem("terminalSyntaxHighlighting") === "true";

              const stringData = String(msg.data);
              const outputData = syntaxHighlightingEnabled
                ? highlightTerminalOutput(stringData)
                : stringData;

              terminal.write(outputData);
            }
          } else if (msg.type === "error") {
            const errorMessage = msg.message || t("terminal.unknownError");

            if (
              errorMessage.toLowerCase().includes("connection") ||
              errorMessage.toLowerCase().includes("timeout") ||
              errorMessage.toLowerCase().includes("network")
            ) {
              toast.error(
                t("terminal.connectionError", { message: errorMessage }),
              );
              setIsConnected(false);
              if (terminal) {
                terminal.clear();
              }
              setIsConnecting(true);
              wasDisconnectedBySSH.current = false;
              attemptReconnection();
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
              toast.error(t("terminal.authError", { message: errorMessage }));
              shouldNotReconnectRef.current = true;
              if (webSocketRef.current) {
                webSocketRef.current.close();
              }
              if (onClose) {
                onClose();
              }
              return;
            }

            toast.error(t("terminal.error", { message: errorMessage }));
          } else if (msg.type === "connected") {
            setIsConnected(true);
            setIsConnecting(false);
            isConnectingRef.current = false;
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            if (reconnectAttempts.current > 0) {
              toast.success(t("terminal.reconnected"));
            }
            reconnectAttempts.current = 0;
            isReconnectingRef.current = false;

            logTerminalActivity();

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
            setIsConnected(false);
            if (terminal) {
              terminal.clear();
            }
            setIsConnecting(false);
            if (onClose) {
              onClose();
            }
          } else if (msg.type === "totp_required") {
            totpAttemptsRef.current = 0;
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
              toast.error(t("terminal.totpTimeout"));
              if (webSocketRef.current) {
                webSocketRef.current.close();
              }
            }, 180000);
          } else if (msg.type === "totp_retry") {
            totpAttemptsRef.current++;
            const attemptsRemaining =
              msg.attempts_remaining || 3 - totpAttemptsRef.current;
            toast.error(
              `Invalid code. ${attemptsRemaining} ${attemptsRemaining === 1 ? "attempt" : "attempts"} remaining.`,
            );
          } else if (msg.type === "password_required") {
            totpAttemptsRef.current = 0;
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
              toast.error(t("terminal.passwordTimeout"));
              if (webSocketRef.current) {
                webSocketRef.current.close();
              }
            }, 180000);
          } else if (msg.type === "keyboard_interactive_available") {
            setKeyboardInteractiveDetected(true);
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
          }
        } catch {
          toast.error(t("terminal.messageParseError"));
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

        if (event.code === 1008) {
          console.error("WebSocket authentication failed:", event.reason);
          setConnectionError("Authentication failed - please re-login");
          setIsConnecting(false);
          shouldNotReconnectRef.current = true;

          localStorage.removeItem("jwt");

          setTimeout(() => {
            window.location.reload();
          }, 1000);

          return;
        }

        setIsConnecting(false);
        if (
          !wasDisconnectedBySSH.current &&
          !isUnmountingRef.current &&
          !shouldNotReconnectRef.current &&
          !isConnectingRef.current
        ) {
          wasDisconnectedBySSH.current = false;
          attemptReconnection();
        }
      });

      ws.addEventListener("error", () => {
        if (currentAttemptId !== connectionAttemptIdRef.current) {
          return;
        }

        setIsConnected(false);
        isConnectingRef.current = false;
        setConnectionError(t("terminal.websocketError"));
        if (terminal) {
          terminal.clear();
        }
        setIsConnecting(false);

        if (totpTimeoutRef.current) {
          clearTimeout(totpTimeoutRef.current);
          totpTimeoutRef.current = null;
        }

        if (
          !isUnmountingRef.current &&
          !shouldNotReconnectRef.current &&
          !isConnectingRef.current
        ) {
          wasDisconnectedBySSH.current = false;
          attemptReconnection();
        }
      });
    }

    async function writeTextToClipboard(text: string): Promise<void> {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          return;
        }
      } catch (error) {
        console.error("Terminal operation failed:", error);
      }
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(textarea);
      }
    }

    async function readTextFromClipboard(): Promise<string> {
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          return await navigator.clipboard.readText();
        }
      } catch (error) {
        console.error("Terminal operation failed:", error);
      }
      return "";
    }

    const handleSelectCommand = useCallback(
      (command: string) => {
        if (!terminal || !webSocketRef.current) return;

        for (const char of command) {
          webSocketRef.current.send(
            JSON.stringify({ type: "input", data: char }),
          );
        }

        setTimeout(() => {
          terminal.focus();
        }, 100);
      },
      [terminal],
    );

    useEffect(() => {
      commandHistoryContext.setOnSelectCommand(handleSelectCommand);
    }, [handleSelectCommand]);

    const handleAutocompleteSelect = useCallback(
      (selectedCommand: string) => {
        if (!webSocketRef.current) return;

        const currentCmd = currentAutocompleteCommand.current;
        const completion = selectedCommand.substring(currentCmd.length);

        for (const char of completion) {
          webSocketRef.current.send(
            JSON.stringify({ type: "input", data: char }),
          );
        }

        updateCurrentCommand(selectedCommand);

        setShowAutocomplete(false);
        setAutocompleteSuggestions([]);
        currentAutocompleteCommand.current = "";

        setTimeout(() => {
          terminal?.focus();
        }, 50);
      },
      [terminal, updateCurrentCommand],
    );

    const handleDeleteCommand = useCallback(
      async (command: string) => {
        if (!hostConfig.id) return;

        try {
          await deleteCommandFromHistory(hostConfig.id, command);

          setCommandHistory((prev) => {
            const newHistory = prev.filter((cmd) => cmd !== command);
            setCommandHistoryContextRef.current(newHistory);
            return newHistory;
          });

          autocompleteHistory.current = autocompleteHistory.current.filter(
            (cmd) => cmd !== command,
          );
        } catch (error) {
          console.error("Failed to delete command from history:", error);
        }
      },
      [hostConfig.id],
    );

    useEffect(() => {
      commandHistoryContext.setOnDeleteCommand(handleDeleteCommand);
    }, [handleDeleteCommand]);

    useEffect(() => {
      if (!terminal || !xtermRef.current) return;

      const config = {
        ...DEFAULT_TERMINAL_CONFIG,
        ...hostConfig.terminalConfig,
      };

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
      const clipboardAddon = new ClipboardAddon();
      const unicode11Addon = new Unicode11Addon();
      const webLinksAddon = new WebLinksAddon();

      fitAddonRef.current = fitAddon;
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(clipboardAddon);
      terminal.loadAddon(unicode11Addon);
      terminal.loadAddon(webLinksAddon);

      terminal.unicode.activeVersion = "11";

      terminal.open(xtermRef.current);

      fitAddonRef.current?.fit();
      if (terminal.cols < 10 || terminal.rows < 3) {
        requestAnimationFrame(() => {
          fitAddonRef.current?.fit();
          setIsFitted(true);
        });
      } else {
        setIsFitted(true);
      }

      const element = xtermRef.current;
      const handleContextMenu = async (e: MouseEvent) => {
        if (!getUseRightClickCopyPaste()) return;
        e.preventDefault();
        e.stopPropagation();
        try {
          if (terminal.hasSelection()) {
            const selection = terminal.getSelection();
            if (selection) {
              await writeTextToClipboard(selection);
              terminal.clearSelection();
            }
          } else {
            const pasteText = await readTextFromClipboard();
            if (pasteText) terminal.paste(pasteText);
          }
        } catch (error) {
          console.error("Terminal operation failed:", error);
        }
      };
      element?.addEventListener("contextmenu", handleContextMenu);

      const handleMacKeyboard = (e: KeyboardEvent) => {
        const isMacOS =
          navigator.platform.toUpperCase().indexOf("MAC") >= 0 ||
          navigator.userAgent.toUpperCase().indexOf("MAC") >= 0;

        if (
          config.backspaceMode === "control-h" &&
          e.key === "Backspace" &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey
        ) {
          e.preventDefault();
          e.stopPropagation();
          if (webSocketRef.current?.readyState === 1) {
            webSocketRef.current.send(
              JSON.stringify({ type: "input", data: "\x08" }),
            );
          }
          return false;
        }

        if (!isMacOS) return;

        if (e.altKey && !e.metaKey && !e.ctrlKey) {
          const keyMappings: { [key: string]: string } = {
            "7": "|",
            "2": "€",
            "8": "[",
            "9": "]",
            l: "@",
            L: "@",
            Digit7: "|",
            Digit2: "€",
            Digit8: "[",
            Digit9: "]",
            KeyL: "@",
          };

          const char = keyMappings[e.key] || keyMappings[e.code];
          if (char) {
            e.preventDefault();
            e.stopPropagation();

            if (webSocketRef.current?.readyState === 1) {
              webSocketRef.current.send(
                JSON.stringify({ type: "input", data: char }),
              );
            }
            return false;
          }
        }
      };

      element?.addEventListener("keydown", handleMacKeyboard, true);

      const resizeObserver = new ResizeObserver(() => {
        if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
        resizeTimeout.current = setTimeout(() => {
          if (isVisible && terminal?.cols > 0) {
            performFit();
          }
        }, 50);
      });

      resizeObserver.observe(xtermRef.current);

      return () => {
        // Only clean up UI-related resources here.
        // WebSocket cleanup is handled in a separate unmount-only effect
        // to prevent session loss when hostConfig object reference changes.
        isFittingRef.current = false;
        resizeObserver.disconnect();
        element?.removeEventListener("contextmenu", handleContextMenu);
        element?.removeEventListener("keydown", handleMacKeyboard, true);
        if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
        if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
      };
    }, [xtermRef, terminal, hostConfig, isDarkMode]);

    // Separate effect for WebSocket cleanup on true component unmount only.
    // This prevents session loss when hostConfig properties are updated.
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
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        webSocketRef.current?.close();
      };
    }, []);

    useEffect(() => {
      if (!terminal) return;

      const handleCustomKey = (e: KeyboardEvent): boolean => {
        if (e.type !== "keydown") {
          return true;
        }

        // Ctrl+Alt+<key> → Ctrl+<key> remapping for browser-blocked shortcuts
        // Browsers intercept Ctrl+W/T/N/Q, so we use Ctrl+Alt as an alternative
        if (e.ctrlKey && e.altKey && !e.metaKey && !e.shiftKey) {
          const key = e.key.toLowerCase();
          const blockedKeys = ["w", "t", "n", "q"];
          if (blockedKeys.includes(key)) {
            e.preventDefault();
            e.stopPropagation();
            const ctrlCode = key.charCodeAt(0) - 96;
            if (webSocketRef.current?.readyState === 1) {
              webSocketRef.current.send(
                JSON.stringify({
                  type: "input",
                  data: String.fromCharCode(ctrlCode),
                }),
              );
            }
            return false;
          }
        }

        if (showAutocompleteRef.current) {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setShowAutocomplete(false);
            setAutocompleteSuggestions([]);
            currentAutocompleteCommand.current = "";
            return false;
          }

          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();

            const currentIndex = autocompleteSelectedIndexRef.current;
            const suggestionsLength = autocompleteSuggestionsRef.current.length;

            if (e.key === "ArrowDown") {
              const newIndex =
                currentIndex < suggestionsLength - 1 ? currentIndex + 1 : 0;
              setAutocompleteSelectedIndex(newIndex);
            } else if (e.key === "ArrowUp") {
              const newIndex =
                currentIndex > 0 ? currentIndex - 1 : suggestionsLength - 1;
              setAutocompleteSelectedIndex(newIndex);
            }
            return false;
          }

          if (
            e.key === "Enter" &&
            autocompleteSuggestionsRef.current.length > 0
          ) {
            e.preventDefault();
            e.stopPropagation();

            const selectedCommand =
              autocompleteSuggestionsRef.current[
                autocompleteSelectedIndexRef.current
              ];
            const currentCmd = currentAutocompleteCommand.current;
            const completion = selectedCommand.substring(currentCmd.length);

            if (webSocketRef.current?.readyState === 1) {
              for (const char of completion) {
                webSocketRef.current.send(
                  JSON.stringify({ type: "input", data: char }),
                );
              }
            }

            updateCurrentCommandRef.current(selectedCommand);

            setShowAutocomplete(false);
            setAutocompleteSuggestions([]);
            currentAutocompleteCommand.current = "";

            return false;
          }

          if (
            e.key === "Tab" &&
            !e.ctrlKey &&
            !e.altKey &&
            !e.metaKey &&
            !e.shiftKey
          ) {
            e.preventDefault();
            e.stopPropagation();
            const currentIndex = autocompleteSelectedIndexRef.current;
            const suggestionsLength = autocompleteSuggestionsRef.current.length;
            const newIndex =
              currentIndex < suggestionsLength - 1 ? currentIndex + 1 : 0;
            setAutocompleteSelectedIndex(newIndex);
            return false;
          }

          setShowAutocomplete(false);
          setAutocompleteSuggestions([]);
          currentAutocompleteCommand.current = "";
          return true;
        }

        if (
          e.key === "Tab" &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.metaKey &&
          !e.shiftKey
        ) {
          e.preventDefault();
          e.stopPropagation();

          const autocompleteEnabled =
            localStorage.getItem("commandAutocomplete") === "true";

          if (!autocompleteEnabled) {
            if (webSocketRef.current?.readyState === 1) {
              webSocketRef.current.send(
                JSON.stringify({ type: "input", data: "\t" }),
              );
            }
            return false;
          }

          const currentCmd = getCurrentCommandRef.current().trim();
          if (currentCmd.length > 0 && webSocketRef.current?.readyState === 1) {
            const matches = autocompleteHistory.current
              .filter(
                (cmd) =>
                  cmd.startsWith(currentCmd) &&
                  cmd !== currentCmd &&
                  cmd.length > currentCmd.length,
              )
              .slice(0, 5);

            if (matches.length === 1) {
              const completedCommand = matches[0];
              const completion = completedCommand.substring(currentCmd.length);

              for (const char of completion) {
                webSocketRef.current.send(
                  JSON.stringify({ type: "input", data: char }),
                );
              }

              updateCurrentCommandRef.current(completedCommand);
            } else if (matches.length > 1) {
              currentAutocompleteCommand.current = currentCmd;
              setAutocompleteSuggestions(matches);
              setAutocompleteSelectedIndex(0);

              const cursorY = terminal.buffer.active.cursorY;
              const cursorX = terminal.buffer.active.cursorX;
              const rect = xtermRef.current?.getBoundingClientRect();

              if (rect) {
                const cellHeight =
                  terminal.rows > 0 ? rect.height / terminal.rows : 20;
                const cellWidth =
                  terminal.cols > 0 ? rect.width / terminal.cols : 10;

                const itemHeight = 32;
                const footerHeight = 32;
                const maxMenuHeight = 240;
                const estimatedMenuHeight = Math.min(
                  matches.length * itemHeight + footerHeight,
                  maxMenuHeight,
                );
                const cursorBottomY = rect.top + (cursorY + 1) * cellHeight;
                const cursorTopY = rect.top + cursorY * cellHeight;
                const spaceBelow = window.innerHeight - cursorBottomY;
                const spaceAbove = cursorTopY;

                const showAbove =
                  spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;

                setAutocompletePosition({
                  top: showAbove
                    ? Math.max(0, cursorTopY - estimatedMenuHeight)
                    : cursorBottomY,
                  left: Math.max(0, rect.left + cursorX * cellWidth),
                });
              }

              setShowAutocomplete(true);
            }
          }
          return false;
        }

        return true;
      };

      terminal.attachCustomKeyEventHandler(handleCustomKey);
    }, [terminal]);

    useEffect(() => {
      if (!terminal || !hostConfig || !isVisible) return;
      if (isConnected || isConnecting) return;

      if (terminal.cols < 10 || terminal.rows < 3) {
        requestAnimationFrame(() => {
          if (terminal.cols > 0 && terminal.rows > 0) {
            setIsConnecting(true);
            fitAddonRef.current?.fit();
            scheduleNotify(terminal.cols, terminal.rows);
            connectToHost(terminal.cols, terminal.rows);
          }
        });
        return;
      }

      setIsConnecting(true);
      fitAddonRef.current?.fit();
      if (terminal.cols > 0 && terminal.rows > 0) {
        scheduleNotify(terminal.cols, terminal.rows);
        connectToHost(terminal.cols, terminal.rows);
      }
      // Note: Using hostConfig.id instead of hostConfig object to prevent
      // unnecessary reconnections when host properties are updated.
      // Only reconnect when switching to a different host.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [terminal, hostConfig.id, isVisible, isConnected, isConnecting]);

    useEffect(() => {
      if (!terminal || !fitAddonRef.current || !isVisible) return;

      const fitTimeoutId = setTimeout(() => {
        if (!isFittingRef.current && terminal.cols > 0 && terminal.rows > 0) {
          performFit();
          if (!splitScreen && !isConnecting) {
            requestAnimationFrame(() => terminal.focus());
          }
        }
      }, 0);

      return () => clearTimeout(fitTimeoutId);
    }, [terminal, isVisible, splitScreen, isConnecting]);

    return (
      <div className="h-full w-full relative" style={{ backgroundColor }}>
        <div
          ref={xtermRef}
          className="h-full w-full"
          style={{
            pointerEvents: isVisible ? "auto" : "none",
            visibility: isConnecting || !isFitted ? "hidden" : "visible",
          }}
          onClick={() => {
            if (terminal && !splitScreen) {
              terminal.focus();
            }
          }}
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

        <CommandAutocomplete
          visible={showAutocomplete}
          suggestions={autocompleteSuggestions}
          selectedIndex={autocompleteSelectedIndex}
          position={autocompletePosition}
          onSelect={handleAutocompleteSelect}
        />

        <SimpleLoader
          visible={isConnecting}
          message={t("terminal.connecting")}
          backgroundColor={backgroundColor}
        />
      </div>
    );
  },
);

const style = document.createElement("style");
style.innerHTML = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Source+Code+Pro:ital,wght@0,400;0,700;1,400;1,700&display=swap');

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

/* Light theme scrollbars */
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

/* Dark theme scrollbars */
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
