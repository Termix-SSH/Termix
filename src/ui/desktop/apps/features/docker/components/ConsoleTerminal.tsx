import React from "react";
import { useXTerm } from "react-xtermjs";
import { FitAddon } from "@xterm/addon-fit";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Button } from "@/components/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Terminal as TerminalIcon, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import type { SSHHost } from "@/types";
import { getCookie, isElectron } from "@/ui/main-axios.ts";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";
import { useTranslation } from "react-i18next";

interface ConsoleTerminalProps {
  sessionId: string;
  containerId: string;
  containerName: string;
  containerState: string;
  hostConfig: SSHHost;
}

export function ConsoleTerminal({
  sessionId,
  containerId,
  containerName,
  containerState,
  hostConfig,
}: ConsoleTerminalProps): React.ReactElement {
  const { t } = useTranslation();
  const { instance: terminal, ref: xtermRef } = useXTerm();
  const [isConnected, setIsConnected] = React.useState(false);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [selectedShell, setSelectedShell] = React.useState<string>("bash");
  const wsRef = React.useRef<WebSocket | null>(null);
  const fitAddonRef = React.useRef<FitAddon | null>(null);
  const pingIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

  const getWebSocketBaseUrl = React.useCallback(() => {
    const isElectronApp = isElectron();

    const isDev =
      !isElectronApp &&
      process.env.NODE_ENV === "development" &&
      (window.location.port === "3000" ||
        window.location.port === "5173" ||
        window.location.port === "");

    if (isDev) {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//localhost:30008`;
    }

    if (isElectronApp) {
      const baseUrl =
        (window as { configuredServerUrl?: string }).configuredServerUrl ||
        "http://127.0.0.1:30001";
      const wsProtocol = baseUrl.startsWith("https://") ? "wss://" : "ws://";
      const wsHost = baseUrl.replace(/^https?:\/\//, "");
      return `${wsProtocol}${wsHost}/docker/console/`;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/docker/console/`;
  }, []);

  React.useEffect(() => {
    if (!terminal) return;

    const fitAddon = new FitAddon();
    const clipboardAddon = new ClipboardAddon();
    const webLinksAddon = new WebLinksAddon();

    fitAddonRef.current = fitAddon;

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(clipboardAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.options.cursorBlink = true;
    terminal.options.fontSize = 14;
    terminal.options.fontFamily = "monospace";

    const backgroundColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--bg-elevated")
      .trim();
    const foregroundColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--foreground")
      .trim();

    terminal.options.theme = {
      background: backgroundColor || "var(--bg-elevated)",
      foreground: foregroundColor || "var(--foreground)",
    };

    setTimeout(() => {
      fitAddon.fit();
    }, 100);

    const resizeHandler = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const { rows, cols } = terminal;
          wsRef.current.send(
            JSON.stringify({
              type: "resize",
              data: { rows, cols },
            }),
          );
        }
      }
    };

    window.addEventListener("resize", resizeHandler);

    return () => {
      window.removeEventListener("resize", resizeHandler);

      if (wsRef.current) {
        try {
          wsRef.current.send(JSON.stringify({ type: "disconnect" }));
        } catch (error) {}
        wsRef.current.close();
        wsRef.current = null;
      }

      terminal.dispose();
    };
  }, [terminal]);

  const disconnect = React.useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.send(JSON.stringify({ type: "disconnect" }));
      } catch (error) {}
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    if (terminal) {
      try {
        terminal.clear();
      } catch (error) {}
    }
  }, [terminal, t]);

  const connect = React.useCallback(() => {
    if (!terminal || containerState !== "running") {
      toast.error(t("docker.containerMustBeRunning"));
      return;
    }

    setIsConnecting(true);

    try {
      const token = isElectron()
        ? localStorage.getItem("jwt")
        : getCookie("jwt");
      if (!token) {
        toast.error(t("docker.authenticationRequired"));
        setIsConnecting(false);
        return;
      }

      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }

      const wsUrl = `${getWebSocketBaseUrl()}?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        const cols = terminal.cols || 80;
        const rows = terminal.rows || 24;

        ws.send(
          JSON.stringify({
            type: "connect",
            data: {
              hostConfig,
              containerId,
              shell: selectedShell,
              cols,
              rows,
            },
          }),
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case "output":
              terminal.write(msg.data);
              break;

            case "connected":
              setIsConnected(true);
              setIsConnecting(false);

              if (msg.data?.shellChanged) {
                toast.warning(
                  `Shell "${msg.data.requestedShell}" not available. Using "${msg.data.shell}" instead.`,
                );
              } else {
                toast.success(t("docker.connectedTo", { containerName }));
              }

              setTimeout(() => {
                if (fitAddonRef.current) {
                  fitAddonRef.current.fit();
                }

                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      type: "resize",
                      data: { rows: terminal.rows, cols: terminal.cols },
                    }),
                  );
                }
              }, 100);
              break;

            case "disconnected":
              setIsConnected(false);
              setIsConnecting(false);
              terminal.write(
                `\r\n\x1b[1;33m${msg.message || t("docker.disconnected")}\x1b[0m\r\n`,
              );
              if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
              }
              break;

            case "error":
              setIsConnecting(false);
              toast.error(msg.message || t("docker.consoleError"));
              terminal.write(
                `\r\n\x1b[1;31m${t("docker.errorMessage", { message: msg.message })}\x1b[0m\r\n`,
              );
              break;
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setIsConnecting(false);
        setIsConnected(false);
        toast.error(t("docker.failedToConnect"));
      };

      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 30000);

      ws.onclose = () => {
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        setIsConnected(false);
        setIsConnecting(false);
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
      };

      wsRef.current = ws;

      terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "input",
              data,
            }),
          );
        }
      });
    } catch (error) {
      setIsConnecting(false);
      toast.error(
        `Failed to connect: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [
    terminal,
    containerState,
    getWebSocketBaseUrl,
    hostConfig,
    containerId,
    selectedShell,
    containerName,
  ]);

  React.useEffect(() => {
    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.send(JSON.stringify({ type: "disconnect" }));
        } catch (error) {}
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsConnected(false);
    };
  }, []);

  if (containerState !== "running") {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <TerminalIcon className="h-12 w-12 text-muted-foreground/50 mx-auto" />
          <p className="text-muted-foreground text-lg">
            {t("docker.containerNotRunning")}
          </p>
          <p className="text-muted-foreground text-sm">
            {t("docker.startContainerToAccess")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-3">
      <Card className="py-3">
        <CardContent className="px-3">
          <div className="flex flex-col sm:flex-row gap-2 items-center sm:items-center">
            <div className="flex items-center gap-2 flex-1">
              <TerminalIcon className="h-5 w-5" />
              <span className="text-base font-medium">
                {t("docker.console")}
              </span>
            </div>
            <Select
              value={selectedShell}
              onValueChange={setSelectedShell}
              disabled={isConnected}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder={t("docker.selectShell")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bash">{t("docker.bash")}</SelectItem>
                <SelectItem value="sh">{t("docker.sh")}</SelectItem>
                <SelectItem value="ash">{t("docker.ash")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2 sm:gap-2">
              {!isConnected ? (
                <Button
                  onClick={connect}
                  disabled={isConnecting}
                  className="min-w-[120px]"
                >
                  {isConnecting ? (
                    <>
                      <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                      {t("docker.connecting")}
                    </>
                  ) : (
                    <>
                      <Power className="h-4 w-4 mr-2" />
                      {t("docker.connect")}
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={disconnect}
                  variant="destructive"
                  className="min-w-[120px]"
                >
                  <PowerOff className="h-4 w-4 mr-2" />
                  {t("docker.disconnect")}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="flex-1 overflow-hidden pt-1 pb-0">
        <CardContent className="p-0 h-full relative">
          <div
            ref={xtermRef}
            className="h-full w-full"
            style={{ display: isConnected ? "block" : "none" }}
          />

          {!isConnected && !isConnecting && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-2">
                <TerminalIcon className="h-12 w-12 text-muted-foreground/50 mx-auto" />
                <p className="text-muted-foreground">
                  {t("docker.notConnected")}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t("docker.clickToConnect")}
                </p>
              </div>
            </div>
          )}

          {isConnecting && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <SimpleLoader size="lg" />
                <p className="text-muted-foreground mt-4">
                  {t("docker.connectingTo", { containerName })}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
