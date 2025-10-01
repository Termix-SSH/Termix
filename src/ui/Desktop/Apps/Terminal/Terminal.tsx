import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import { useXTerm } from "react-xtermjs";
import { FitAddon } from "@xterm/addon-fit";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getCookie, isElectron } from "@/ui/main-axios.ts";

interface SSHTerminalProps {
  hostConfig: any;
  isVisible: boolean;
  title?: string;
  showTitle?: boolean;
  splitScreen?: boolean;
  onClose?: () => void;
  initialPath?: string;
  executeCommand?: string;
}

export const Terminal = forwardRef<any, SSHTerminalProps>(function SSHTerminal(
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
  if (typeof window !== "undefined" && !(window as any).testJWT) {
    (window as any).testJWT = () => {
      const jwt = getCookie("jwt");
      return jwt;
    };
  }

  const { t } = useTranslation();
  const { instance: terminal, ref: xtermRef } = useXTerm();
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webSocketRef = useRef<WebSocket | null>(null);
  const resizeTimeout = useRef<NodeJS.Timeout | null>(null);
  const wasDisconnectedBySSH = useRef(false);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [visible, setVisible] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const isVisibleRef = useRef<boolean>(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 3;
  const isUnmountingRef = useRef(false);
  const shouldNotReconnectRef = useRef(false);
  const isReconnectingRef = useRef(false);
  const isConnectingRef = useRef(false);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const pendingSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const notifyTimerRef = useRef<NodeJS.Timeout | null>(null);
  const DEBOUNCE_MS = 140;

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
      if (terminal && typeof (terminal as any).refresh === "function") {
        (terminal as any).refresh(0, terminal.rows - 1);
      }
    } catch (_) {}
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
        } catch (_) {}
      },
      refresh: () => hardRefresh(),
    }),
    [terminal],
  );

  function handleWindowResize() {
    if (!isVisibleRef.current) return;
    fitAddonRef.current?.fit();
    if (terminal) scheduleNotify(terminal.cols, terminal.rows);
    hardRefresh();
  }

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
              (window as any).configuredServerUrl || "http://127.0.0.1:30001";
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

  function setupWebSocketListeners(ws: WebSocket, cols: number, rows: number) {
    ws.addEventListener("open", () => {
      connectionTimeoutRef.current = setTimeout(() => {
        if (!isConnected) {
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
          terminal.write(msg.data);
        } else if (msg.type === "error") {
          const errorMessage = msg.message || t("terminal.unknownError");

          if (
            errorMessage.toLowerCase().includes("auth") ||
            errorMessage.toLowerCase().includes("password") ||
            errorMessage.toLowerCase().includes("permission") ||
            errorMessage.toLowerCase().includes("denied") ||
            errorMessage.toLowerCase().includes("invalid") ||
            errorMessage.toLowerCase().includes("failed") ||
            errorMessage.toLowerCase().includes("incorrect")
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
        }
      } catch (error) {
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

        toast.error("Authentication failed. Please log in again.");

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

    ws.addEventListener("error", (event) => {
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
    } catch (_) {}
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
    } catch (_) {}
    return "";
  }

  useEffect(() => {
    if (!terminal || !xtermRef.current) return;

    terminal.options = {
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 10000,
      fontSize: 14,
      fontFamily:
        '"JetBrains Mono Nerd Font", "MesloLGS NF", "FiraCode Nerd Font", "Cascadia Code", "JetBrains Mono", "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: { background: "#18181b", foreground: "#f7f7f7" },
      allowTransparency: true,
      convertEol: true,
      windowsMode: false,
      macOptionIsMeta: false,
      macOptionClickForcesSelection: false,
      rightClickSelectsWord: false,
      fastScrollModifier: "alt",
      fastScrollSensitivity: 5,
      allowProposedApi: true,
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
      } catch (_) {}
    };
    element?.addEventListener("contextmenu", handleContextMenu);

    const handleMacKeyboard = (e: KeyboardEvent) => {
      const isMacOS =
        navigator.platform.toUpperCase().indexOf("MAC") >= 0 ||
        navigator.userAgent.toUpperCase().indexOf("MAC") >= 0;

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
        if (!isVisibleRef.current) return;
        fitAddonRef.current?.fit();
        if (terminal) scheduleNotify(terminal.cols, terminal.rows);
        hardRefresh();
      }, 150);
    });

    resizeObserver.observe(xtermRef.current);

    setVisible(true);

    return () => {
      isUnmountingRef.current = true;
      shouldNotReconnectRef.current = true;
      isReconnectingRef.current = false;
      setIsConnecting(false);
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
  }, [xtermRef, terminal]);

  useEffect(() => {
    if (!terminal || !hostConfig || !visible) return;

    if (isConnected || isConnecting) return;

    setIsConnecting(true);

    const readyFonts =
      (document as any).fonts?.ready instanceof Promise
        ? (document as any).fonts.ready
        : Promise.resolve();

    readyFonts.then(() => {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        if (terminal) scheduleNotify(terminal.cols, terminal.rows);
        hardRefresh();

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
      }, 200);
    });
  }, [terminal, hostConfig, visible, isConnected, isConnecting, splitScreen]);

  useEffect(() => {
    if (isVisible && fitAddonRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        if (terminal) scheduleNotify(terminal.cols, terminal.rows);
        hardRefresh();
        if (terminal && !splitScreen) {
          terminal.focus();
        }
      }, 0);

      if (terminal && !splitScreen) {
        setTimeout(() => {
          terminal.focus();
        }, 100);
      }
    }
  }, [isVisible, splitScreen, terminal]);

  useEffect(() => {
    if (!fitAddonRef.current) return;
    setTimeout(() => {
      fitAddonRef.current?.fit();
      if (terminal) scheduleNotify(terminal.cols, terminal.rows);
      hardRefresh();
      if (terminal && !splitScreen && isVisible) {
        terminal.focus();
      }
    }, 0);
  }, [splitScreen, isVisible, terminal]);

  return (
    <div className="h-full w-full relative">
      <div
        ref={xtermRef}
        className={`h-full w-full transition-opacity duration-200 ${visible && isVisible && !isConnecting ? "opacity-100" : "opacity-0"}`}
        onClick={() => {
          if (terminal && !splitScreen) {
            terminal.focus();
          }
        }}
      />

      {isConnecting && (
        <div className="absolute inset-0 flex items-center justify-center bg-dark-bg">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-gray-300">{t("terminal.connecting")}</span>
          </div>
        </div>
      )}
    </div>
  );
});

