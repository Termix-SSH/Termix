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
} from "@/ui/main-axios.ts";
import { TOTPDialog } from "@/ui/desktop/navigation/TOTPDialog.tsx";
import { SSHAuthDialog } from "@/ui/desktop/navigation/SSHAuthDialog.tsx";
import {
  TERMINAL_THEMES,
  DEFAULT_TERMINAL_CONFIG,
  TERMINAL_FONTS,
} from "@/constants/terminal-themes";
import type { TerminalConfig } from "@/types";
import { useCommandTracker } from "@/ui/hooks/useCommandTracker";
import { useCommandHistory as useCommandHistoryHook } from "@/ui/hooks/useCommandHistory";
import { useCommandHistory } from "@/ui/desktop/contexts/CommandHistoryContext.tsx";
import { CommandAutocomplete } from "./CommandAutocomplete";
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

    const config = { ...DEFAULT_TERMINAL_CONFIG, ...hostConfig.terminalConfig };
    const themeColors =
      TERMINAL_THEMES[config.theme]?.colors || TERMINAL_THEMES.termix.colors;
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
    const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const activityLoggedRef = useRef(false);
    const keyHandlerAttachedRef = useRef(false);

    // Command history tracking (Stage 1)
    const { trackInput, getCurrentCommand, updateCurrentCommand } =
      useCommandTracker({
        hostId: hostConfig.id,
        enabled: true,
        onCommandExecuted: (command) => {
          // Add to autocomplete history (Stage 3)
          if (!autocompleteHistory.current.includes(command)) {
            autocompleteHistory.current = [
              command,
              ...autocompleteHistory.current,
            ];
          }
        },
      });

    // Create refs for callbacks to avoid triggering useEffect re-runs
    const getCurrentCommandRef = useRef(getCurrentCommand);
    const updateCurrentCommandRef = useRef(updateCurrentCommand);

    useEffect(() => {
      getCurrentCommandRef.current = getCurrentCommand;
      updateCurrentCommandRef.current = updateCurrentCommand;
    }, [getCurrentCommand, updateCurrentCommand]);

    // Real-time autocomplete (Stage 3)
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

    // Refs for accessing current state in event handlers
    const showAutocompleteRef = useRef(false);
    const autocompleteSuggestionsRef = useRef<string[]>([]);
    const autocompleteSelectedIndexRef = useRef(0);

    // Command history dialog (Stage 2)
    const [showHistoryDialog, setShowHistoryDialog] = useState(false);
    const [commandHistory, setCommandHistory] = useState<string[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    // Load command history when dialog opens
    useEffect(() => {
      if (showHistoryDialog && hostConfig.id) {
        setIsLoadingHistory(true);
        commandHistoryContext.setIsLoading(true);
        import("@/ui/main-axios.ts")
          .then((module) => module.getCommandHistory(hostConfig.id!))
          .then((history) => {
            setCommandHistory(history);
            commandHistoryContext.setCommandHistory(history);
          })
          .catch((error) => {
            console.error("Failed to load command history:", error);
            setCommandHistory([]);
            commandHistoryContext.setCommandHistory([]);
          })
          .finally(() => {
            setIsLoadingHistory(false);
            commandHistoryContext.setIsLoading(false);
          });
      }
    }, [showHistoryDialog, hostConfig.id, commandHistoryContext]);

    // Load command history for autocomplete on mount (Stage 3)
    useEffect(() => {
      if (hostConfig.id) {
        import("@/ui/main-axios.ts")
          .then((module) => module.getCommandHistory(hostConfig.id!))
          .then((history) => {
            autocompleteHistory.current = history;
          })
          .catch((error) => {
            console.error("Failed to load autocomplete history:", error);
            autocompleteHistory.current = [];
          });
      }
    }, [hostConfig.id]);

    // Sync autocomplete state to refs for event handlers
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

    const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const pendingSizeRef = useRef<{ cols: number; rows: number } | null>(null);
    const notifyTimerRef = useRef<NodeJS.Timeout | null>(null);
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
          setIsFitted(true);
        } finally {
          isFittingRef.current = false;
        }
      });
    }

    function handleTotpSubmit(code: string) {
      if (webSocketRef.current && code) {
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
      }, 2000 * reconnectAttempts.current);
    }

    function connectToHost(cols: number, rows: number) {
      if (isConnectingRef.current) {
        return;
      }

      isConnectingRef.current = true;

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
            }
          }
        }, 10000);

        ws.send(
          JSON.stringify({
            type: "connectToHost",
            data: { cols, rows, hostConfig, initialPath, executeCommand },
          }),
        );
        terminal.onData((data) => {
          // Track command input for history (Stage 1)
          trackInput(data);
          // Send input to server
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
                    await new Promise((resolve) => setTimeout(resolve, 100));
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
                    await new Promise((resolve) => setTimeout(resolve, 200));
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
            }, 500);
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
            setTotpRequired(true);
            setTotpPrompt(msg.prompt || "Verification code:");
            setIsPasswordPrompt(false);
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
          } else if (msg.type === "password_required") {
            setTotpRequired(true);
            setTotpPrompt(msg.prompt || "Password:");
            setIsPasswordPrompt(true);
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
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

      ws.addEventListener("close", (event) => {
        setIsConnected(false);
        isConnectingRef.current = false;
        if (terminal) {
          terminal.clear();
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
          !shouldNotReconnectRef.current
        ) {
          wasDisconnectedBySSH.current = false;
          attemptReconnection();
        }
      });

      ws.addEventListener("error", () => {
        setIsConnected(false);
        isConnectingRef.current = false;
        setConnectionError(t("terminal.websocketError"));
        if (terminal) {
          terminal.clear();
        }
        setIsConnecting(false);
        if (!isUnmountingRef.current && !shouldNotReconnectRef.current) {
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

    // Handle command selection from history dialog (Stage 2)
    const handleSelectCommand = useCallback(
      (command: string) => {
        if (!terminal || !webSocketRef.current) return;

        // Send the command to the terminal
        // Simulate typing the command character by character
        for (const char of command) {
          webSocketRef.current.send(
            JSON.stringify({ type: "input", data: char }),
          );
        }

        // Return focus to terminal after selecting command
        setTimeout(() => {
          terminal.focus();
        }, 100);
      },
      [terminal],
    );

    // Register handlers with context
    useEffect(() => {
      commandHistoryContext.setOnSelectCommand(handleSelectCommand);
    }, [handleSelectCommand, commandHistoryContext]);

    // Handle autocomplete selection (mouse click)
    const handleAutocompleteSelect = useCallback(
      (selectedCommand: string) => {
        if (!webSocketRef.current) return;

        const currentCmd = currentAutocompleteCommand.current;
        const completion = selectedCommand.substring(currentCmd.length);

        // Send completion characters to server
        for (const char of completion) {
          webSocketRef.current.send(
            JSON.stringify({ type: "input", data: char }),
          );
        }

        // Update current command tracker
        updateCurrentCommand(selectedCommand);

        // Close autocomplete
        setShowAutocomplete(false);
        setAutocompleteSuggestions([]);
        currentAutocompleteCommand.current = "";

        // Return focus to terminal
        setTimeout(() => {
          terminal?.focus();
        }, 50);

        console.log(`[Autocomplete] ${currentCmd} → ${selectedCommand}`);
      },
      [terminal, updateCurrentCommand],
    );

    // Handle command deletion from history dialog
    const handleDeleteCommand = useCallback(
      async (command: string) => {
        if (!hostConfig.id) return;

        try {
          // Call API to delete command
          const { deleteCommandFromHistory } = await import(
            "@/ui/main-axios.ts"
          );
          await deleteCommandFromHistory(hostConfig.id, command);

          // Update local state
          setCommandHistory((prev) => {
            const newHistory = prev.filter((cmd) => cmd !== command);
            commandHistoryContext.setCommandHistory(newHistory);
            return newHistory;
          });

          // Update autocomplete history
          autocompleteHistory.current = autocompleteHistory.current.filter(
            (cmd) => cmd !== command,
          );

          console.log(`[Terminal] Command deleted from history: ${command}`);
        } catch (error) {
          console.error("Failed to delete command from history:", error);
        }
      },
      [hostConfig.id, commandHistoryContext],
    );

    // Register delete handler with context
    useEffect(() => {
      commandHistoryContext.setOnDeleteCommand(handleDeleteCommand);
    }, [handleDeleteCommand, commandHistoryContext]);

    useEffect(() => {
      if (!terminal || !xtermRef.current) return;

      const config = {
        ...DEFAULT_TERMINAL_CONFIG,
        ...hostConfig.terminalConfig,
      };

      const themeColors =
        TERMINAL_THEMES[config.theme]?.colors || TERMINAL_THEMES.termix.colors;

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
        convertEol: true,
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

        // Handle Ctrl+R for command history (Stage 2)
        if (
          e.ctrlKey &&
          e.key === "r" &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey
        ) {
          e.preventDefault();
          e.stopPropagation();
          setShowHistoryDialog(true);
          // Also trigger the sidebar to open
          if (commandHistoryContext.openCommandHistory) {
            commandHistoryContext.openCommandHistory();
          }
          return false;
        }

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
          if (!isVisibleRef.current || !isReady) return;
          performFit();
        }, 50);
      });

      resizeObserver.observe(xtermRef.current);

      setVisible(true);

      return () => {
        isUnmountingRef.current = true;
        shouldNotReconnectRef.current = true;
        isReconnectingRef.current = false;
        setIsConnecting(false);
        setVisible(false);
        setIsReady(false);
        isFittingRef.current = false;
        resizeObserver.disconnect();
        element?.removeEventListener("contextmenu", handleContextMenu);
        element?.removeEventListener("keydown", handleMacKeyboard, true);
        if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
        if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
        if (reconnectTimeoutRef.current)
          clearTimeout(reconnectTimeoutRef.current);
        if (connectionTimeoutRef.current)
          clearTimeout(connectionTimeoutRef.current);
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        webSocketRef.current?.close();
      };
    }, [xtermRef, terminal, hostConfig]);

    // Register keyboard handler for autocomplete (Stage 3)
    // Registered only once when terminal is created
    useEffect(() => {
      if (!terminal) return;

      const handleCustomKey = (e: KeyboardEvent): boolean => {
        // Only handle keydown events, ignore keyup to prevent double triggering
        if (e.type !== "keydown") {
          return true;
        }

        // If autocomplete is showing, handle keys specially
        if (showAutocompleteRef.current) {
          // Handle Escape to close autocomplete
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setShowAutocomplete(false);
            setAutocompleteSuggestions([]);
            currentAutocompleteCommand.current = "";
            return false;
          }

          // Handle Arrow keys for autocomplete navigation
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

          // Handle Enter to confirm autocomplete selection
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

            // Send completion characters to server
            if (webSocketRef.current?.readyState === 1) {
              for (const char of completion) {
                webSocketRef.current.send(
                  JSON.stringify({ type: "input", data: char }),
                );
              }
            }

            // Update current command tracker
            updateCurrentCommandRef.current(selectedCommand);

            // Close autocomplete
            setShowAutocomplete(false);
            setAutocompleteSuggestions([]);
            currentAutocompleteCommand.current = "";

            return false;
          }

          // Handle Tab to cycle through suggestions
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

          // For any other key while autocomplete is showing, close it and let key through
          setShowAutocomplete(false);
          setAutocompleteSuggestions([]);
          currentAutocompleteCommand.current = "";
          return true;
        }

        // Handle Tab for autocomplete (when autocomplete is not showing)
        if (
          e.key === "Tab" &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.metaKey &&
          !e.shiftKey
        ) {
          e.preventDefault();
          e.stopPropagation();

          const currentCmd = getCurrentCommandRef.current().trim();
          if (currentCmd.length > 0 && webSocketRef.current?.readyState === 1) {
            // Filter commands that start with current input
            const matches = autocompleteHistory.current
              .filter(
                (cmd) =>
                  cmd.startsWith(currentCmd) &&
                  cmd !== currentCmd &&
                  cmd.length > currentCmd.length,
              )
              .slice(0, 10); // Show up to 10 matches

            if (matches.length === 1) {
              // Only one match - auto-complete directly
              const completedCommand = matches[0];
              const completion = completedCommand.substring(currentCmd.length);

              for (const char of completion) {
                webSocketRef.current.send(
                  JSON.stringify({ type: "input", data: char }),
                );
              }

              updateCurrentCommandRef.current(completedCommand);
            } else if (matches.length > 1) {
              // Multiple matches - show selection list
              currentAutocompleteCommand.current = currentCmd;
              setAutocompleteSuggestions(matches);
              setAutocompleteSelectedIndex(0);

              // Calculate position (below or above cursor based on available space)
              const cursorY = terminal.buffer.active.cursorY;
              const cursorX = terminal.buffer.active.cursorX;
              const rect = xtermRef.current?.getBoundingClientRect();

              if (rect) {
                const cellHeight =
                  terminal.rows > 0 ? rect.height / terminal.rows : 20;
                const cellWidth =
                  terminal.cols > 0 ? rect.width / terminal.cols : 10;

                // Estimate autocomplete menu height (max-h-[240px] from component)
                const menuHeight = 240;
                const cursorBottomY = rect.top + (cursorY + 1) * cellHeight;
                const spaceBelow = window.innerHeight - cursorBottomY;
                const spaceAbove = rect.top + cursorY * cellHeight;

                // Show above cursor if not enough space below
                const showAbove =
                  spaceBelow < menuHeight && spaceAbove > spaceBelow;

                setAutocompletePosition({
                  top: showAbove
                    ? rect.top + cursorY * cellHeight - menuHeight
                    : cursorBottomY,
                  left: rect.left + cursorX * cellWidth,
                });
              }

              setShowAutocomplete(true);
            }
          }
          return false; // Prevent default Tab behavior
        }

        // Let terminal handle all other keys
        return true;
      };

      terminal.attachCustomKeyEventHandler(handleCustomKey);
    }, [terminal]);

    useEffect(() => {
      if (!terminal || !hostConfig || !visible) return;

      if (isConnected || isConnecting) return;

      setIsConnecting(true);

      const readyFonts =
        (document as { fonts?: { ready?: Promise<unknown> } }).fonts
          ?.ready instanceof Promise
          ? (document as { fonts?: { ready?: Promise<unknown> } }).fonts.ready
          : Promise.resolve();

      readyFonts.then(() => {
        requestAnimationFrame(() => {
          fitAddonRef.current?.fit();
          if (terminal && terminal.cols > 0 && terminal.rows > 0) {
            scheduleNotify(terminal.cols, terminal.rows);
          }
          hardRefresh();

          setVisible(true);
          setIsReady(true);

          if (terminal && !splitScreen) {
            terminal.focus();
          }

          const jwtToken = getCookie("jwt");

          if (!jwtToken || jwtToken.trim() === "") {
            setIsConnected(false);
            setIsConnecting(false);
            setConnectionError("Authentication required");
            return;
          }

          const cols = terminal.cols;
          const rows = terminal.rows;

          connectToHost(cols, rows);
        });
      });
    }, [terminal, hostConfig, visible, isConnected, isConnecting, splitScreen]);

    useEffect(() => {
      if (!isVisible || !isReady || !fitAddonRef.current || !terminal) {
        if (!isVisible && isFitted) {
          setIsFitted(false);
        }
        return;
      }

      setIsFitted(false);

      let rafId1: number;
      let rafId2: number;

      rafId1 = requestAnimationFrame(() => {
        rafId2 = requestAnimationFrame(() => {
          hardRefresh();
          performFit();
        });
      });

      return () => {
        if (rafId1) cancelAnimationFrame(rafId1);
        if (rafId2) cancelAnimationFrame(rafId2);
      };
    }, [isVisible, isReady, splitScreen, terminal]);

    useEffect(() => {
      if (
        isFitted &&
        isVisible &&
        isReady &&
        !isConnecting &&
        terminal &&
        !splitScreen
      ) {
        const rafId = requestAnimationFrame(() => {
          terminal.focus();
        });
        return () => cancelAnimationFrame(rafId);
      }
    }, [isFitted, isVisible, isReady, isConnecting, terminal, splitScreen]);

    return (
      <div className="h-full w-full relative" style={{ backgroundColor }}>
        <div
          ref={xtermRef}
          className="h-full w-full"
          style={{
            visibility:
              isReady && !isConnecting && isFitted ? "visible" : "hidden",
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

.xterm .xterm-viewport::-webkit-scrollbar {
  width: 8px;
  background: transparent;
}
.xterm .xterm-viewport::-webkit-scrollbar-thumb {
  background: rgba(180,180,180,0.7);
  border-radius: 4px;
}
.xterm .xterm-viewport::-webkit-scrollbar-thumb:hover {
  background: rgba(120,120,120,0.9);
}
.xterm .xterm-viewport {
  scrollbar-width: thin;
  scrollbar-color: rgba(180,180,180,0.7) transparent;
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
