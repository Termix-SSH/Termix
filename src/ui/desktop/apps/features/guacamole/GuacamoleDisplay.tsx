import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";
import Guacamole from "guacamole-common-js";
import { useTranslation } from "react-i18next";
import { getCookie, isElectron, isEmbeddedMode } from "@/ui/main-axios.ts";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";

export type GuacamoleConnectionType = "rdp" | "vnc" | "telnet";

export interface GuacamoleConnectionConfig {
  token?: string;
  protocol?: GuacamoleConnectionType;
  type?: GuacamoleConnectionType;
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  width?: number;
  height?: number;
  dpi?: number;
  [key: string]: unknown;
}

export interface GuacamoleDisplayHandle {
  disconnect: () => void;
  sendKey: (keysym: number, pressed: boolean) => void;
  sendMouse: (x: number, y: number, buttonMask: number) => void;
  setClipboard: (data: string) => void;
}

interface GuacamoleDisplayProps {
  connectionConfig: GuacamoleConnectionConfig;
  isVisible: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
}

const isDev = import.meta.env.DEV;

export const GuacamoleDisplay = forwardRef<
  GuacamoleDisplayHandle,
  GuacamoleDisplayProps
>(function GuacamoleDisplay(
  { connectionConfig, isVisible, onConnect, onDisconnect, onError },
  ref,
) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<Guacamole.Client | null>(null);
  const keyboardRef = useRef<Guacamole.Keyboard | null>(null);
  const scaleRef = useRef<number>(1);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useImperativeHandle(ref, () => ({
    disconnect: () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
    },
    sendKey: (keysym: number, pressed: boolean) => {
      if (clientRef.current) {
        clientRef.current.sendKeyEvent(pressed ? 1 : 0, keysym);
      }
    },
    sendMouse: (x: number, y: number, buttonMask: number) => {
      if (clientRef.current) {
        clientRef.current.sendMouseState(
          new Guacamole.Mouse.State({
            x,
            y,
            left: !!(buttonMask & 1),
            middle: !!(buttonMask & 2),
            right: !!(buttonMask & 4),
          }),
        );
      }
    },
    setClipboard: (data: string) => {
      if (clientRef.current) {
        const stream = clientRef.current.createClipboardStream("text/plain");
        const writer = new Guacamole.StringWriter(stream);
        writer.sendText(data);
        writer.sendEnd();
      }
    },
  }));

  const getWebSocketUrl = useCallback(
    async (
      containerWidth: number,
      containerHeight: number,
    ): Promise<string | null> => {
      try {
        let token: string;

        if (connectionConfig.token) {
          token = connectionConfig.token;
        } else {
          const jwtToken = getCookie("jwt");
          if (!jwtToken) {
            onError?.("Authentication required");
            return null;
          }

          const baseUrl = isDev
            ? "http://localhost:30001"
            : isElectron()
              ? (window as { configuredServerUrl?: string })
                  .configuredServerUrl || "http://127.0.0.1:30001"
              : `${window.location.origin}`;

          const response = await fetch(`${baseUrl}/guacamole/token`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${jwtToken}`,
            },
            body: JSON.stringify(connectionConfig),
            credentials: "include",
          });

          if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Failed to get connection token");
          }

          const data = await response.json();
          token = data.token;
        }

        const width = connectionConfig.width || containerWidth || 1280;
        const height = connectionConfig.height || containerHeight || 720;
        const dpi = connectionConfig.dpi || 96;

        const wsBase = isDev
          ? `ws://localhost:30008`
          : isElectron()
            ? (() => {
                const configuredUrl = (
                  window as { configuredServerUrl?: string }
                ).configuredServerUrl;

                // Embedded mode or no configured remote server: connect directly
                // to the local guacamole websocket service.
                if (isEmbeddedMode() || !configuredUrl) {
                  return "ws://127.0.0.1:30008";
                }

                const wsProtocol = configuredUrl.startsWith("https://")
                  ? "wss://"
                  : "ws://";
                const wsHost = configuredUrl
                  .replace(/^https?:\/\//, "")
                  .replace(/\/$/, "");
                return `${wsProtocol}${wsHost}/guacamole/websocket/`;
              })()
            : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/guacamole/websocket/`;

        return `${wsBase}?token=${encodeURIComponent(token)}&width=${width}&height=${height}&dpi=${dpi}`;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        onError?.(errorMessage);
        return null;
      }
    },
    [connectionConfig, onError],
  );

  const rescaleDisplay = useCallback((immediate: boolean = false) => {
    if (!clientRef.current || !containerRef.current) return;

    const performRescale = () => {
      if (!clientRef.current || !containerRef.current) return;

      const display = clientRef.current.getDisplay();
      const cWidth = containerRef.current.clientWidth;
      const cHeight = containerRef.current.clientHeight;
      const displayWidth = display.getWidth();
      const displayHeight = display.getHeight();

      if (displayWidth > 0 && displayHeight > 0 && cWidth > 0 && cHeight > 0) {
        const scale = Math.min(cWidth / displayWidth, cHeight / displayHeight);
        scaleRef.current = scale;
        display.scale(scale);
      }
    };

    if (immediate) {
      performRescale();
    } else {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(performRescale, 200);
    }
  }, []);

  const connect = useCallback(async () => {
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;
    setIsConnecting(true);
    setIsReady(false);

    let containerWidth = containerRef.current?.clientWidth || 0;
    let containerHeight = containerRef.current?.clientHeight || 0;

    if (containerWidth < 100 || containerHeight < 100) {
      containerWidth = 1280;
      containerHeight = 720;
    }

    const wsUrl = await getWebSocketUrl(containerWidth, containerHeight);
    if (!wsUrl) {
      isConnectingRef.current = false;
      setIsConnecting(false);
      return;
    }

    const tunnel = new Guacamole.WebSocketTunnel(wsUrl);
    const client = new Guacamole.Client(tunnel);
    clientRef.current = client;

    const display = client.getDisplay();
    const displayElement = display.getElement();

    if (displayRef.current) {
      displayRef.current.innerHTML = "";
      displayRef.current.appendChild(displayElement);
    }

    displayElement.setAttribute("tabindex", "0");
    displayElement.style.outline = "none";

    display.onresize = () => {
      rescaleDisplay(true);
      setIsReady(true);
    };

    const mouse = new Guacamole.Mouse(displayElement);
    const sendMouseState = (state: Guacamole.Mouse.State) => {
      displayElement.focus({ preventScroll: true });
      const scale = scaleRef.current;
      const adjustedX = Math.round(state.x / scale);
      const adjustedY = Math.round(state.y / scale);

      const adjustedState = new Guacamole.Mouse.State(
        adjustedX,
        adjustedY,
        state.left,
        state.middle,
        state.right,
        state.up,
        state.down,
      ) as Guacamole.Mouse.State;

      client.sendMouseState(adjustedState);
    };
    mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = sendMouseState;

    const keyboard = new Guacamole.Keyboard(displayElement);
    keyboardRef.current = keyboard;
    keyboard.onkeydown = (keysym: number) => {
      client.sendKeyEvent(1, keysym);
    };
    keyboard.onkeyup = (keysym: number) => {
      client.sendKeyEvent(0, keysym);
    };

    client.onstatechange = (state: number) => {
      switch (state) {
        case 0:
          break;
        case 1:
          setIsConnecting(true);
          break;
        case 2:
          break;
        case 3:
          setIsConnecting(false);
          setIsReady(true);
          onConnect?.();
          break;
        case 4:
          break;
        case 5:
          setIsConnecting(false);
          setIsReady(false);
          keyboard.onkeydown = null;
          keyboard.onkeyup = null;
          onDisconnect?.();
          break;
      }
    };

    client.onerror = (error: Guacamole.Status) => {
      const errorMessage = error.message || "Connection error";
      setIsConnecting(false);
      setIsReady(false);
      onError?.(errorMessage);
    };

    client.onclipboard = (stream: Guacamole.InputStream, mimetype: string) => {
      if (mimetype === "text/plain") {
        const reader = new Guacamole.StringReader(stream);
        let data = "";
        reader.ontext = (text: string) => {
          data += text;
        };
        reader.onend = () => {
          navigator.clipboard.writeText(data).catch(() => {});
        };
      }
    };

    client.onaudio = (stream: Guacamole.InputStream, mimetype: string) => {
      Guacamole.AudioPlayer.getInstance(stream, mimetype);
    };

    client.connect();
  }, [getWebSocketUrl, onConnect, onDisconnect, onError, rescaleDisplay]);

  const hasInitiatedRef = useRef(false);
  const isMountedRef = useRef(false);
  const isConnectingRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;

    if (isVisible && !hasInitiatedRef.current) {
      hasInitiatedRef.current = true;
      requestAnimationFrame(() => {
        if (isMountedRef.current) {
          connect();
        }
      });
    }
  }, [isVisible, connect]);

  useEffect(() => {
    const keyboard = keyboardRef.current;
    const client = clientRef.current;
    if (!keyboard || !client) return;

    if (isVisible) {
      keyboard.onkeydown = (keysym: number) => {
        client.sendKeyEvent(1, keysym);
      };
      keyboard.onkeyup = (keysym: number) => {
        client.sendKeyEvent(0, keysym);
      };
    } else {
      keyboard.onkeydown = null;
      keyboard.onkeyup = null;
      keyboard.reset();
    }
  }, [isVisible]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      hasInitiatedRef.current = false;
      isConnectingRef.current = false;
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      rescaleDisplay(false);
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      resizeTimeoutRef.current = setTimeout(() => {
        if (clientRef.current && containerRef.current) {
          const w = containerRef.current.clientWidth;
          const h = containerRef.current.clientHeight;
          if (w > 0 && h > 0) clientRef.current.sendSize(w, h);
        }
      }, 200);
    });

    resizeObserver.observe(containerRef.current);

    const initialTimeout = setTimeout(() => rescaleDisplay(true), 100);

    return () => {
      resizeObserver.disconnect();
      clearTimeout(initialTimeout);
    };
  }, [rescaleDisplay]);

  const syncClipboard = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    navigator.clipboard
      .readText()
      .then((text) => {
        if (text) {
          const stream = client.createClipboardStream("text/plain");
          const writer = new Guacamole.StringWriter(stream);
          writer.sendText(text);
          writer.sendEnd();
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isVisible && isReady) {
      syncClipboard();
    }
  }, [isVisible, isReady, syncClipboard]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isReady) return;

    const handleFocus = () => syncClipboard();
    container.addEventListener("mouseenter", handleFocus);

    return () => {
      container.removeEventListener("mouseenter", handleFocus);
    };
  }, [isReady, syncClipboard]);

  const connectingMessage = t("guacamole.connecting", {
    type: (
      connectionConfig.protocol ||
      connectionConfig.type ||
      "remote"
    ).toUpperCase(),
  });

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      <div
        ref={displayRef}
        className="relative w-full h-full flex items-center justify-center"
        style={{
          cursor: isReady ? "none" : "default",
          visibility: isReady ? "visible" : "hidden",
        }}
      />

      <SimpleLoader visible={!isReady} message={connectingMessage} />
    </div>
  );
});
