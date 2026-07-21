import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useXTerm } from "react-xtermjs";
import { FitAddon } from "@xterm/addon-fit";
import { AlertCircle, Eye } from "lucide-react";
import {
  resolveShareLink,
  type ResolvedShareLink,
  type ShareLinkErrorKind,
} from "@/api/session-sharing-api";
import { SimpleLoader } from "@/lib/SimpleLoader.tsx";
import { getBasePath } from "@/lib/base-path";
import { isElectron } from "@/lib/electron";
import { getServerConfig } from "@/main-axios";
import { GuacamoleDisplay } from "@/features/guacamole/GuacamoleDisplay.tsx";

const PING_INTERVAL_MS = 30000;

interface TerminalWsMessage {
  type: string;
  data?: string;
  [key: string]: unknown;
}

// Mirrors Terminal.tsx's baseWsUrl construction (dev/electron/embedded/prod).
// Duplicated rather than extracted from that file to avoid touching it here.
async function resolveTerminalWsBaseUrl(): Promise<string> {
  const isDev =
    !isElectron() &&
    process.env.NODE_ENV === "development" &&
    (window.location.port === "3000" ||
      window.location.port === "5173" ||
      window.location.port === "");

  if (isDev) {
    return `${window.location.protocol === "https:" ? "wss" : "ws"}://localhost:30002`;
  }
  if (isElectron()) {
    const serverConfig = await getServerConfig();
    const configuredUrl = serverConfig?.serverUrl;
    if (configuredUrl) {
      const wsProtocol = configuredUrl.startsWith("https://")
        ? "wss://"
        : "ws://";
      const wsHost = configuredUrl
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, "");
      return `${wsProtocol}${wsHost}/ssh/websocket/`;
    }
    return "ws://127.0.0.1:30002";
  }
  const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${wsProtocol}://${window.location.host}${getBasePath()}/ssh/websocket/`;
}

function ReadOnlyBadge({ label }: { label: string }) {
  return (
    <div
      className="absolute top-3 right-3 z-20 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
      style={{
        backgroundColor: "var(--bg-elevated, rgba(0,0,0,0.6))",
        color: "var(--foreground)",
        border: "1px solid var(--border-base)",
      }}
    >
      <Eye className="size-3.5" />
      {label}
    </div>
  );
}

function CenteredMessage({
  icon,
  message,
}: {
  icon: React.ReactNode;
  message: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full gap-4 w-full"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      {icon}
      <p
        className="text-sm font-semibold text-center max-w-xs"
        style={{ color: "var(--foreground)" }}
      >
        {message}
      </p>
    </div>
  );
}

function GuestTerminalView({
  share,
  linkToken,
}: {
  share: ResolvedShareLink;
  linkToken: string;
}) {
  const { t } = useTranslation();
  const { instance: terminal, ref: xtermRef } = useXTerm();
  const [ended, setEnded] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!terminal || !xtermRef.current) return;

    terminal.options.theme = { background: "#0c0d0b" };

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(xtermRef.current);
    fitAddon.fit();

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(xtermRef.current);

    let cancelled = false;
    let ws: WebSocket | null = null;

    resolveTerminalWsBaseUrl().then((baseWsUrl) => {
      if (cancelled) return;
      const separator = baseWsUrl.includes("?") ? "&" : "?";
      ws = new WebSocket(
        `${baseWsUrl}${separator}shareToken=${encodeURIComponent(linkToken)}`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        pingIntervalRef.current = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        let msg: TerminalWsMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case "data":
            if (typeof msg.data === "string") terminal.write(msg.data);
            break;
          case "sessionExpired":
          case "sessionTerminatedByOwner":
          case "session_ended":
            setEnded(t("sessionSharing.guestView.sessionEnded"));
            break;
          default:
            break;
        }
      };

      ws.onclose = () => {
        setEnded((prev) => prev ?? t("sessionSharing.guestView.sessionEnded"));
      };

      if (share.permissionLevel === "read-write") {
        terminal.onData((data) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input", data }));
          }
        });
      }
    });

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      ws?.close();
      wsRef.current = null;
    };
    // Deliberately runs once terminal mounts - share/token/permission are stable for the view's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminal, linkToken]);

  return (
    <div className="relative w-full h-full">
      {share.permissionLevel === "read-only" && (
        <ReadOnlyBadge label={t("sessionSharing.guestView.readOnlyBadge")} />
      )}
      {ended && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center"
          style={{ backgroundColor: "var(--bg-base)" }}
        >
          <CenteredMessage
            icon={
              <AlertCircle
                className="size-10"
                style={{ color: "var(--foreground)" }}
              />
            }
            message={ended}
          />
        </div>
      )}
      <div ref={xtermRef} className="w-full h-full" />
    </div>
  );
}

function GuestGuacamoleView({ share }: { share: ResolvedShareLink }) {
  const { t } = useTranslation();
  const [connectionError, setConnectionError] = useState<string | null>(null);

  if (!share.connectParams?.token) {
    return (
      <CenteredMessage
        icon={
          <AlertCircle
            className="size-10"
            style={{ color: "var(--foreground)" }}
          />
        }
        message={t("sessionSharing.guestView.linkInvalid")}
      />
    );
  }

  return (
    <div className="relative w-full h-full">
      {share.permissionLevel === "read-only" && (
        <ReadOnlyBadge label={t("sessionSharing.guestView.readOnlyBadge")} />
      )}
      {connectionError && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center"
          style={{ backgroundColor: "var(--bg-base)" }}
        >
          <CenteredMessage
            icon={
              <AlertCircle
                className="size-10"
                style={{ color: "var(--foreground)" }}
              />
            }
            message={connectionError}
          />
        </div>
      )}
      <GuacamoleDisplay
        connectionConfig={{
          token: share.connectParams.token,
          protocol: share.protocol as "rdp" | "vnc" | "telnet",
          type: share.protocol as "rdp" | "vnc" | "telnet",
        }}
        isVisible={true}
        onError={(err) => setConnectionError(err)}
      />
    </div>
  );
}

export default function SharedSessionView() {
  const { t } = useTranslation();
  const [share, setShare] = useState<ResolvedShareLink | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      setError(t("sessionSharing.guestView.linkInvalid"));
      setLoading(false);
      return;
    }
    setLinkToken(token);

    resolveShareLink(token)
      .then((resolved) => setShare(resolved))
      .catch((err) => {
        const kind = (err as { kind?: ShareLinkErrorKind })?.kind;
        if (kind === "rate-limited") {
          setError(t("sessionSharing.guestView.rateLimited"));
        } else {
          setError(t("sessionSharing.guestView.linkInvalid"));
        }
      })
      .finally(() => setLoading(false));
  }, [t]);

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      <div className="relative flex-1 min-h-0">
        {loading && (
          <SimpleLoader
            visible={true}
            message={t("sessionSharing.guestView.loading")}
          />
        )}
        {!loading && error && (
          <CenteredMessage
            icon={
              <AlertCircle
                className="size-10"
                style={{ color: "var(--foreground)" }}
              />
            }
            message={error}
          />
        )}
        {!loading &&
          !error &&
          share &&
          linkToken &&
          (share.protocol === "ssh" ? (
            <GuestTerminalView share={share} linkToken={linkToken} />
          ) : (
            <GuestGuacamoleView share={share} />
          ))}
      </div>
    </div>
  );
}
