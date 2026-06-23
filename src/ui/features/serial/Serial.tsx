import {
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useXTerm } from "react-xtermjs";
import { FitAddon } from "@xterm/addon-fit";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { isElectron } from "@/lib/electron";
import { isEmbeddedMode } from "@/main-axios";
import { useTheme } from "@/components/theme-provider";
import { resolveTermixThemeColors } from "@/features/terminal/terminal-theme";
import { DEFAULT_TERMINAL_CONFIG, TERMINAL_FONTS } from "@/lib/terminal-themes";
import type { SerialConfig } from "@/types/ui-types";
import type { SerialHandle } from "./serial-types";

type WebSerialPort = {
  open(options: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: string;
  }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};

interface SerialProps {
  config: SerialConfig;
  isVisible: boolean;
  instanceId: string;
}

export const Serial = forwardRef<SerialHandle, SerialProps>(function Serial(
  { config, isVisible, instanceId },
  ref,
) {
  const { t } = useTranslation();
  const { theme: appTheme } = useTheme();
  const { instance: terminal, ref: xtermRef } = useXTerm();
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const connectedRef = useRef(false);
  const webSerialReaderRef = useRef<ReadableStreamDefaultReader | null>(null);
  const webSerialWriterRef = useRef<WritableStreamDefaultWriter | null>(null);
  const webSerialPortRef = useRef<WebSerialPort | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const useWebSerial = !isElectron();

  const write = useCallback(
    (text: string) => {
      terminal?.write(text);
    },
    [terminal],
  );

  // ── Theme sync ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!terminal) return;
    const themeColors = resolveTermixThemeColors("termix", appTheme);
    const fontConfig = TERMINAL_FONTS.find(
      (f) => f.value === DEFAULT_TERMINAL_CONFIG.fontFamily,
    );
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
    terminal.options.fontFamily =
      fontConfig?.fallback ?? TERMINAL_FONTS[0].fallback;
    terminal.options.fontSize = DEFAULT_TERMINAL_CONFIG.fontSize;
  }, [terminal, appTheme]);

  // ── WebSocket (Electron) path ──────────────────────────────────────────

  const buildWsUrl = useCallback(() => {
    const isDev =
      !isElectron() &&
      process.env.NODE_ENV === "development" &&
      (window.location.port === "3000" ||
        window.location.port === "5173" ||
        window.location.port === "");

    if (isDev || isEmbeddedMode()) {
      const token = localStorage.getItem("jwt");
      const base = "ws://127.0.0.1:30011";
      return token ? `${base}?token=${encodeURIComponent(token)}` : base;
    }

    const configuredUrl = (window as { configuredServerUrl?: string | null })
      .configuredServerUrl;

    if (!configuredUrl) return null;

    const wsProtocol = configuredUrl.startsWith("https://")
      ? "wss://"
      : "ws://";
    const wsHost = configuredUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const token = localStorage.getItem("jwt");
    const base = `${wsProtocol}${wsHost}/serial/websocket/`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  }, []);

  const disconnectWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    connectedRef.current = false;
  }, []);

  const connectWs = useCallback(() => {
    disconnectWs();
    const url = buildWsUrl();
    if (!url) {
      write(`\r\n\x1b[31m${t("serial.errorNoServerUrl")}\x1b[0m\r\n`);
      return;
    }

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "connect", data: config }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          type: string;
          data?: unknown;
        };
        switch (msg.type) {
          case "connected":
            connectedRef.current = true;
            write(
              `\x1b[32m${t("serial.connected", { path: config.path, baud: config.baudRate })}\x1b[0m\r\n`,
            );
            break;
          case "data":
            if (typeof msg.data === "string") write(msg.data);
            break;
          case "disconnected":
            connectedRef.current = false;
            write(`\r\n\x1b[33m${t("serial.disconnected")}\x1b[0m\r\n`);
            break;
          case "error":
            write(
              `\r\n\x1b[31m${t("serial.connectionError")}: ${msg.data as string}\x1b[0m\r\n`,
            );
            break;
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      connectedRef.current = false;
    };

    ws.onerror = () => {
      write(`\r\n\x1b[31m${t("serial.wsError")}\x1b[0m\r\n`);
    };
  }, [buildWsUrl, config, disconnectWs, t, write]);

  // ── Web Serial API path ────────────────────────────────────────────────

  const disconnectWebSerial = useCallback(async () => {
    try {
      webSerialReaderRef.current?.cancel();
      webSerialWriterRef.current?.releaseLock();
      await webSerialPortRef.current?.close();
    } catch {
      // best-effort
    }
    webSerialReaderRef.current = null;
    webSerialWriterRef.current = null;
    webSerialPortRef.current = null;
    connectedRef.current = false;
  }, []);

  const connectWebSerial = useCallback(async () => {
    await disconnectWebSerial();

    if (!("serial" in navigator)) {
      write(`\r\n\x1b[31m${t("serial.notSupported")}\x1b[0m\r\n`);
      return;
    }

    try {
      const serial = navigator.serial as {
        requestPort(): Promise<WebSerialPort>;
      };
      const port = await serial.requestPort();
      await port.open({
        baudRate: config.baudRate,
        dataBits: config.dataBits,
        stopBits: config.stopBits,
        parity: config.parity === "none" ? "none" : config.parity,
      });

      webSerialPortRef.current = port;
      connectedRef.current = true;
      write(
        `\x1b[32m${t("serial.connected", { path: config.path || "serial", baud: config.baudRate })}\x1b[0m\r\n`,
      );

      const reader = port.readable!.getReader();
      webSerialReaderRef.current = reader;
      const decoder = new TextDecoder();

      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            write(decoder.decode(value));
          }
        } catch {
          // port closed
        } finally {
          reader.releaseLock();
          connectedRef.current = false;
          write(`\r\n\x1b[33m${t("serial.disconnected")}\x1b[0m\r\n`);
        }
      })();

      const writer = port.writable!.getWriter();
      webSerialWriterRef.current = writer;
    } catch (err) {
      if (err instanceof Error && err.name !== "NotFoundError") {
        write(
          `\r\n\x1b[31m${t("serial.connectionError")}: ${err.message}\x1b[0m\r\n`,
        );
      }
    }
  }, [config, disconnectWebSerial, t, write]);

  // ── Unified connect/disconnect ─────────────────────────────────────────

  const connect = useCallback(() => {
    if (useWebSerial) {
      connectWebSerial();
    } else {
      connectWs();
    }
  }, [useWebSerial, connectWebSerial, connectWs]);

  const disconnect = useCallback(() => {
    if (useWebSerial) {
      disconnectWebSerial();
    } else {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "disconnect" }));
      }
      disconnectWs();
    }
  }, [useWebSerial, disconnectWebSerial, disconnectWs]);

  useImperativeHandle(ref, () => ({
    connect,
    disconnect,
    isConnected: () => connectedRef.current,
    sendInput: (data: string) => {
      if (useWebSerial) {
        const encoder = new TextEncoder();
        webSerialWriterRef.current?.write(encoder.encode(data)).catch(() => {});
      } else if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data }));
      }
    },
  }));

  // ── Terminal setup ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!terminal) return;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.options.cursorBlink = DEFAULT_TERMINAL_CONFIG.cursorBlink;
    terminal.options.scrollback = DEFAULT_TERMINAL_CONFIG.scrollback;

    terminal.onData((data) => {
      if (!connectedRef.current) return;
      if (useWebSerial) {
        const encoder = new TextEncoder();
        webSerialWriterRef.current?.write(encoder.encode(data)).catch(() => {});
      } else if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "input", data }));
      }
    });

    connect();

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminal, instanceId]);

  // ── Fit on visibility change ───────────────────────────────────────────

  useEffect(() => {
    if (!isVisible || !fitAddonRef.current) return;
    try {
      fitAddonRef.current.fit();
    } catch {
      // ignore
    }
  }, [isVisible]);

  // ── ResizeObserver ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || !terminal) return;
    const observer = new ResizeObserver(() => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        // ignore
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [terminal]);

  // ── Not supported (Firefox etc.) ──────────────────────────────────────

  if (useWebSerial && !("serial" in navigator)) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-center">
        <div className="size-10 rounded-full bg-muted/40 flex items-center justify-center">
          <TriangleAlert className="size-5 text-muted-foreground/50" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-foreground">
            {t("serial.notSupportedTitle")}
          </span>
          <span className="text-xs text-muted-foreground max-w-xs">
            {t("serial.notSupported")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-full w-full">
      <div ref={xtermRef} className="flex-1 min-h-0" />
    </div>
  );
});
