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

export const Terminal = forwardRef<TerminalHandle, SSHTerminalProps>(
  function SSHTerminal({ hostConfig, isVisible }, ref) {
    const { t } = useTranslation();
    const { instance: terminal, ref: xtermRef } = useXTerm();
    const fitAddonRef = useRef<FitAddon | null>(null);
    const webSocketRef = useRef<WebSocket | null>(null);
    const resizeTimeout = useRef<NodeJS.Timeout | null>(null);
    const wasDisconnectedBySSH = useRef(false);
    const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const [visible, setVisible] = useState(false);
    const [, setIsConnected] = useState(false);
    const [, setIsConnecting] = useState(false);
    const [, setConnectionError] = useState<string | null>(null);
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
      } catch {
        // Ignore terminal refresh errors
      }
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
          } catch {
            // Ignore resize notification errors
          }
        },
        refresh: () => hardRefresh(),
      }),
      [terminal],
    );

    function setupWebSocketListeners(
      ws: WebSocket,
      cols: number,
      rows: number,
    ) {
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
          if (msg.type === "data") {
            if (typeof msg.data === "string") {
              terminal.write(msg.data);
            } else {
              terminal.write(String(msg.data));
            }
          } else if (msg.type === "error")
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
        } catch {
          // Ignore message parsing errors
        }
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
          '"Caskaydia Cove Nerd Font Mono", "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
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
        minimumContrastRatio: 1,
        letterSpacing: 0,
        lineHeight: 1.2,
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
        (document as { fonts?: { ready?: Promise<unknown> } }).fonts
          ?.ready instanceof Promise
          ? (document as { fonts?: { ready?: Promise<unknown> } }).fonts.ready
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
                    (window as { configuredServerUrl?: string })
                      .configuredServerUrl || "http://127.0.0.1:30001";
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