const style = document.createElement("style");
style.innerHTML = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap');

/* Load NerdFonts locally with fallback handling */
@font-face {
  font-family: 'JetBrains Mono Nerd Font';
  src: url('./fonts/JetBrainsMonoNerdFont-Regular.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'JetBrains Mono Nerd Font';
  src: url('./fonts/JetBrainsMonoNerdFont-Bold.ttf') format('truetype');
  font-weight: bold;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'JetBrains Mono Nerd Font';
  src: url('./fonts/JetBrainsMonoNerdFont-Italic.ttf') format('truetype');
  font-weight: normal;
  font-style: italic;
  font-display: swap;
}

/* Fallback fonts for when custom fonts fail to load */
@font-face {
  font-family: 'Terminal Fallback';
  src: local('SF Mono'), local('Monaco'), local('Consolas'), local('Liberation Mono'), local('Courier New');
  font-weight: normal;
  font-style: normal;
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
  font-family: 'JetBrains Mono Nerd Font', 'MesloLGS NF', 'FiraCode Nerd Font', 'Cascadia Code', 'JetBrains Mono', 'SF Mono', Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace !important;
  font-variant-ligatures: contextual;
}

.xterm .xterm-screen .xterm-char {
  font-feature-settings: "liga" 1, "calt" 1;
}

.xterm .xterm-screen .xterm-char[data-char-code^="\\uE"] {
  font-family: 'JetBrains Mono Nerd Font', 'MesloLGS NF', 'FiraCode Nerd Font' !important;
}
`;
document.head.appendChild(style);
