import { getErrorMessage } from "../../lib/error-message.js";
import type React from "react";
import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";
import Guacamole from "guacamole-common-js";
import { Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getGuacamoleToken, isElectron } from "@/main-axios.ts";
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
import { bindPointerInput } from "./guacamole-pointer.ts";
import {
  getFileDropDisposition,
  hasDraggedFiles,
} from "./guacamole-file-drop.ts";
import { guacStateToStage } from "@/components/connection/connection-status.ts";
import type { ConnectionStage } from "@/types/connection-log.ts";
import { clampGuacamoleZoom, stepGuacamoleZoom } from "./guacamole-zoom.ts";

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
  getFilesystem: () => Guacamole.Object | null;
  zoomIn: () => number;
  zoomOut: () => number;
  resetZoom: () => number;
}

export type GuacamoleTouchMode = "touchscreen" | "touchpad";

interface GuacamoleDisplayProps {
  connectionConfig: GuacamoleConnectionConfig;
  isVisible: boolean;
  touchMode?: GuacamoleTouchMode | null;
  allowUpload?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
  onFilesystem?: (filesystem: Guacamole.Object | null) => void;
  onDropFiles?: (files: File[]) => void;
  onDropUnavailable?: () => void;
  onStageChange?: (stage: ConnectionStage) => void;
  onZoomChange?: (zoom: number) => void;
}

const isDev = import.meta.env.DEV;

export const GuacamoleDisplay = forwardRef<
  GuacamoleDisplayHandle,
  GuacamoleDisplayProps
