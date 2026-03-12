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
import { toast } from "sonner";
import { getCookie, isElectron } from "@/ui/main-axios.ts";
import { Loader2 } from "lucide-react";

export type GuacamoleConnectionType = "rdp" | "vnc" | "telnet";

export interface GuacamoleConnectionConfig {
  // Pre-fetched token (preferred) - if provided, skip token fetch
  token?: string;
  protocol?: GuacamoleConnectionType;
  // Legacy fields for backward compatibility (used if token not provided)
  type?: GuacamoleConnectionType;
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  // Display settings
  width?: number;
  height?: number;
  dpi?: number;
  // Additional protocol options
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
  const containerRef = useRef<HTMLDivElement>(null); // Outer container for measuring size
  const displayRef = useRef<HTMLDivElement>(null); // Inner div for guacamole canvas
  const clientRef = useRef<Guacamole.Client | null>(null);
  const scaleRef = useRef<number>(1); // Track current scale factor for mouse
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Debounce resize events
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

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

        // If token is pre-fetched, use it directly
        if (connectionConfig.token) {
          token = connectionConfig.token;
        } else {
          // Otherwise, fetch token from backend (legacy behavior)
          const jwtToken = getCookie("jwt");
          if (!jwtToken) {
            setConnectionError("Authentication required");
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

        // Build WebSocket URL with width/height/dpi as query parameters
        // These are passed as unencrypted settings to guacamole-lite
        // Use actual container dimensions, fall back to 720p
        const width = connectionConfig.width || containerWidth || 1280;
        const height = connectionConfig.height || containerHeight || 720;
        const dpi = connectionConfig.dpi || 96;

        const wsBase = isDev
          ? `ws://localhost:30008`
          : isElectron()
            ? (() => {
                const base =
                  (window as { configuredServerUrl?: string })
                    .configuredServerUrl || "http://127.0.0.1:30001";
                return `${base.startsWith("https://") ? "wss://" : "ws://"}${base.replace(/^https?:\/\//, "")}/guacamole/websocket/`;
              })()
            : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/guacamole/websocket/`;

        return `${wsBase}?token=${encodeURIComponent(token)}&width=${width}&height=${height}&dpi=${dpi}`;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        setConnectionError(errorMessage);
        onError?.(errorMessage);
        return null;
      }
    },
    [connectionConfig, onError],
  );

  // Consolidated rescaling function with debouncing
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
      // Debounce to match sidebar/topbar transition duration (200ms)
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(performRescale, 200);
    }
  }, []);

  const connect = useCallback(async () => {
    if (isConnectingRef.current || isConnected) return;
    isConnectingRef.current = true;
    setIsConnecting(true);
    setConnectionError(null);

    // Get container dimensions for the WebSocket URL
    let containerWidth = containerRef.current?.clientWidth || 0;
    let containerHeight = containerRef.current?.clientHeight || 0;

    // If container size is too small or unavailable, use 720p default
    if (containerWidth < 100 || containerHeight < 100) {
      containerWidth = 1280;
      containerHeight = 720;
    }

    const wsUrl = await getWebSocketUrl(containerWidth, containerHeight);
    if (!wsUrl) {
      setIsConnecting(false);
      return;
    }

    const tunnel = new Guacamole.WebSocketTunnel(wsUrl);
    const client = new Guacamole.Client(tunnel);
    clientRef.current = client;

    // Set up display
    const display = client.getDisplay();
    const displayElement = display.getElement();

    if (displayRef.current) {
      displayRef.current.innerHTML = "";
      displayRef.current.appendChild(displayElement);
    }

    // Handle display sync (when frames arrive)
    display.onresize = () => {
      rescaleDisplay(true); // Immediate rescale on display resize
    };

    // Set up mouse input on the display element (not the container)
    // We need to adjust mouse coordinates based on the current scale factor
    const mouse = new Guacamole.Mouse(displayElement);
    const sendMouseState = (state: Guacamole.Mouse.State) => {
      // Adjust coordinates based on scale factor and round to integers
      const scale = scaleRef.current;
      const adjustedX = Math.round(state.x / scale);
      const adjustedY = Math.round(state.y / scale);

      // Create adjusted state - guacamole expects integer coordinates
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

    // Set up keyboard input
    const keyboard = new Guacamole.Keyboard(document);
    keyboard.onkeydown = (keysym: number) => {
      client.sendKeyEvent(1, keysym);
    };
    keyboard.onkeyup = (keysym: number) => {
      client.sendKeyEvent(0, keysym);
    };

    // Handle client state changes
    client.onstatechange = (state: number) => {
      switch (state) {
        case 0: // IDLE
          break;
        case 1: // CONNECTING
          setIsConnecting(true);
          break;
        case 2: // WAITING
          break;
        case 3: // CONNECTED
          setIsConnected(true);
          setIsConnecting(false);
          onConnect?.();
          break;
        case 4: // DISCONNECTING
          break;
        case 5: // DISCONNECTED
          setIsConnected(false);
          setIsConnecting(false);
          keyboard.onkeydown = null;
          keyboard.onkeyup = null;
          onDisconnect?.();
          break;
      }
    };

    // Handle errors
    client.onerror = (error: Guacamole.Status) => {
      const errorMessage = error.message || "Connection error";
      console.error(
        `[Guacamole] Connection error:`,
        error,
        `Code:`,
        error.code,
        `Message:`,
        errorMessage,
      );
      setConnectionError(errorMessage);
      setIsConnecting(false);
      onError?.(errorMessage);
      toast.error(`${t("guacamole.connectionError")}: ${errorMessage}`);
    };

    // Handle clipboard from remote
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

    // Connect - the width/height/dpi are already in the WebSocket URL
    client.connect();
  }, [
    isConnecting,
    isConnected,
    getWebSocketUrl,
    connectionConfig,
    onConnect,
    onDisconnect,
    onError,
    t,
    rescaleDisplay,
  ]);

  // Track if we've initiated a connection to prevent re-triggering
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

  // Use ResizeObserver to handle container resizing (sidebar/topbar toggle, window resize)
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      rescaleDisplay(false); // Debounced rescale
    });

    resizeObserver.observe(containerRef.current);

    // Initial rescale after a short delay to ensure layout is stable
    const initialTimeout = setTimeout(() => rescaleDisplay(true), 100);

    return () => {
      resizeObserver.disconnect();
      clearTimeout(initialTimeout);
    };
  }, [rescaleDisplay]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 bg-black flex items-center justify-center overflow-hidden"
    >
      <div
        ref={displayRef}
        className="relative"
        style={{ cursor: isConnected ? "none" : "default" }}
      />

      {isConnecting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="text-muted-foreground">
              {t("guacamole.connecting", {
                type: (
                  connectionConfig.protocol ||
                  connectionConfig.type ||
                  "remote"
                ).toUpperCase(),
              })}
            </span>
          </div>
        </div>
      )}

      {connectionError && !isConnecting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="flex flex-col items-center gap-4 text-center p-4">
            <span className="text-destructive font-medium">
              {t("guacamole.connectionFailed")}
            </span>
            <span className="text-muted-foreground text-sm">
              {connectionError}
            </span>
          </div>
        </div>
      )}
    </div>
  );
});
