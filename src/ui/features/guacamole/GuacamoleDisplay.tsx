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
import { getGuacamoleToken, isElectron } from "@/main-axios.ts";
import { SimpleLoader } from "@/lib/SimpleLoader.tsx";
import { getBasePath } from "@/lib/base-path.ts";
import { buildGuacamoleWebSocketBaseUrl } from "./guacamole-websocket-url.ts";
import {
  resolveConnectionOrigin,
  buildOriginWsUrl,
} from "@/lib/connection-origin.ts";
import {
  isFirefoxBrowser,
  isPasteShortcut,
  pasteTextToRemote,
} from "./guacamole-clipboard.ts";
import { getGuacamoleDisplaySize } from "./guacamole-display-size.ts";

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
  isConnected: () => boolean;
  sendKey: (keysym: number, pressed: boolean) => void;
  sendMouse: (x: number, y: number, buttonMask: number) => void;
  setClipboard: (data: string) => void;
}

export type GuacamoleTouchMode = "touchscreen" | "touchpad";

interface GuacamoleDisplayProps {
  connectionConfig: GuacamoleConnectionConfig;
  isVisible: boolean;
  touchMode?: GuacamoleTouchMode | null;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
}

const isDev = import.meta.env.DEV;

export const GuacamoleDisplay = forwardRef<
  GuacamoleDisplayHandle,
  GuacamoleDisplayProps
