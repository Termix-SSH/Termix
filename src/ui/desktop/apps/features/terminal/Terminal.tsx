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
import { getBasePath } from "@/lib/base-path";
import {
  getCookie,
  isElectron,
  isEmbeddedMode,
  logActivity,
  getSnippets,
  deleteCommandFromHistory,
  getCommandHistory,
  getHostPassword,
  getServerConfig,
} from "@/ui/main-axios.ts";
import { TOTPDialog } from "@/ui/desktop/navigation/dialogs/TOTPDialog.tsx";
import { SSHAuthDialog } from "@/ui/desktop/navigation/dialogs/SSHAuthDialog.tsx";
import { PassphraseDialog } from "@/ui/desktop/navigation/dialogs/PassphraseDialog.tsx";
import { WarpgateDialog } from "@/ui/desktop/navigation/dialogs/WarpgateDialog.tsx";
import { OPKSSHDialog } from "@/ui/desktop/navigation/dialogs/OPKSSHDialog.tsx";
import { HostKeyVerificationDialog } from "@/ui/desktop/navigation/dialogs/HostKeyVerificationDialog.tsx";
import { TmuxSessionPicker } from "@/ui/desktop/navigation/dialogs/TmuxSessionPicker.tsx";
import {
  TERMINAL_THEMES,
  DEFAULT_TERMINAL_CONFIG,
  TERMINAL_FONTS,
} from "@/constants/terminal-themes.ts";
import type { TerminalConfig } from "@/types";
import { useTheme } from "@/components/theme-provider.tsx";
import { useCommandTracker } from "@/ui/hooks/useCommandTracker.ts";
import { highlightTerminalOutput } from "@/lib/terminal-syntax-highlighter.ts";
import { useCommandHistory } from "@/ui/desktop/apps/features/terminal/command-history/CommandHistoryContext.tsx";
import { CommandAutocomplete } from "./command-history/CommandAutocomplete.tsx";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  ConnectionLogProvider,
  useConnectionLog,
} from "@/ui/desktop/navigation/connection-log/ConnectionLogContext.tsx";
import { ConnectionLog } from "@/ui/desktop/navigation/connection-log/ConnectionLog.tsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface HostConfig {
  id?: number;
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
  terminalConfig?: TerminalConfig;
  [key: string]: unknown;
}

interface TerminalHandle {
  disconnect: () => void;
  reconnect: () => void;
  fit: () => void;
  sendInput: (data: string) => void;
  notifyResize: () => void;
  refresh: () => void;
}

type HostKeyVerificationData = Omit<
  React.ComponentProps<typeof HostKeyVerificationDialog>,
  "isOpen" | "scenario" | "onAccept" | "onReject" | "backgroundColor"
>;

interface SSHTerminalProps {
  hostConfig: HostConfig;
  isVisible: boolean;
  title?: string;
  showTitle?: boolean;
  splitScreen?: boolean;
  onClose?: () => void;
  onTitleChange?: (title: string) => void;
  initialPath?: string;
  executeCommand?: string;
  onOpenFileManager?: (path?: string) => void;
  previewTheme?: string | null;
}

