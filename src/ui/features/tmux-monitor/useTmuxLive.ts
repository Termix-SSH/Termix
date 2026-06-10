// React hook managing a single WebSocket connection to the tmux-monitor live
// streaming service (port 30011, nginx path /tmux_monitor/live/). The socket
// is created lazily on the first subscribe; a new subscribe replaces the
// previous one on the same socket. On unexpected close the hook reconnects
// with exponential backoff (max 3 attempts) before reporting failure so the
// caller can fall back to REST polling.

import { useCallback, useEffect, useRef, useState } from "react";
import { getBasePath } from "@/lib/base-path";
import { getServerConfig, isElectron, isEmbeddedMode } from "@/main-axios";

export type TmuxLiveStatus = "idle" | "connecting" | "live" | "failed";

export interface TmuxLiveHandlers {
  onData: (data: string) => void;
  onStructureChanged?: () => void;
  /** Called when streaming is no longer possible (detached, error, or the
   * connection could not be (re)established). Caller should fall back to
   * REST polling. */
  onDetached?: () => void;
}

interface ActiveSubscription {
  hostId: number;
  sessionName: string;
  paneId: string;
  handlers: TmuxLiveHandlers;
}

const MAX_RECONNECT_ATTEMPTS = 3;
const PING_INTERVAL_MS = 30_000;
// A socket stuck in CONNECTING (e.g. a proxy that accepts TCP but never
// completes the upgrade) fires neither onopen nor onclose -- force-close it
// after this long so the retry/fallback logic can run.
const HANDSHAKE_TIMEOUT_MS = 8_000;

function appendToken(url: string): string {
  const storedJwt = localStorage.getItem("jwt");
  if (!storedJwt) return url;
  return `${url}?token=${encodeURIComponent(storedJwt)}`;
}