>(function GuacamoleDisplay(
  { connectionConfig, isVisible, touchMode, onConnect, onDisconnect, onError },
  ref,
) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const displayElementRef = useRef<HTMLElement | null>(null);
  const clientRef = useRef<Guacamole.Client | null>(null);
  const keyboardRef = useRef<Guacamole.Keyboard | null>(null);
  const scaleRef = useRef<number>(1);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasKeyboardFocusRef = useRef(false);
  const windowFocusedRef = useRef(
    typeof document === "undefined" ? true : document.hasFocus(),
  );
  const hasInitiatedRef = useRef(false);
  const isMountedRef = useRef(false);
  const isConnectingRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);

  const disconnectClient = useCallback(() => {
    const client = clientRef.current;
    clientRef.current = null;
    isConnectingRef.current = false;
    if (!client) return;

    try {
      client.disconnect();
    } catch (error) {
      console.warn("Failed to disconnect Guacamole client", error);
    }
  }, []);

  useImperativeHandle(ref, () => ({
    disconnect: disconnectClient,
    isConnected: () => isReady && !hasError,
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
        const connectionProtocol =
          connectionConfig.protocol ?? connectionConfig.type;

        if (connectionConfig.token) {
          token = connectionConfig.token;
        } else {
          const data = await getGuacamoleToken({
            protocol: connectionProtocol ?? "rdp",
            hostname: String(connectionConfig.hostname ?? ""),
            port: connectionConfig.port,
            username: connectionConfig.username,
            password: connectionConfig.password,
            domain: connectionConfig.domain,
            security:
              typeof connectionConfig.security === "string"
                ? connectionConfig.security
                : undefined,
            ignoreCert:
              typeof connectionConfig.ignoreCert === "boolean"
                ? connectionConfig.ignoreCert
                : undefined,
            guacamoleConfig: connectionConfig.guacamoleConfig as Parameters<
              typeof getGuacamoleToken
            >[0]["guacamoleConfig"],
          });
          token = data.token;
        }

        const displaySize = getGuacamoleDisplaySize(
          connectionConfig.width ?? containerWidth ?? 1280,
          connectionConfig.height ?? containerHeight ?? 720,
          connectionProtocol,
          window.devicePixelRatio,
          connectionConfig.dpi,
        );

        let wsBase: string | null;
        if (isElectron()) {
          const origin = await resolveConnectionOrigin({
            connectionType: connectionProtocol,
          });
          wsBase = await buildOriginWsUrl({
            origin,
            localPort: 30008,
            localPath: "/guacamole/websocket/",
            remotePath: "/guacamole/websocket/",
            includeLocalJwt: false,
          });
          if (!wsBase) {
            onError?.(t("errors.remoteServerRequired"));
            return null;
          }
        } else {
          wsBase = buildGuacamoleWebSocketBaseUrl({
            isDev,
            isElectronApp: false,
            isEmbeddedApp: false,
            basePath: getBasePath(),
            location: window.location,
          });
        }

        const params = new URLSearchParams({
          token,
          width: String(displaySize.width),
          height: String(displaySize.height),
        });
        if (displaySize.dpi) params.set("dpi", String(displaySize.dpi));
        return `${wsBase}?${params.toString()}`;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        onError?.(errorMessage);
        return null;
      }
    },
    [connectionConfig, onError, t],
  );

  const refreshKeyboardHandlers = useCallback(() => {
    const keyboard = keyboardRef.current;
    const client = clientRef.current;
    const displayElement = displayElementRef.current;

    if (!keyboard) return;

    const documentVisible =
      typeof document === "undefined" || document.visibilityState === "visible";
    const displayIsFocused =
      !!displayElement &&
      typeof document !== "undefined" &&
      document.activeElement === displayElement;
    const shouldCaptureInput =
      !!client &&
      !!displayElement &&
      isVisible &&
      documentVisible &&
      windowFocusedRef.current &&
      (hasKeyboardFocusRef.current || displayIsFocused);

    if (!shouldCaptureInput) {
      keyboard.onkeydown = null;
      keyboard.onkeyup = null;
      keyboard.reset();
      return;
    }

    keyboard.onkeydown = (keysym: number) => {
      if (!clientRef.current) return;
      if (!isVisible || !windowFocusedRef.current) return;

      const activeDisplay = displayElementRef.current;
      const stillFocused =
        !!activeDisplay &&
        typeof document !== "undefined" &&
        document.activeElement === activeDisplay;

      if (!hasKeyboardFocusRef.current && !stillFocused) return;
      clientRef.current.sendKeyEvent(1, keysym);
    };

    keyboard.onkeyup = (keysym: number) => {
      if (!clientRef.current) return;
      if (!isVisible || !windowFocusedRef.current) return;

      const activeDisplay = displayElementRef.current;
      const stillFocused =
        !!activeDisplay &&
        typeof document !== "undefined" &&
        document.activeElement === activeDisplay;

      if (!hasKeyboardFocusRef.current && !stillFocused) return;
      clientRef.current.sendKeyEvent(0, keysym);
    };
  }, [isVisible]);

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
    setIsReady(false);
    setHasError(false);

    // Wait two frames so the container is fully laid out before measuring.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (!isMountedRef.current) {
      isConnectingRef.current = false;
      return;
    }

    // The tab's DOM node can still be display:none (and report 0x0) when this
    // tab is restored in the background. Measuring then would force the
    // window-size fallback, which ignores the tab bar and makes the remote
    // resolution too tall (the bottom gets cut off). Poll briefly for a real
    // size before connecting so we capture the actual visible viewport.
    const measureContainer = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      return { width: rect?.width || 0, height: rect?.height || 0 };
    };

    let { width: containerWidth, height: containerHeight } = measureContainer();
    for (
      let attempt = 0;
      (containerWidth < 100 || containerHeight < 100) && attempt < 40;
      attempt++
    ) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      if (!isMountedRef.current) {
        isConnectingRef.current = false;
        return;
      }
      ({ width: containerWidth, height: containerHeight } = measureContainer());
    }

    if (containerWidth < 100 || containerHeight < 100) {
      containerWidth = window.innerWidth || 1280;
      containerHeight = window.innerHeight || 720;
    }

    const wsUrl = await getWebSocketUrl(containerWidth, containerHeight);
    if (!isMountedRef.current) {
      isConnectingRef.current = false;
      return;
    }
    if (!wsUrl) {
      isConnectingRef.current = false;
      return;
    }

    const tunnel = new Guacamole.WebSocketTunnel(wsUrl);
    const client = new Guacamole.Client(tunnel);
    clientRef.current = client;

    const display = client.getDisplay();
    const displayElement = display.getElement();
    displayElementRef.current = displayElement;

    if (displayRef.current) {
      displayRef.current.innerHTML = "";
      displayRef.current.appendChild(displayElement);
    }

    displayElement.setAttribute("tabindex", "0");
    displayElement.style.outline = "none";

    const useNativePasteFallback = isFirefoxBrowser();
    if (useNativePasteFallback) {
      displayElement.addEventListener(
        "keydown",
        (event) => {
          if (isPasteShortcut(event)) {
            event.stopImmediatePropagation();
          }
        },
        true,
      );
      displayElement.addEventListener(
        "paste",
        (event) => {
          if (clientRef.current !== client) return;
          const text = event.clipboardData?.getData("text/plain");
          if (!text) return;

          event.preventDefault();
          event.stopImmediatePropagation();
          pasteTextToRemote(client, text);
        },
        true,
      );
    }

    display.onresize = () => {
      if (!isMountedRef.current) return;
      rescaleDisplay(true);
      setIsReady(true);
    };

    const protocol = connectionConfig.protocol ?? connectionConfig.type;
    if (protocol === "telnet" && isMountedRef.current) {
      setIsReady(true);
    }

    const sendMouseEvent = (event: Guacamole.Mouse.MouseEvent) => {
      displayElement.focus({ preventScroll: true });
      const scale = scaleRef.current;
      const state = event.state;
      const adjustedState = new Guacamole.Mouse.State(
        Math.round(state.x / scale),
        Math.round(state.y / scale),
        state.left,
        state.middle,
        state.right,
        state.up,
        state.down,
      ) as Guacamole.Mouse.State;
      client.sendMouseState(adjustedState);
    };

    if (touchMode === "touchscreen") {
      const touchscreen = new Guacamole.Mouse.Touchscreen(displayElement);
      touchscreen.onEach(["mousedown", "mousemove", "mouseup"], sendMouseEvent);
    } else if (touchMode === "touchpad") {
      const touchpad = new Guacamole.Mouse.Touchpad(displayElement);
      touchpad.onEach(["mousedown", "mousemove", "mouseup"], sendMouseEvent);
    } else {
      const mouse = new Guacamole.Mouse(displayElement);
      const sendMouseState = (state: Guacamole.Mouse.State) => {
        displayElement.focus({ preventScroll: true });
        const scale = scaleRef.current;
        const adjustedState = new Guacamole.Mouse.State(
          Math.round(state.x / scale),
          Math.round(state.y / scale),
          state.left,
          state.middle,
          state.right,
          state.up,
          state.down,
        ) as Guacamole.Mouse.State;
        client.sendMouseState(adjustedState);
      };
      mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = sendMouseState;
    }

    const keyboard = new Guacamole.Keyboard(displayElement);
    keyboardRef.current = keyboard;

    const handleDisplayFocus = () => {
      hasKeyboardFocusRef.current = true;
      refreshKeyboardHandlers();
    };

    const handleDisplayBlur = () => {
      hasKeyboardFocusRef.current = false;
      refreshKeyboardHandlers();
    };

    displayElement.addEventListener("focus", handleDisplayFocus);
    displayElement.addEventListener("blur", handleDisplayBlur);
    displayElement.addEventListener("mousedown", handleDisplayFocus);
    displayElement.addEventListener("touchstart", handleDisplayFocus, {
      passive: true,
    });
    refreshKeyboardHandlers();

    client.onstatechange = (state: number) => {
      if (!isMountedRef.current) return;
      switch (state) {
        case 0:
          break;
        case 1:
          break;
        case 2:
          break;
        case 3:
          isConnectingRef.current = false;
          setIsReady(true);
          onConnect?.();
          if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const size = getGuacamoleDisplaySize(
              rect.width,
              rect.height,
              protocol,
              window.devicePixelRatio,
              connectionConfig.dpi,
            );
            client.sendSize(size.width, size.height);
          }
          rescaleDisplay(false);
          break;
        case 4:
          break;
        case 5:
          setIsReady(false);
          hasKeyboardFocusRef.current = false;
          refreshKeyboardHandlers();
          onDisconnect?.();
          break;
      }
    };

    client.onerror = (error: Guacamole.Status) => {
      if (!isMountedRef.current) return;
      const errorMessage = error.message || t("guacamole.connectionError");
      setIsReady(false);
      setHasError(true);
      isConnectingRef.current = false;
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
          navigator.clipboard?.writeText?.(data).catch(() => {});
        };
      }
    };

    client.onaudio = (stream: Guacamole.InputStream, mimetype: string) => {
      Guacamole.AudioPlayer.getInstance(stream, mimetype);
    };

    client.onfile = (
      stream: Guacamole.InputStream,
      mimetype: string,
      filename: string,
    ) => {
      const reader = new Guacamole.BlobReader(stream, mimetype);
      reader.onend = () => {
        const blob = reader.getBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      };
      stream.sendAck("OK", Guacamole.Status.Code.SUCCESS);
    };

    try {
      client.connect();
    } catch (error) {
      isConnectingRef.current = false;
      if (!isMountedRef.current) return;
      setIsReady(false);
      setHasError(true);
      onError?.(
        error instanceof Error ? error.message : t("guacamole.connectionError"),
      );
    }
  }, [
    getWebSocketUrl,
    onConnect,
    onDisconnect,
    onError,
    refreshKeyboardHandlers,
    rescaleDisplay,
    connectionConfig.protocol,
    connectionConfig.type,
    connectionConfig.dpi,
    touchMode,
    t,
  ]);

  useEffect(() => {
    isMountedRef.current = true;

    if (isVisible && !hasInitiatedRef.current) {
      hasInitiatedRef.current = true;
      connect();
    }
  }, [isVisible, connect]);

  useEffect(() => {
    if (!isVisible) {
      hasKeyboardFocusRef.current = false;
    }

    refreshKeyboardHandlers();
  }, [isVisible, refreshKeyboardHandlers]);

  useEffect(() => {
    const handleWindowFocus = () => {
      windowFocusedRef.current = true;
      refreshKeyboardHandlers();
    };

    const handleWindowBlur = () => {
      windowFocusedRef.current = false;
      hasKeyboardFocusRef.current = false;
      refreshKeyboardHandlers();
    };

    const handleVisibilityChange = () => {
      windowFocusedRef.current =
        document.visibilityState === "visible" && document.hasFocus();
      if (document.visibilityState !== "visible") {
        hasKeyboardFocusRef.current = false;
      }
      refreshKeyboardHandlers();
    };

    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshKeyboardHandlers]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      hasInitiatedRef.current = false;
      isConnectingRef.current = false;
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      disconnectClient();
      displayElementRef.current = null;
    };
  }, [disconnectClient]);

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      resizeTimeoutRef.current = setTimeout(() => {
        if (clientRef.current && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          const size = getGuacamoleDisplaySize(
            rect.width,
            rect.height,
            connectionConfig.protocol ?? connectionConfig.type,
            window.devicePixelRatio,
            connectionConfig.dpi,
          );
          if (rect.width > 0 && rect.height > 0) {
            clientRef.current.sendSize(size.width, size.height);
            rescaleDisplay(true);
          }
        }
      }, 150);
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [
    connectionConfig.dpi,
    connectionConfig.protocol,
    connectionConfig.type,
    rescaleDisplay,
  ]);

  const syncClipboard = useCallback(() => {
    const client = clientRef.current;
    if (!client || isFirefoxBrowser() || !navigator.clipboard?.readText) return;
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

      <SimpleLoader
        visible={!isReady && !hasError}
        message={connectingMessage}
      />
    </div>
  );
});
