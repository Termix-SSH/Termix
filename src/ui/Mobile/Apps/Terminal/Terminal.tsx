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
import { isElectron, getCookie } from "@/ui/main-axios.ts";
import { toast } from "sonner";

interface SSHTerminalProps {
  hostConfig: any;
  isVisible: boolean;
  title?: string;
}

export const Terminal = forwardRef<any, SSHTerminalProps>(function SSHTerminal(
  { hostConfig, isVisible },
  ref,
) {
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
  const isConnectingRef = useRef(false);

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
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
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

  function setupWebSocketListeners(ws: WebSocket, cols: number, rows: number) {
    ws.addEventListener("open", () => {
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
        if (msg.type === "data") terminal.write(msg.data);
        else if (msg.type === "error")
          terminal.writeln(`\r\n[${t("terminal.error")}] ${msg.message}`);
        else if (msg.type === "connected") {
          isConnectingRef.current = false;
        } else if (msg.type === "disconnected") {
          wasDisconnectedBySSH.current = true;
          isConnectingRef.current = false;
          terminal.writeln(
            `\r\n[${msg.message || t("terminal.disconnected")}]`,
          );
        }
      } catch (error) {}
    });

    ws.addEventListener("close", (event) => {
      isConnectingRef.current = false;

      if (event.code === 1008) {
        console.error("WebSocket authentication failed:", event.reason);
        terminal.writeln(`\r\n[Authentication failed - please re-login]`);

        localStorage.removeItem("jwt");
        return;
      }

      if (!wasDisconnectedBySSH.current) {
        terminal.writeln(`\r\n[${t("terminal.connectionClosed")}]`);
      }
    });

    ws.addEventListener("error", () => {
      isConnectingRef.current = false;
      terminal.writeln(`\r\n[${t("terminal.connectionError")}]`);
    });
  }

  useEffect(() => {
    if (!terminal || !xtermRef.current || !hostConfig) return;

    if (!isAuthenticated) {
      return;
    }

    terminal.options = {
      cursorBlink: false,
      cursorStyle: "bar",
      scrollback: 10000,
      fontSize: 14,
      fontFamily:
        '"JetBrains Mono Nerd Font", "MesloLGS NF", "FiraCode Nerd Font", "Cascadia Code", "JetBrains Mono", "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: { background: "#09090b", foreground: "#f7f7f7" },
      allowTransparency: true,
      convertEol: true,
      windowsMode: false,
      macOptionIsMeta: false,
      macOptionClickForcesSelection: false,
      rightClickSelectsWord: false,
      fastScrollModifier: "alt",
      fastScrollSensitivity: 5,
      allowProposedApi: true,
      disableStdin: true,
      cursorInactiveStyle: "bar",
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

    const textarea = xtermRef.current.querySelector(
      ".xterm-helper-textarea",
    ) as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.readOnly = true;
      textarea.blur();
    }

    terminal.focus = () => {};

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

    const readyFonts =
      (document as any).fonts?.ready instanceof Promise
        ? (document as any).fonts.ready
        : Promise.resolve();
    setVisible(true);

    readyFonts.then(() => {
      setTimeout(() => {
        fitAddon.fit();
        if (terminal) scheduleNotify(terminal.cols, terminal.rows);
        hardRefresh();

        const jwtToken = getCookie("jwt");
        if (!jwtToken || jwtToken.trim() === "") {
          setIsConnected(false);
          setIsConnecting(false);
          setConnectionError("Authentication required");
          return;
        }

        const cols = terminal.cols;
        const rows = terminal.rows;

        const isDev =
          process.env.NODE_ENV === "development" &&
          (window.location.port === "3000" ||
            window.location.port === "5173" ||
            window.location.port === "");

        const baseWsUrl = isDev
          ? `${window.location.protocol === "https:" ? "wss" : "ws"}://localhost:30002`
          : isElectron()
            ? (() => {
                const baseUrl =
                  (window as any).configuredServerUrl ||
                  "http://127.0.0.1:30001";
                const wsProtocol = baseUrl.startsWith("https://")
                  ? "wss://"
                  : "ws://";
                const wsHost = baseUrl.replace(/^https?:\/\//, "");
                return `${wsProtocol}${wsHost}/ssh/websocket/`;
              })()
            : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ssh/websocket/`;

        if (isConnectingRef.current) {
          return;
        }

        isConnectingRef.current = true;

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

        const wsUrl = `${baseWsUrl}?token=${encodeURIComponent(jwtToken)}`;

        setIsConnecting(true);
        setConnectionError(null);

        const ws = new WebSocket(wsUrl);
        webSocketRef.current = ws;
        wasDisconnectedBySSH.current = false;

        setupWebSocketListeners(ws, cols, rows);
      }, 200);
    });

    return () => {
      resizeObserver.disconnect();
      if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
      if (resizeTimeout.current) clearTimeout(resizeTimeout.current);
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      webSocketRef.current?.close();
    };
  }, [xtermRef, terminal, hostConfig]);

  useEffect(() => {
    if (isVisible && fitAddonRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        if (terminal) scheduleNotify(terminal.cols, terminal.rows);
        hardRefresh();
      }, 0);
    }
  }, [isVisible, terminal]);

  useEffect(() => {
    if (!fitAddonRef.current) return;
    setTimeout(() => {
      fitAddonRef.current?.fit();
      if (terminal) scheduleNotify(terminal.cols, terminal.rows);
      hardRefresh();
    }, 0);
  }, [isVisible, terminal]);

  return (
    <div
      ref={xtermRef}
      className={`h-full w-full m-1 transition-opacity duration-200 ${visible && isVisible ? "opacity-100" : "opacity-0"} overflow-hidden`}
    />
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

.xterm .xterm-screen .xterm-char[data-char-code^="\uE000"] {
  font-family: 'JetBrains Mono Nerd Font', 'MesloLGS NF', 'FiraCode Nerd Font' !important;
}
`;
document.head.appendChild(style);