// Mirrors how Terminal.tsx builds its SSH WebSocket URL (port 30002 /
// /ssh/websocket/) for the tmux live service (port 30011 / /tmux_monitor/live/).
async function buildLiveWsUrl(): Promise<string | null> {
  const isDev =
    !isElectron() &&
    import.meta.env.DEV &&
    (window.location.port === "3000" ||
      window.location.port === "5173" ||
      window.location.port === "");

  if (isDev) {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return appendToken(`${proto}://localhost:30011`);
  }

  if (isElectron()) {
    if (isEmbeddedMode()) {
      return appendToken("ws://127.0.0.1:30011");
    }

    let configuredUrl = (window as { configuredServerUrl?: string | null })
      .configuredServerUrl;
    if (!configuredUrl) {
      try {
        const serverConfig = await getServerConfig();
        configuredUrl = serverConfig?.serverUrl || null;
        if (configuredUrl) {
          (
            window as Window &
              typeof globalThis & { configuredServerUrl?: string | null }
          ).configuredServerUrl = configuredUrl;
        }
      } catch (error) {
        console.error("Failed to resolve Electron server URL:", error);
      }
    }
    if (!configuredUrl) return null;

    const wsProtocol = configuredUrl.startsWith("https://")
      ? "wss://"
      : "ws://";
    const wsHost = configuredUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return appendToken(`${wsProtocol}${wsHost}/tmux_monitor/live/`);
  }

  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${getBasePath()}/tmux_monitor/live/`;
}

export function useTmuxLive(): {
  status: TmuxLiveStatus;
  subscribe: (
    hostId: number,
    sessionName: string,
    paneId: string,
    handlers: TmuxLiveHandlers,
  ) => void;
  unsubscribe: () => void;
} {
  const [status, setStatus] = useState<TmuxLiveStatus>("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const subRef = useRef<ActiveSubscription | null>(null);
  const connectingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmountedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  const failSubscription = useCallback(() => {
    if (unmountedRef.current) return;
    const sub = subRef.current;
    if (!sub) return;
    setStatus("failed");
    sub.handlers.onDetached?.();
  }, []);

  const connect = useCallback(async () => {
    if (connectingRef.current || unmountedRef.current) return;
    connectingRef.current = true;
    setStatus("connecting");

    let url: string | null = null;
    try {
      url = await buildLiveWsUrl();
    } catch {
      url = null;
    }

    if (unmountedRef.current || !subRef.current) {
      connectingRef.current = false;
      return;
    }
    if (!url) {
      connectingRef.current = false;
      failSubscription();
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      connectingRef.current = false;
      failSubscription();
      return;
    }
    wsRef.current = ws;

    const handshakeTimer = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        connectingRef.current = false;
        ws.close(); // fires onclose, which drives retry/fallback
      }
    }, HANDSHAKE_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(handshakeTimer);
      connectingRef.current = false;
      reconnectAttemptsRef.current = 0;
      const sub = subRef.current;
      if (sub) {
        ws.send(
          JSON.stringify({
            type: "subscribe",
            hostId: sub.hostId,
            sessionName: sub.sessionName,
            paneId: sub.paneId,
          }),
        );
      }
      if (pingTimerRef.current) clearInterval(pingTimerRef.current);
      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      let msg: {
        type?: string;
        paneId?: string;
        data?: string;
        message?: string;
      };
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      const sub = subRef.current;
      switch (msg.type) {
        case "subscribed":
          if (sub && msg.paneId === sub.paneId && !unmountedRef.current) {
            setStatus("live");
          }
          break;
        case "output":
          if (
            sub &&
            msg.paneId === sub.paneId &&
            typeof msg.data === "string"
          ) {
            sub.handlers.onData(msg.data);
          }
          break;
        case "structure_changed":
          sub?.handlers.onStructureChanged?.();
          break;
        case "detached":
          failSubscription();
          break;
        case "error":
          // Includes DATA_LOCKED and subscribe failures; treat as terminal
          // for the current subscription so the caller can fall back.
          failSubscription();
          break;
        default:
          break;
      }
    };

    ws.onclose = (event) => {
      clearTimeout(handshakeTimer);
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (wsRef.current === ws) wsRef.current = null;
      connectingRef.current = false;
      if (unmountedRef.current || !subRef.current) return;

      // 1008 = auth/policy failure; retrying will not help.
      if (event.code === 1008) {
        failSubscription();
        return;
      }
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        failSubscription();
        return;
      }
      reconnectAttemptsRef.current += 1;
      setStatus("connecting");
      const delay = 1000 * 2 ** (reconnectAttemptsRef.current - 1);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!unmountedRef.current && subRef.current) void connect();
      }, delay);
    };

    ws.onerror = () => {
      // onclose follows and drives the retry logic.
    };
  }, [failSubscription]);

  const subscribe = useCallback(
    (
      hostId: number,
      sessionName: string,
      paneId: string,
      handlers: TmuxLiveHandlers,
    ) => {
      subRef.current = { hostId, sessionName, paneId, handlers };
      reconnectAttemptsRef.current = 0;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        setStatus("connecting");
        ws.send(
          JSON.stringify({ type: "subscribe", hostId, sessionName, paneId }),
        );
      } else if (!connectingRef.current) {
        void connect();
      } else {
        // A connection attempt is in flight; it will pick up subRef on open.
        setStatus("connecting");
      }
    },
    [connect],
  );

  const unsubscribe = useCallback(() => {
    subRef.current = null;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "unsubscribe" }));
    }
    if (!unmountedRef.current) setStatus("idle");
  }, []);

  useEffect(() => {
    // Reset on (re)mount -- under React StrictMode the cleanup below runs once
    // during the simulated unmount, and without this reset the hook would stay
    // permanently dead afterwards.
    unmountedRef.current = false;
    connectingRef.current = false;
    return () => {
      unmountedRef.current = true;
      subRef.current = null;
      connectingRef.current = false;
      clearTimers();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };
  }, [clearTimers]);

  return { status, subscribe, unsubscribe };
}