const TerminalInner = forwardRef<TerminalHandle, SSHTerminalProps>(
  function SSHTerminal(
    {
      hostConfig,
      isVisible,
      splitScreen = false,
      onClose,
      initialPath,
      executeCommand,
      onOpenFileManager,
      previewTheme,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const { instance: terminal, ref: xtermRef } = useXTerm();
    const commandHistoryContext = useCommandHistory();
    const { confirmWithToast } = useConfirmation();
    const { theme: appTheme } = useTheme();
    const { addLog, isExpanded: isConnectionLogExpanded } = useConnectionLog();

    const savedTheme = localStorage.getItem(
      `terminal_theme_host_${hostConfig.id}`,
    );
    const config = {
      ...DEFAULT_TERMINAL_CONFIG,
      ...hostConfig.terminalConfig,
      theme:
        savedTheme ||
        hostConfig.terminalConfig?.theme ||
        DEFAULT_TERMINAL_CONFIG.theme,
    };

    const isDarkMode =
      appTheme === "dark" ||
      appTheme === "dracula" ||
      appTheme === "gentlemansChoice" ||
      appTheme === "midnightEspresso" ||
      appTheme === "catppuccinMocha" ||
      (appTheme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    let themeColors;
    const activeTheme = previewTheme || config.theme;

    if (activeTheme === "termix") {
      themeColors = isDarkMode
        ? TERMINAL_THEMES.termixDark.colors
        : TERMINAL_THEMES.termixLight.colors;
    } else {
      themeColors =
        TERMINAL_THEMES[activeTheme]?.colors ||
        TERMINAL_THEMES.termixDark.colors;
    }
    const backgroundColor = themeColors.background;
    const fitAddonRef = useRef<FitAddon | null>(null);
    const webSocketRef = useRef<WebSocket | null>(null);
    const resizeTimeout = useRef<NodeJS.Timeout | null>(null);
    const wasDisconnectedBySSH = useRef(false);
    const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const pongReceivedRef = useRef(true);
    const pongTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isFitted, setIsFitted] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const connectionErrorRef = useRef<string | null>(null);
    const [showDisconnectedOverlay, setShowDisconnectedOverlay] =
      useState(false);

    const updateConnectionError = useCallback((error: string | null) => {
      connectionErrorRef.current = error;
      setConnectionError(error);
    }, []);

    const [, setIsAuthenticated] = useState(false);
    const [totpRequired, setTotpRequired] = useState(false);
    const [totpPrompt, setTotpPrompt] = useState<string>("");
    const [isPasswordPrompt, setIsPasswordPrompt] = useState(false);
    const [showAuthDialog, setShowAuthDialog] = useState(false);
    const [authDialogReason, setAuthDialogReason] = useState<
      "no_keyboard" | "auth_failed" | "timeout"
    >("no_keyboard");
    const [showPassphraseDialog, setShowPassphraseDialog] = useState(false);
    const [keyboardInteractiveDetected, setKeyboardInteractiveDetected] =
      useState(false);
    const [warpgateAuthRequired, setWarpgateAuthRequired] = useState(false);
    const [warpgateAuthUrl, setWarpgateAuthUrl] = useState<string>("");
    const [warpgateSecurityKey, setWarpgateSecurityKey] = useState<string>("");
    const warpgateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [opksshDialog, setOpksshDialog] = useState<{
      isOpen: boolean;
      authUrl: string;
      requestId: string;
      stage: "chooser" | "waiting" | "authenticating" | "completed" | "error";
      error?: string;
      providers?: Array<{ alias: string; issuer: string }>;
    } | null>(null);
    const opksshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const opksshFailedRef = useRef(false);
    const currentHostIdRef = useRef<number | null>(null);
    const currentHostConfigRef = useRef<HostConfig | null>(null);

    const [hostKeyVerification, setHostKeyVerification] = useState<{
      isOpen: boolean;
      scenario: "new" | "changed";
      data: HostKeyVerificationData;
    } | null>(null);

    const sessionIdRef = useRef<string | null>(null);
    const isAttachingSessionRef = useRef<boolean>(false);
    const [tmuxSessionPicker, setTmuxSessionPicker] = useState<{
      sessions: Array<{
        name: string;
        created: number;
        lastActivity: number;
        windows: number;
        attachedClients: number;
      }>;
    } | null>(null);
    const tmuxSessionNameRef = useRef<string | null>(null);
    const tmuxCopyModeHintShownRef = useRef(false);

    const isVisibleRef = useRef<boolean>(false);
    const isFittingRef = useRef(false);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttempts = useRef(0);
    const maxReconnectAttempts = 8;
    const isUnmountingRef = useRef(false);
    const shouldNotReconnectRef = useRef(false);
    const isReconnectingRef = useRef(false);
    const isConnectingRef = useRef(false);
    const wasConnectedRef = useRef(false);
    const closeAfterDisconnectRef = useRef(false);

    useEffect(() => {
      isUnmountingRef.current = false;
      shouldNotReconnectRef.current = false;
      isReconnectingRef.current = false;
      isConnectingRef.current = false;
      reconnectAttempts.current = 0;
      wasConnectedRef.current = false;
      isAttachingSessionRef.current = false;
      closeAfterDisconnectRef.current = false;

      return () => {};
    }, [hostConfig.id]);
    const connectionAttemptIdRef = useRef(0);
    const totpTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const activityLoggedRef = useRef(false);
    const [commandHistoryTrackingEnabled, setCommandHistoryTrackingEnabled] =
      useState<boolean>(
        () => localStorage.getItem("commandHistoryTracking") === "true",
      );

    useEffect(() => {
      const handleCommandHistoryTrackingChanged = () => {
        setCommandHistoryTrackingEnabled(
          localStorage.getItem("commandHistoryTracking") === "true",
        );
      };

      window.addEventListener(
        "commandHistoryTrackingChanged",
        handleCommandHistoryTrackingChanged,
      );

      return () => {
        window.removeEventListener(
          "commandHistoryTrackingChanged",
          handleCommandHistoryTrackingChanged,
        );
      };
    }, []);

    const { trackInput, getCurrentCommand, updateCurrentCommand } =
      useCommandTracker({
        hostId: hostConfig.id,
        enabled: commandHistoryTrackingEnabled,
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

    const [showHistoryDialog] = useState(false);
    const [, setCommandHistory] = useState<string[]>([]);
    const [, setIsLoadingHistory] = useState(false);

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
        setIsAuthenticated((prev) => {
          if (!prev) {
            return true;
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
      if (onClose) onClose();
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
      if (onClose) onClose();
    }

    function handlePassphraseSubmit(passphrase: string) {
      if (webSocketRef.current && terminal) {
        webSocketRef.current.send(
          JSON.stringify({
            type: "reconnect_with_credentials",
            data: {
              cols: terminal.cols,
              rows: terminal.rows,
              keyPassword: passphrase,
              hostConfig: {
                ...hostConfig,
                keyPassword: passphrase,
              },
            },
          }),
        );
        setShowPassphraseDialog(false);
        setIsConnecting(true);
      }
    }

    function handlePassphraseCancel() {
      setShowPassphraseDialog(false);
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
          if (pongTimeoutRef.current) {
            clearTimeout(pongTimeoutRef.current);
            pongTimeoutRef.current = null;
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
          if (webSocketRef.current?.readyState === WebSocket.OPEN) {
            webSocketRef.current.send(JSON.stringify({ type: "disconnect" }));
          }
          const tabId = hostConfig.id ?? "default";
          localStorage.removeItem(`termix_session_${tabId}`);
          sessionIdRef.current = null;
          webSocketRef.current?.close();
          setIsConnected(false);
          setIsConnecting(false);
        },
        reconnect: () => {
          isUnmountingRef.current = false;
          shouldNotReconnectRef.current = false;
          isReconnectingRef.current = false;
          isConnectingRef.current = false;
          reconnectAttempts.current = 0;
          wasDisconnectedBySSH.current = false;
          wasConnectedRef.current = false;
          updateConnectionError(null);
          setShowDisconnectedOverlay(false);
          if (terminal) {
            terminal.clear();
            const cols = terminal.cols;
            const rows = terminal.rows;
            connectToHost(cols, rows);
          }
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
        openFileManager: () => {
          if (webSocketRef.current?.readyState === WebSocket.OPEN) {
            webSocketRef.current.send(JSON.stringify({ type: "get_cwd" }));
          } else {
            onOpenFileManager?.("/");
          }
        },
      }),
      [terminal],
    );

    function getUseRightClickCopyPaste() {
      return getCookie("rightClickCopyPaste") !== "false";
    }

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
        setIsConnecting(false);
        shouldNotReconnectRef.current = true;
        setShowDisconnectedOverlay(true);
        addLog({
          type: "error",
          stage: "connection",
          message: t("terminal.maxReconnectAttemptsReached"),
        });
        return;
      }

      isReconnectingRef.current = true;

      if (terminal && !isAttachingSessionRef.current) {
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

        if (terminal && hostConfig) {
          if (!isAttachingSessionRef.current) {
            terminal.clear();
          }
          const cols = terminal.cols;
          const rows = terminal.rows;
          connectToHost(cols, rows);
        }

        isReconnectingRef.current = false;
      }, delay);
    }

    async function connectToHost(cols: number, rows: number) {
      if (isConnectingRef.current) {
        return;
      }

      isConnectingRef.current = true;
      connectionAttemptIdRef.current++;
      wasConnectedRef.current = false;

      if (!isReconnectingRef.current) {
        reconnectAttempts.current = 0;
        shouldNotReconnectRef.current = false;
      }

      const isDev =
        !isElectron() &&
        process.env.NODE_ENV === "development" &&
        (window.location.port === "3000" ||
          window.location.port === "5173" ||
          window.location.port === "");

      let baseWsUrl: string;

      if (isDev) {
        baseWsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://localhost:30002`;
      } else if (isElectron()) {
        let configuredUrl = (window as { configuredServerUrl?: string | null })
          .configuredServerUrl;

        if (!configuredUrl && !isEmbeddedMode()) {
          try {
            const serverConfig = await getServerConfig();
            configuredUrl = serverConfig?.serverUrl || null;
            if (configuredUrl) {
              (
                window as Window &
                  typeof globalThis & {
                    configuredServerUrl?: string | null;
                  }
              ).configuredServerUrl = configuredUrl;
            }
          } catch (error) {
            console.error("Failed to resolve Electron server URL:", error);
          }
        }

        if (isEmbeddedMode()) {
          baseWsUrl = "ws://127.0.0.1:30002";
        } else if (!configuredUrl) {
          console.error("No configured server URL available for Electron SSH");
          setIsConnected(false);
          setIsConnecting(false);
          updateConnectionError(t("errors.failedToLoadServer"));
          isConnectingRef.current = false;
          return;
        } else {
          const wsProtocol = configuredUrl.startsWith("https://")
            ? "wss://"
            : "ws://";
          const wsHost = configuredUrl
            .replace(/^https?:\/\//, "")
            .replace(/\/$/, "");
          baseWsUrl = `${wsProtocol}${wsHost}/ssh/websocket/`;
        }
      } else {
        baseWsUrl = `${getBasePath()}/ssh/websocket/`;
      }

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

      const ws = new WebSocket(baseWsUrl);
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

        currentHostIdRef.current = hostConfig.id;
        currentHostConfigRef.current = hostConfig;

        const persistenceEnabled =
          localStorage.getItem("enableTerminalSessionPersistence") === "true";
        const tabId = hostConfig.instanceId
          ? `${hostConfig.id}_${hostConfig.instanceId}`
          : `${hostConfig.id}_${Date.now()}`;
        const savedSessionId = persistenceEnabled
          ? localStorage.getItem(`termix_session_${tabId}`)
          : null;
        if (savedSessionId) {
          sessionIdRef.current = savedSessionId;
          isAttachingSessionRef.current = true;

          ws.send(
            JSON.stringify({
              type: "attachSession",
              data: {
                sessionId: savedSessionId,
                cols,
                rows,
                tabInstanceId: hostConfig.instanceId,
              },
            }),
          );
        } else {
          isAttachingSessionRef.current = false;
          ws.send(
            JSON.stringify({
              type: "connectToHost",
              data: { cols, rows, hostConfig, initialPath, executeCommand },
            }),
          );
        }
        terminal.onData((data) => {
          trackInput(data);
          ws.send(JSON.stringify({ type: "input", data }));
        });

        pongReceivedRef.current = true;
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            if (!pongReceivedRef.current) {
              console.warn(
                "[WebSocket] Pong timeout - connection appears dead, closing",
              );
              ws.close();
              return;
            }
            pongReceivedRef.current = false;
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 30000);
      });

      ws.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "pong") {
            pongReceivedRef.current = true;
            return;
          }
          if (msg.type === "data") {
            if (typeof msg.data === "string") {
              const syntaxHighlightingEnabled =
                localStorage.getItem("terminalSyntaxHighlighting") === "true";

              const outputData = syntaxHighlightingEnabled
                ? highlightTerminalOutput(msg.data)
                : msg.data;

              terminal.write(outputData);
              const sudoPasswordPattern =
                /(?:\[sudo\][^\n]*:\s*$|sudo:[^\n]*password[^\n]*required)/i;
              const hasSudoPw =
                hostConfig.terminalConfig?.sudoPassword ||
                hostConfig.password ||
                hostConfig.hasSudoPassword ||
                hostConfig.hasPassword;
              if (
                config.sudoPasswordAutoFill &&
                sudoPasswordPattern.test(msg.data) &&
                hasSudoPw &&
                !sudoPromptShownRef.current
              ) {
                sudoPromptShownRef.current = true;
                confirmWithToast(
                  t("terminal.sudoPasswordPopupTitle"),
                  async () => {
                    // Fetch password on-demand from server
                    let passwordToFill =
                      hostConfig.terminalConfig?.sudoPassword ||
                      hostConfig.password;
                    if (!passwordToFill && hostConfig.id) {
                      passwordToFill =
                        (await getHostPassword(
                          hostConfig.id,
                          "sudoPassword",
                        )) ||
                        (await getHostPassword(hostConfig.id, "password")) ||
                        undefined;
                    }
                    if (
                      passwordToFill &&
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
            opksshFailedRef.current = false;
            wasConnectedRef.current = true;
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
          } else if (msg.type === "session_ended") {
            wasDisconnectedBySSH.current = true;
            setIsConnected(false);
            setIsConnecting(false);
            shouldNotReconnectRef.current = true;
            if (onClose) {
              onClose();
            }
          } else if (msg.type === "disconnected") {
            wasDisconnectedBySSH.current = true;
            shouldNotReconnectRef.current = true;
            setIsConnected(false);
            setIsConnecting(false);
            if (wasConnectedRef.current) {
              wasConnectedRef.current = false;
              setShowDisconnectedOverlay(false);
              if (onClose && !closeAfterDisconnectRef.current) {
                closeAfterDisconnectRef.current = true;
                isUnmountingRef.current = true;
                window.setTimeout(onClose, 0);
              }
            } else if (!connectionErrorRef.current) {
              updateConnectionError(
                msg.message || t("terminal.connectionRejected"),
              );
            }
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
          } else if (msg.type === "totp_retry") {
            // Existing prompt remains visible while the backend asks for another code.
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
          } else if (msg.type === "opkssh_auth_required") {
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            if (opksshFailedRef.current) {
              setOpksshDialog(null);
              if (opksshTimeoutRef.current) {
                clearTimeout(opksshTimeoutRef.current);
                opksshTimeoutRef.current = null;
              }
              updateConnectionError(t("terminal.opksshAuthFailed"));
              addLog({
                type: "error",
                stage: "auth",
                message: t("terminal.opksshAuthFailed"),
              });
            } else {
              opksshFailedRef.current = true;
              if (webSocketRef.current) {
                webSocketRef.current.send(
                  JSON.stringify({
                    type: "opkssh_start_auth",
                    data: { hostId: msg.hostId },
                  }),
                );
              }
            }
          } else if (msg.type === "opkssh_status") {
            if (connectionErrorRef.current) return;
            if (msg.stage === "chooser") {
              setOpksshDialog({
                isOpen: true,
                authUrl: msg.url || "",
                requestId: msg.requestId || "",
                stage: "chooser",
                providers: msg.providers,
              });
              if (opksshTimeoutRef.current) {
                clearTimeout(opksshTimeoutRef.current);
              }
              opksshTimeoutRef.current = setTimeout(() => {
                setOpksshDialog(null);
                if (webSocketRef.current) {
                  webSocketRef.current.close();
                }
              }, 300000);
            } else {
              setOpksshDialog((prev) =>
                prev ? { ...prev, stage: msg.stage } : null,
              );
            }
          } else if (msg.type === "opkssh_completed") {
            if (opksshTimeoutRef.current) {
              clearTimeout(opksshTimeoutRef.current);
              opksshTimeoutRef.current = null;
            }
            setOpksshDialog(null);
            if (webSocketRef.current && terminal) {
              webSocketRef.current.send(
                JSON.stringify({
                  type: "opkssh_auth_completed",
                  data: {
                    hostId: currentHostIdRef.current,
                    cols: terminal.cols || 80,
                    rows: terminal.rows || 24,
                    hostConfig: currentHostConfigRef.current,
                  },
                }),
              );
            }
          } else if (msg.type === "opkssh_error") {
            if (connectionErrorRef.current) return;
            opksshFailedRef.current = true;
            if (opksshDialog) {
              setOpksshDialog((prev) =>
                prev ? { ...prev, stage: "error", error: msg.error } : null,
              );
            } else {
              setOpksshDialog({
                isOpen: true,
                authUrl: "",
                requestId: msg.requestId || "",
                stage: "error",
                error: msg.error,
              });
            }
            setIsConnecting(false);
          } else if (msg.type === "opkssh_timeout") {
            if (connectionErrorRef.current) return;
            opksshFailedRef.current = true;
            if (opksshDialog) {
              setOpksshDialog((prev) =>
                prev
                  ? {
                      ...prev,
                      stage: "error",
                      error: t("terminal.opksshTimeout"),
                    }
                  : null,
              );
            } else {
              setOpksshDialog({
                isOpen: true,
                authUrl: "",
                requestId: msg.requestId || "",
                stage: "error",
                error: t("terminal.opksshTimeout"),
              });
            }
            setIsConnecting(false);
          } else if (msg.type === "opkssh_config_error") {
            setOpksshDialog({
              isOpen: true,
              authUrl: "",
              requestId: msg.requestId || "",
              stage: "error",
              error: msg.instructions || msg.error,
            });
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
          } else if (msg.type === "cwd") {
            onOpenFileManager?.(msg.path as string);
          } else if (msg.type === "passphrase_required") {
            setShowPassphraseDialog(true);
            setIsConnecting(false);
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
          } else if (msg.type === "host_key_verification_required") {
            setHostKeyVerification({
              isOpen: true,
              scenario: "new",
              data: msg.data,
            });
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
          } else if (msg.type === "host_key_changed") {
            setHostKeyVerification({
              isOpen: true,
              scenario: "changed",
              data: msg.data,
            });
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
          } else if (msg.type === "sessionCreated") {
            sessionIdRef.current = msg.sessionId;
            const persistenceEnabled =
              localStorage.getItem("enableTerminalSessionPersistence") ===
              "true";
            if (persistenceEnabled && hostConfig.instanceId) {
              const tabId = `${hostConfig.id}_${hostConfig.instanceId}`;
              localStorage.setItem(`termix_session_${tabId}`, msg.sessionId);
            }
          } else if (msg.type === "sessionAttached") {
            isAttachingSessionRef.current = false;
            opksshFailedRef.current = false;
            wasConnectedRef.current = true;
            setIsConnected(true);
            setIsConnecting(false);
            isConnectingRef.current = false;
            shouldNotReconnectRef.current = false;
            updateConnectionError(null);
            if (connectionTimeoutRef.current) {
              clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current);
              reconnectTimeoutRef.current = null;
            }
            reconnectAttempts.current = 0;
            isReconnectingRef.current = false;

            logTerminalActivity();

            addLog({
              type: "success",
              stage: "connection",
              message: t("terminal.reconnected"),
            });
          } else if (msg.type === "sessionExpired") {
            isAttachingSessionRef.current = false;
            shouldNotReconnectRef.current = false;
            if (hostConfig.instanceId) {
              const tabId = `${hostConfig.id}_${hostConfig.instanceId}`;
              localStorage.removeItem(`termix_session_${tabId}`);
            }
            sessionIdRef.current = null;

            if (webSocketRef.current) {
              webSocketRef.current.close();
            }
          } else if (msg.type === "sessionTakenOver") {
            if (sessionIdRef.current && hostConfig.instanceId) {
              const tabId = `${hostConfig.id}_${hostConfig.instanceId}`;
              localStorage.removeItem(`termix_session_${tabId}`);
              sessionIdRef.current = null;
            }

            if (terminal) {
              terminal.clear();
            }
            setIsConnected(false);
            setIsConnecting(true);

            addLog({
              type: "warning",
              stage: "connection",
              message: t("terminal.sessionTakenOver"),
            });

            const cols = terminal?.cols || 80;
            const rows = terminal?.rows || 24;
            connectToHost(cols, rows);
          } else if (msg.type === "tmux_sessions_available") {
            setTmuxSessionPicker({
              sessions: msg.sessions,
            });
          } else if (
            msg.type === "tmux_session_created" ||
            msg.type === "tmux_session_attached"
          ) {
            const sessionName =
              typeof msg.sessionName === "string" ? msg.sessionName : "";
            tmuxSessionNameRef.current = sessionName || "(active)";
            addLog({
              type: "info",
              stage: "connection",
              message:
                msg.type === "tmux_session_created"
                  ? t("terminal.tmuxSessionCreated", {
                      name: sessionName || "new",
                    })
                  : t("terminal.tmuxSessionAttached", {
                      name: sessionName,
                    }),
            });
          } else if (msg.type === "tmux_unavailable") {
            setTimeout(() => {
              toast.warning(t("terminal.tmuxUnavailable"), {
                duration: 8000,
              });
            }, 500);
            addLog({
              type: "warning",
              stage: "connection",
              message: t("terminal.tmuxUnavailable"),
            });
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
          console.error("WebSocket message handler error:", error);
        }
      });

      const currentAttemptId = connectionAttemptIdRef.current;

      ws.addEventListener("close", (event) => {
        if (currentAttemptId !== connectionAttemptIdRef.current) {
          return;
        }

        setIsConnected(false);
        isConnectingRef.current = false;

        if (pongTimeoutRef.current) {
          clearTimeout(pongTimeoutRef.current);
          pongTimeoutRef.current = null;
        }

        if (totpTimeoutRef.current) {
          clearTimeout(totpTimeoutRef.current);
          totpTimeoutRef.current = null;
        }

        if (event.code === 1006) {
          console.warn(
            "[WebSocket] Abnormal closure detected - attempting reconnection",
          );
          addLog({
            type: "warning",
            stage: "connection",
            message: t("terminal.websocketAbnormalClose"),
          });

          if (wasConnectedRef.current) {
            attemptReconnection();
          } else {
            updateConnectionError(t("terminal.websocketAbnormalClose"));
            setIsConnecting(false);
          }
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

          return;
        }

        if (
          !wasConnectedRef.current &&
          !isAttachingSessionRef.current &&
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

    async function writeTextToClipboard(text: string): Promise<boolean> {
      try {
        if (window.electronClipboard) {
          await window.electronClipboard.writeText(text);
          return true;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch {
        // fall through to legacy method
      }
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        return true;
      } catch {
        toast.error(t("terminal.clipboardWriteFailed"));
        return false;
      }
    }

    async function readTextFromClipboard(): Promise<string> {
      try {
        if (window.electronClipboard) {
          return window.electronClipboard.readText();
        }
        if (navigator.clipboard && navigator.clipboard.readText) {
          return await navigator.clipboard.readText();
        }
      } catch {
        // fall through
      }
      if (window.location.protocol !== "https:" && !isElectron()) {
        toast.error(t("terminal.clipboardHttpWarning"));
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

    // Separate theme and options updates to avoid terminal re-initialization flashes
    useEffect(() => {
      if (!terminal) return;

      const config = {
        ...DEFAULT_TERMINAL_CONFIG,
        ...hostConfig.terminalConfig,
      };

      let themeColors;
      const activeTheme = previewTheme || config.theme;

      if (activeTheme === "termix") {
        themeColors = isDarkMode
          ? TERMINAL_THEMES.termixDark.colors
          : TERMINAL_THEMES.termixLight.colors;
      } else {
        themeColors =
          TERMINAL_THEMES[activeTheme]?.colors ||
          TERMINAL_THEMES.termixDark.colors;
      }

      const fontConfig = TERMINAL_FONTS.find(
        (f) => f.value === config.fontFamily,
      );
      const fontFamily = fontConfig?.fallback || TERMINAL_FONTS[0].fallback;

      // Update terminal options individually to avoid re-initialization flashes
      terminal.options.cursorBlink = config.cursorBlink;
      terminal.options.cursorStyle = config.cursorStyle;
      terminal.options.scrollback = config.scrollback;
      terminal.options.fontSize = config.fontSize;
      terminal.options.fontFamily = fontFamily;
      terminal.options.rightClickSelectsWord = config.rightClickSelectsWord;
      terminal.options.fastScrollModifier = config.fastScrollModifier;
      terminal.options.fastScrollSensitivity = config.fastScrollSensitivity;
      terminal.options.minimumContrastRatio = config.minimumContrastRatio;
      terminal.options.letterSpacing = config.letterSpacing;
      terminal.options.lineHeight = config.lineHeight;
      terminal.options.bellStyle = config.bellStyle as
        | "none"
        | "sound"
        | "visual"
        | "both";

      terminal.options.theme = {
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
      };

      // Ensure terminal is correctly fitted if font-related options change
      if (fitAddonRef.current && isFitted) {
        performFit();
      }

      // Refresh terminal to apply new theme colors to existing buffer content
      hardRefresh();
    }, [
      terminal,
      hostConfig.terminalConfig,
      previewTheme,
      isDarkMode,
      isFitted,
    ]);

    useEffect(() => {
      if (!terminal || !xtermRef.current) return;

      const config = {
        ...DEFAULT_TERMINAL_CONFIG,
        ...hostConfig.terminalConfig,
      };

      const fontConfig = TERMINAL_FONTS.find(
        (f) => f.value === config.fontFamily,
      );
      const fontFamily = fontConfig?.fallback || TERMINAL_FONTS[0].fallback;

      let themeColors;
      const activeTheme = previewTheme || config.theme;

      if (activeTheme === "termix") {
        themeColors = isDarkMode
          ? TERMINAL_THEMES.termixDark.colors
          : TERMINAL_THEMES.termixLight.colors;
      } else {
        themeColors =
          TERMINAL_THEMES[activeTheme]?.colors ||
          TERMINAL_THEMES.termixDark.colors;
      }

      // Set initial options before opening the terminal
      terminal.options = {
        cursorBlink: config.cursorBlink,
        cursorStyle: config.cursorStyle,
        scrollback: config.scrollback,
        fontSize: config.fontSize,
        fontFamily,
        allowTransparency: true, // MUST be set before open()
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
      const handleContextMenu = (e: MouseEvent) => {
        if (e.ctrlKey && onOpenFileManager) {
          e.preventDefault();
          e.stopPropagation();
          onOpenFileManager();
          return;
        }

        if (isElectron() && getUseRightClickCopyPaste()) {
          e.preventDefault();
          e.stopPropagation();
          if (terminal.hasSelection()) {
            const text = terminal.getSelection();
            writeTextToClipboard(text).then(() => terminal.clearSelection());
          } else {
            readTextFromClipboard().then((text) => {
              if (text) terminal.paste(text);
            });
          }
          return;
        }
      };
      element?.addEventListener("contextmenu", handleContextMenu);

      const handlePaste = (e: ClipboardEvent) => {
        const text = e.clipboardData?.getData("text");
        if (text) {
          e.preventDefault();
          e.stopPropagation();
          terminal.paste(text);
        }
      };
      element?.addEventListener("paste", handlePaste);

      let tmuxDragTracking = false;
      const handleTmuxDragStart = (e: MouseEvent) => {
        if (e.button !== 0) return;
        if (!tmuxSessionNameRef.current) return;
        tmuxDragTracking = true;
      };
      const handleTmuxDragMove = () => {
        if (!tmuxDragTracking) return;
        tmuxDragTracking = false;
        if (tmuxCopyModeHintShownRef.current) return;
        tmuxCopyModeHintShownRef.current = true;
        toast.info(t("terminal.tmuxCopyHint"), { duration: 5000 });
      };
      const handleTmuxDragEnd = () => {
        tmuxDragTracking = false;
      };
      element?.addEventListener("mousedown", handleTmuxDragStart);
      element?.addEventListener("mousemove", handleTmuxDragMove);
      element?.addEventListener("mouseup", handleTmuxDragEnd);

      const handleBackspaceMode = (e: KeyboardEvent) => {
        if (e.key !== "Backspace") return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        const config = {
          ...DEFAULT_TERMINAL_CONFIG,
          ...hostConfig.terminalConfig,
        };
        if (config.backspaceMode !== "control-h") return;

        e.preventDefault();
        e.stopPropagation();

        if (webSocketRef.current?.readyState === 1) {
          webSocketRef.current.send(
            JSON.stringify({ type: "input", data: "\x08" }),
          );
        }
        return false;
      };

      element?.addEventListener("keydown", handleBackspaceMode, true);

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
        isFittingRef.current = false;
        resizeObserver.disconnect();
        clipboardProvider.dispose();
        element?.removeEventListener("contextmenu", handleContextMenu);
        element?.removeEventListener("paste", handlePaste);
        element?.removeEventListener("mousedown", handleTmuxDragStart);
        element?.removeEventListener("mousemove", handleTmuxDragMove);
        element?.removeEventListener("mouseup", handleTmuxDragEnd);
        element?.removeEventListener("keydown", handleBackspaceMode, true);
        if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
        if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
      };
    }, [xtermRef, terminal]);

    const isMountedRef = useRef(false);

    useEffect(() => {
      isMountedRef.current = true;

      const currentHostId = hostConfig.id;
      const currentInstanceId = hostConfig.instanceId;

      return () => {
        if (!isMountedRef.current) {
          return;
        }

        if (
          currentHostIdRef.current !== currentHostId &&
          currentHostIdRef.current !== null
        ) {
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
          if (pongTimeoutRef.current) {
            clearTimeout(pongTimeoutRef.current);
            pongTimeoutRef.current = null;
          }

          const persistenceEnabled =
            localStorage.getItem("enableTerminalSessionPersistence") === "true";
          if (
            !persistenceEnabled &&
            sessionIdRef.current &&
            currentInstanceId
          ) {
            const tabId = `${currentHostId}_${currentInstanceId}`;
            localStorage.removeItem(`termix_session_${tabId}`);
          }

          if (webSocketRef.current) {
            webSocketRef.current.close();
          }

          isMountedRef.current = false;
        }
      };
    }, [hostConfig.id, hostConfig.instanceId]);

    useEffect(() => {
      if (!terminal) return;

      const handleCustomKey = (e: KeyboardEvent): boolean => {
        if (e.type !== "keydown") {
          return true;
        }

        if (
          e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          e.key.toLowerCase() === "c" &&
          terminal.hasSelection()
        ) {
          const selection = terminal.getSelection();
          if (selection) {
            e.preventDefault();
            e.stopPropagation();
            writeTextToClipboard(selection);
            terminal.clearSelection();
            return false;
          }
        }

        if (
          ((e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey) ||
            (e.ctrlKey &&
              !e.shiftKey &&
              !e.altKey &&
              !e.metaKey &&
              e.key === "Insert")) &&
          (e.key.toLowerCase() === "c" || e.key === "Insert")
        ) {
          const selection = terminal.getSelection();
          if (selection) {
            e.preventDefault();
            e.stopPropagation();
            writeTextToClipboard(selection);
            return false;
          }
        }

        if (
          e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          !e.metaKey &&
          e.key.toLowerCase() === "v"
        ) {
          // Let the browser handle Ctrl+V natively, the paste event
          // listener will intercept the result without triggering the
          // clipboard permission popup
          return false;
        }

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
          e.shiftKey &&
          !e.ctrlKey &&
          !e.altKey &&
          !e.metaKey
        ) {
          e.preventDefault();
          e.stopPropagation();
          if (webSocketRef.current?.readyState === 1) {
            webSocketRef.current.send(
              JSON.stringify({ type: "input", data: "\x1b[Z" }),
            );
          }
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

      if (isReconnectingRef.current || reconnectTimeoutRef.current !== null) {
        return;
      }

      if (shouldNotReconnectRef.current) {
        return;
      }

      if (
        webSocketRef.current &&
        (webSocketRef.current.readyState === WebSocket.OPEN ||
          webSocketRef.current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

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
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        if (terminal.cols > 0 && terminal.rows > 0) {
          scheduleNotify(terminal.cols, terminal.rows);
          connectToHost(terminal.cols, terminal.rows);
        }
      });
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

    const hasConnectionError = !!connectionError;

    return (
      <div className="h-full w-full relative" style={{ backgroundColor }}>
        <div
          ref={xtermRef}
          className="h-full w-full"
          style={{
            pointerEvents: isVisible ? "auto" : "none",
            visibility:
              isConnected && isFitted && !connectionError
                ? "visible"
                : "hidden",
          }}
          onClick={() => {
            if (terminal && !splitScreen) {
              terminal.focus();
            }
          }}
        />

        <SimpleLoader
          visible={isConnecting && !isConnectionLogExpanded}
          message={t("terminal.connecting")}
          backgroundColor={backgroundColor}
        />

        {showDisconnectedOverlay && !isConnecting && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10"
            style={{ backgroundColor }}
          >
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setShowDisconnectedOverlay(false);
                  isUnmountingRef.current = false;
                  shouldNotReconnectRef.current = false;
                  isReconnectingRef.current = false;
                  isConnectingRef.current = false;
                  reconnectAttempts.current = 0;
                  wasDisconnectedBySSH.current = false;
                  wasConnectedRef.current = false;
                  updateConnectionError(null);
                  if (terminal) {
                    terminal.clear();
                    connectToHost(terminal.cols, terminal.rows);
                  }
                }}
              >
                {t("terminal.reconnect")}
              </Button>
              {onClose && (
                <Button variant="secondary" onClick={onClose}>
                  {t("terminal.closeTab")}
                </Button>
              )}
            </div>
          </div>
        )}

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

        <PassphraseDialog
          isOpen={showPassphraseDialog}
          onSubmit={handlePassphraseSubmit}
          onCancel={handlePassphraseCancel}
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

        {opksshDialog?.isOpen && (
          <OPKSSHDialog
            isOpen={opksshDialog.isOpen}
            authUrl={opksshDialog.authUrl}
            requestId={opksshDialog.requestId}
            stage={opksshDialog.stage}
            error={opksshDialog.error}
            providers={opksshDialog.providers}
            onCancel={() => {
              if (webSocketRef.current) {
                webSocketRef.current.send(
                  JSON.stringify({
                    type: "opkssh_cancel",
                    data: { requestId: opksshDialog.requestId },
                  }),
                );
              }
              setOpksshDialog(null);
              if (opksshTimeoutRef.current) {
                clearTimeout(opksshTimeoutRef.current);
                opksshTimeoutRef.current = null;
              }
            }}
            onOpenUrl={() => {
              window.open(opksshDialog.authUrl, "_blank");
              if (webSocketRef.current) {
                webSocketRef.current.send(
                  JSON.stringify({
                    type: "opkssh_browser_opened",
                    data: { requestId: opksshDialog.requestId },
                  }),
                );
              }
            }}
            onSelectProvider={(alias) => {
              if (!opksshDialog.authUrl) return;
              const selectUrl = `${opksshDialog.authUrl}/select?op=${encodeURIComponent(alias)}`;
              window.open(selectUrl, "_blank");
              if (webSocketRef.current) {
                webSocketRef.current.send(
                  JSON.stringify({
                    type: "opkssh_browser_opened",
                    data: { requestId: opksshDialog.requestId },
                  }),
                );
              }
              setOpksshDialog((prev) =>
                prev ? { ...prev, stage: "waiting" } : null,
              );
            }}
            backgroundColor={backgroundColor}
          />
        )}

        {hostKeyVerification?.isOpen && (
          <HostKeyVerificationDialog
            isOpen={true}
            scenario={hostKeyVerification.scenario}
            {...hostKeyVerification.data}
            onAccept={() => {
              if (webSocketRef.current) {
                webSocketRef.current.send(
                  JSON.stringify({
                    type: "host_key_verification_response",
                    data: { action: "accept" },
                  }),
                );
              }
              setHostKeyVerification(null);
            }}
            onReject={() => {
              if (webSocketRef.current) {
                webSocketRef.current.send(
                  JSON.stringify({
                    type: "host_key_verification_response",
                    data: { action: "reject" },
                  }),
                );
              }
              setHostKeyVerification(null);
              setIsConnecting(false);
              updateConnectionError(t("terminal.hostKeyRejected"));
            }}
            backgroundColor={backgroundColor}
          />
        )}

        {tmuxSessionPicker && (
          <TmuxSessionPicker
            isOpen={true}
            sessions={tmuxSessionPicker.sessions}
            onSelect={(sessionName) => {
              setTmuxSessionPicker(null);
              if (webSocketRef.current?.readyState === WebSocket.OPEN) {
                webSocketRef.current.send(
                  JSON.stringify({
                    type: "tmux_attach",
                    data: { sessionName },
                  }),
                );
              }
            }}
            onCreateNew={() => {
              setTmuxSessionPicker(null);
              if (webSocketRef.current?.readyState === WebSocket.OPEN) {
                webSocketRef.current.send(
                  JSON.stringify({
                    type: "tmux_attach",
                    data: { sessionName: "" },
                  }),
                );
              }
            }}
            onCancel={() => setTmuxSessionPicker(null)}
            backgroundColor={backgroundColor}
          />
        )}

        <CommandAutocomplete
          visible={showAutocomplete}
          suggestions={autocompleteSuggestions}
          selectedIndex={autocompleteSelectedIndex}
          position={autocompletePosition}
          onSelect={handleAutocompleteSelect}
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
  font-feature-settings: "liga" 0, "calt" 0;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.xterm .xterm-screen {
  font-family: 'Caskaydia Cove Nerd Font Mono', 'SF Mono', Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace !important;
  font-variant-ligatures: none;
}

.xterm .xterm-screen .xterm-char {
  font-feature-settings: "liga" 0, "calt" 0;
}
`;
document.head.appendChild(style);