>(function GuacamoleDisplay(
  {
    connectionConfig,
    isVisible,
    touchMode,
    allowUpload = false,
    onConnect,
    onDisconnect,
    onError,
    onFilesystem,
    onDropFiles,
    onDropUnavailable,
    onStageChange,
    onZoomChange,
  },
  ref,
) {
  const { t } = useTranslation();
  // The host config pins the session resolution; without it the display follows
  // the container.
  const hasConfiguredSize =
    connectionConfig.width != null && connectionConfig.height != null;
  const containerRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const displayElementRef = useRef<HTMLElement | null>(null);
  const clientRef = useRef<Guacamole.Client | null>(null);
  const filesystemRef = useRef<Guacamole.Object | null>(null);
  // Held in a ref so tearing down the client can report the loss without
  // rebuilding the connect callback whenever the parent re-renders.
  const onFilesystemRef = useRef(onFilesystem);
  onFilesystemRef.current = onFilesystem;
  const onStageChangeRef = useRef(onStageChange);
  onStageChangeRef.current = onStageChange;
  const keyboardRef = useRef<Guacamole.Keyboard | null>(null);
  const scaleRef = useRef<number>(1);
  const fitScaleRef = useRef<number>(1);
  const zoomRef = useRef<number>(1);
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
    if (filesystemRef.current) {
      filesystemRef.current = null;
      onFilesystemRef.current?.(null);
    }
    if (!client) return;

    try {
      client.disconnect();
    } catch (error) {
      console.warn("Failed to disconnect Guacamole client", error);
    }
  }, []);

  const applyZoom = useCallback(
    (nextZoom: number): number => {
      const zoom = clampGuacamoleZoom(nextZoom);
      zoomRef.current = zoom;
      const display = clientRef.current?.getDisplay();
      if (display && displayRef.current) {
        const scale = fitScaleRef.current * zoom;
        scaleRef.current = scale;
        display.scale(scale);
        displayRef.current.style.width = `${display.getWidth() * scale}px`;
        displayRef.current.style.height = `${display.getHeight() * scale}px`;
      }
      onZoomChange?.(zoom);
      return zoom;
    },
    [onZoomChange],
  );

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
    getFilesystem: () => filesystemRef.current,
    zoomIn: () => applyZoom(stepGuacamoleZoom(zoomRef.current, 1)),
    zoomOut: () => applyZoom(stepGuacamoleZoom(zoomRef.current, -1)),
    resetZoom: () => applyZoom(1),
  }));

  const getWebSocketConnection = useCallback(
    async (
      containerWidth: number,
      containerHeight: number,
    ): Promise<{ url: string; query: string } | null> => {
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
            includeJwt: false,
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
        return { url: wsBase, query: params.toString() };
      } catch (error) {
        const errorMessage = getErrorMessage(error);
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

  const rescaleDisplay = useCallback(
    (immediate: boolean = false) => {
      if (!clientRef.current || !containerRef.current) return;

      const performRescale = () => {
        if (!clientRef.current || !containerRef.current) return;

        const display = clientRef.current.getDisplay();
        const cWidth = containerRef.current.clientWidth;
        const cHeight = containerRef.current.clientHeight;
        const displayWidth = display.getWidth();
        const displayHeight = display.getHeight();

        if (
          displayWidth > 0 &&
          displayHeight > 0 &&
          cWidth > 0 &&
          cHeight > 0
        ) {
          fitScaleRef.current = Math.min(
            cWidth / displayWidth,
            cHeight / displayHeight,
          );
          applyZoom(zoomRef.current);
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
    },
    [applyZoom],
  );

  const connect = useCallback(async () => {
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;
    setIsReady(false);
    setHasError(false);

    // Let layout settle before measuring without depending on animation frames,
    // which may be throttled while Electron windows or tabs are inactive.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
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

    const wsConnection = await getWebSocketConnection(
      containerWidth,
      containerHeight,
    );
    if (!isMountedRef.current) {
      isConnectingRef.current = false;
      return;
    }
    if (!wsConnection) {
      isConnectingRef.current = false;
      return;
    }

    const tunnel = new Guacamole.WebSocketTunnel(wsConnection.url);
    const client = new Guacamole.Client(tunnel);
    clientRef.current = client;
    let connectWatchdog: ReturnType<typeof setTimeout> | null = null;
    const clearConnectWatchdog = () => {
      if (!connectWatchdog) return;
      clearTimeout(connectWatchdog);
      connectWatchdog = null;
    };

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
      if (!isMountedRef.current || clientRef.current !== client) return;
      rescaleDisplay(true);
      setIsReady(true);
    };

    const protocol = connectionConfig.protocol ?? connectionConfig.type;
    if (protocol === "telnet" && isMountedRef.current) {
      setIsReady(true);
    }

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

    bindPointerInput(displayElement, touchMode, sendMouseState);

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
      if (!isMountedRef.current || clientRef.current !== client) return;
      onStageChangeRef.current?.(guacStateToStage(state));
      switch (state) {
        case 0:
          break;
        case 1:
          break;
        case 2:
          break;
        case 3:
          clearConnectWatchdog();
          isConnectingRef.current = false;
          setIsReady(true);
          onConnect?.();
          // A configured resolution is the size the session should render at;
          // resizing it to the container would discard it. rescaleDisplay still
          // fits that fixed display into whatever space is available.
          if (!hasConfiguredSize && containerRef.current) {
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
          clearConnectWatchdog();
          isConnectingRef.current = false;
          setIsReady(false);
          setHasError(true);
          hasKeyboardFocusRef.current = false;
          refreshKeyboardHandlers();
          onError?.(t("guacamole.connectionError"));
          onDisconnect?.();
          break;
      }
    };

    client.onerror = (error: Guacamole.Status) => {
      if (!isMountedRef.current || clientRef.current !== client) return;
      clearConnectWatchdog();
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

    // Only fires when the connection enables drive redirection; guacd exposes
    // the redirected drive as a single filesystem object.
    client.onfilesystem = (filesystem: Guacamole.Object) => {
      if (!isMountedRef.current || clientRef.current !== client) return;
      filesystemRef.current = filesystem;
      onFilesystemRef.current?.(filesystem);

      filesystem.onundefine = () => {
        if (filesystemRef.current !== filesystem) return;
        filesystemRef.current = null;
        onFilesystemRef.current?.(null);
      };
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
      connectWatchdog = setTimeout(() => {
        if (
          !isMountedRef.current ||
          clientRef.current !== client ||
          !isConnectingRef.current
        ) {
          return;
        }

        disconnectClient();
        void connect();
      }, 8000);
      client.connect(wsConnection.query);
    } catch (error) {
      clearConnectWatchdog();
      isConnectingRef.current = false;
      if (!isMountedRef.current) return;
      setIsReady(false);
      setHasError(true);
      onError?.(getErrorMessage(error, t("guacamole.connectionError")));
    }
  }, [
    getWebSocketConnection,
    onConnect,
    onDisconnect,
    onError,
    refreshKeyboardHandlers,
    rescaleDisplay,
    disconnectClient,
    connectionConfig.protocol,
    connectionConfig.type,
    connectionConfig.dpi,
    hasConfiguredSize,
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
          if (rect.width > 0 && rect.height > 0) {
            if (!hasConfiguredSize) {
              const size = getGuacamoleDisplaySize(
                rect.width,
                rect.height,
                connectionConfig.protocol ?? connectionConfig.type,
                window.devicePixelRatio,
                connectionConfig.dpi,
              );
              clientRef.current.sendSize(size.width, size.height);
            }
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
    hasConfiguredSize,
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
    const protocol = connectionConfig.protocol ?? connectionConfig.type;
    if (!container || !isReady || protocol !== "vnc") return;

    let pinchDistance = 0;
    let pinchZoom = zoomRef.current;
    const distance = (touches: TouchList) =>
      Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY,
      );
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      event.stopPropagation();
      pinchDistance = distance(event.touches);
      pinchZoom = zoomRef.current;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || pinchDistance === 0) return;
      event.preventDefault();
      event.stopPropagation();
      applyZoom(pinchZoom * (distance(event.touches) / pinchDistance));
    };
    const onTouchEnd = () => {
      pinchDistance = 0;
    };

    container.addEventListener("touchstart", onTouchStart, {
      passive: false,
      capture: true,
    });
    container.addEventListener("touchmove", onTouchMove, {
      passive: false,
      capture: true,
    });
    container.addEventListener("touchend", onTouchEnd, { capture: true });
    return () => {
      container.removeEventListener("touchstart", onTouchStart, true);
      container.removeEventListener("touchmove", onTouchMove, true);
      container.removeEventListener("touchend", onTouchEnd, true);
    };
  }, [applyZoom, connectionConfig.protocol, connectionConfig.type, isReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isReady) return;

    const handleFocus = () => syncClipboard();
    container.addEventListener("mouseenter", handleFocus);

    return () => {
      container.removeEventListener("mouseenter", handleFocus);
    };
  }, [isReady, syncClipboard]);

  const canDropFiles = allowUpload && onDropFiles != null;
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  // Nested elements fire dragleave as the pointer crosses them, so track depth
  // rather than clearing the highlight on the first leave.
  const dragDepthRef = useRef(0);

  const handleDragEnter = useCallback(
    (event: React.DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer.types)) return;
      event.preventDefault();
      if (!canDropFiles) return;
      dragDepthRef.current += 1;
      setIsDraggingFiles(true);
    },
    [canDropFiles],
  );

  const handleDragLeave = useCallback(() => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      if (!hasDraggedFiles(event.dataTransfer.types)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);

      const files = Array.from(event.dataTransfer.files);
      const disposition = getFileDropDisposition(
        event.dataTransfer.types,
        files.length,
        canDropFiles,
      );
      if (disposition === "upload") onDropFiles?.(files);
      if (disposition === "reject") onDropUnavailable?.();
    },
    [canDropFiles, onDropFiles, onDropUnavailable],
  );

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-auto"
      style={{ backgroundColor: "var(--bg-base)" }}
      onDragEnter={handleDragEnter}
      onDragOver={(event) => {
        if (hasDraggedFiles(event.dataTransfer.types)) event.preventDefault();
      }}
      onDragLeave={canDropFiles ? handleDragLeave : undefined}
      onDrop={handleDrop}
    >
      <div
        ref={displayRef}
        className="relative flex min-h-full min-w-full items-center justify-center"
        style={{
          cursor: isReady ? "none" : "default",
          visibility: isReady ? "visible" : "hidden",
        }}
      />

      {isDraggingFiles && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none bg-background/70 backdrop-blur-sm">
          <div className="flex items-center gap-2 rounded-sm border-2 border-dashed border-border px-4 py-3 text-sm font-semibold">
            <Upload className="size-4" />
            {t("guacamole.files.dropToUpload")}
          </div>
        </div>
      )}
    </div>
  );
});
