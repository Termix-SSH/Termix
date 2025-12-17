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
  type: GuacamoleConnectionType;
  hostname: string;
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

export const GuacamoleDisplay = forwardRef<GuacamoleDisplayHandle, GuacamoleDisplayProps>(
  function GuacamoleDisplay(
    { connectionConfig, isVisible, onConnect, onDisconnect, onError },
    ref
  ) {
    const { t } = useTranslation();
    const displayRef = useRef<HTMLDivElement>(null);
    const clientRef = useRef<Guacamole.Client | null>(null);
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
            new Guacamole.Mouse.State({ x, y, left: !!(buttonMask & 1), middle: !!(buttonMask & 2), right: !!(buttonMask & 4) })
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

    const getWebSocketUrl = useCallback(async (): Promise<string | null> => {
      const jwtToken = getCookie("jwt");
      if (!jwtToken) {
        setConnectionError("Authentication required");
        return null;
      }

      // First, get an encrypted token from the backend
      try {
        const baseUrl = isDev
          ? "http://localhost:30001"
          : isElectron()
            ? (window as { configuredServerUrl?: string }).configuredServerUrl || "http://127.0.0.1:30001"
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

        const { token } = await response.json();

        // Build WebSocket URL
        const wsBase = isDev
          ? `ws://localhost:30007`
          : isElectron()
            ? (() => {
                const base = (window as { configuredServerUrl?: string }).configuredServerUrl || "http://127.0.0.1:30001";
                return `${base.startsWith("https://") ? "wss://" : "ws://"}${base.replace(/^https?:\/\//, "")}/guacamole/websocket/`;
              })()
            : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/guacamole/websocket/`;

        return `${wsBase}?token=${encodeURIComponent(token)}`;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        setConnectionError(errorMessage);
        onError?.(errorMessage);
        return null;
      }
    }, [connectionConfig, onError]);

    const connect = useCallback(async () => {
      if (isConnecting || isConnected) return;
      setIsConnecting(true);
      setConnectionError(null);

      const wsUrl = await getWebSocketUrl();
      if (!wsUrl) {
        setIsConnecting(false);
        return;
      }

      const tunnel = new Guacamole.WebSocketTunnel(wsUrl);
      const client = new Guacamole.Client(tunnel);
      clientRef.current = client;

      // Set up display
      const display = client.getDisplay();
      if (displayRef.current) {
        displayRef.current.innerHTML = "";
        const displayElement = display.getElement();
        displayElement.style.width = "100%";
        displayElement.style.height = "100%";
        displayRef.current.appendChild(displayElement);
      }

      // Handle display sync (when frames arrive) - scale to fit container
      display.onresize = (width: number, height: number) => {
        if (displayRef.current) {
          const containerWidth = displayRef.current.clientWidth;
          const containerHeight = displayRef.current.clientHeight;
          const scale = Math.min(containerWidth / width, containerHeight / height);
          display.scale(scale);
        }
      };

      // Set up mouse input
      const mouse = new Guacamole.Mouse(displayRef.current!);
      mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = (state: Guacamole.Mouse.State) => {
        client.sendMouseState(state);
      };

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

      // Connect with display size
      const width = connectionConfig.width || displayRef.current?.clientWidth || 1024;
      const height = connectionConfig.height || displayRef.current?.clientHeight || 768;
      const dpi = connectionConfig.dpi || 96;

      client.connect(`width=${width}&height=${height}&dpi=${dpi}`);
    }, [isConnecting, isConnected, getWebSocketUrl, connectionConfig, onConnect, onDisconnect, onError, t]);

    // Track if we've initiated a connection to prevent re-triggering
    const hasInitiatedRef = useRef(false);

    useEffect(() => {
      if (isVisible && !hasInitiatedRef.current) {
        hasInitiatedRef.current = true;
        connect();
      }
    }, [isVisible, connect]);

    // Separate cleanup effect that only runs on unmount
    useEffect(() => {
      return () => {
        if (clientRef.current) {
          clientRef.current.disconnect();
        }
      };
    }, []);

    // Handle window resize
    useEffect(() => {
      const handleResize = () => {
        if (clientRef.current && displayRef.current) {
          const display = clientRef.current.getDisplay();
          const width = displayRef.current.clientWidth;
          const height = displayRef.current.clientHeight;
          display.scale(Math.min(width / display.getWidth(), height / display.getHeight()));
        }
      };

      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }, []);

    return (
      <div className="h-full w-full relative bg-black">
        <div
          ref={displayRef}
          className="h-full w-full"
          style={{ cursor: isConnected ? "none" : "default" }}
        />

        {isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="text-muted-foreground">
                {t("guacamole.connecting", { type: connectionConfig.type.toUpperCase() })}
              </span>
            </div>
          </div>
        )}

        {connectionError && !isConnecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="flex flex-col items-center gap-4 text-center p-4">
              <span className="text-destructive font-medium">{t("guacamole.connectionFailed")}</span>
              <span className="text-muted-foreground text-sm">{connectionError}</span>
            </div>
          </div>
        )}
      </div>
    );
  }
);

