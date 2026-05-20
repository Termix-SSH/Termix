import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  GuacamoleDisplay,
  type GuacamoleDisplayHandle,
} from "@/features/guacamole/GuacamoleDisplay.tsx";
import { FullScreenAppWrapper } from "@/features/FullScreenAppWrapper.tsx";
import { getGuacamoleTokenFromHost, getGuacdStatus } from "@/main-axios.ts";
import { useTranslation } from "react-i18next";
import { AlertCircle, RefreshCw, Keyboard } from "lucide-react";
import { Button } from "@/components/button.tsx";
import { SimpleLoader } from "@/lib/SimpleLoader.tsx";
import type { SSHHost } from "@/types";

interface GuacamoleAppProps {
  hostId?: string;
}

const GuacamoleApp: React.FC<GuacamoleAppProps> = ({ hostId }) => {
  const { t } = useTranslation();

  return (
    <FullScreenAppWrapper hostId={hostId}>
      {(hostConfig, loading) => {
        if (loading) {
          return (
            <div className="relative w-full h-full">
              <SimpleLoader visible={true} message={t("common.loading")} />
            </div>
          );
        }

        if (!hostConfig) {
          return (
            <div
              className="flex flex-col items-center justify-center h-full gap-4"
              style={{ backgroundColor: "var(--bg-base)" }}
            >
              <AlertCircle
                className="size-10"
                style={{ color: "var(--foreground)" }}
              />
              <span
                className="text-sm font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                {t("guacamole.hostNotFound")}
              </span>
            </div>
          );
        }

        return (
          <GuacamoleAppInner
            hostId={parseInt(hostId!, 10)}
            hostConfig={hostConfig}
          />
        );
      }}
    </FullScreenAppWrapper>
  );
};

interface GuacamoleAppInnerProps {
  hostId: number;
  hostConfig: Pick<SSHHost, "connectionType">;
}

const GuacamoleAppInner: React.FC<GuacamoleAppInnerProps> = ({
  hostId,
  hostConfig,
}) => {
  const { t } = useTranslation();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const displayRef = useRef<GuacamoleDisplayHandle>(null);

  useEffect(() => {
    setToken(null);
    setError(null);
    getGuacdStatus()
      .then((status) => {
        if (status.guacd.status !== "connected") {
          setError(
            "Remote desktop service (guacd) is not available. Please ensure guacd is running and accessible and configured properly in admin settings.",
          );
          return;
        }
        return getGuacamoleTokenFromHost(hostId);
      })
      .then((result) => {
        if (result) setToken(result.token);
      })
      .catch((err) => setError(err?.message || t("guacamole.failedToConnect")));
  }, [hostId, retryCount]);

  const handleReconnect = useCallback(() => {
    setConnectionError(null);
    setError(null);
    setToken(null);
    setRetryCount((c) => c + 1);
  }, []);

  const sendCtrlAltDelete = useCallback(() => {
    const display = displayRef.current;
    if (!display) return;
    // keysyms: Control_L=0xffe3, Alt_L=0xffe9, Delete=0xffff
    display.sendKey(0xffe3, true);
    display.sendKey(0xffe9, true);
    display.sendKey(0xffff, true);
    display.sendKey(0xffff, false);
    display.sendKey(0xffe9, false);
    display.sendKey(0xffe3, false);
  }, []);

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-4"
        style={{ backgroundColor: "var(--bg-base)" }}
      >
        <AlertCircle
          className="size-10"
          style={{ color: "var(--foreground)" }}
        />
        <p
          className="text-sm font-semibold"
          style={{ color: "var(--foreground)" }}
        >
          {t("guacamole.connectionFailed")}
        </p>
        <p
          className="text-xs max-w-xs text-center"
          style={{ color: "var(--foreground-secondary)" }}
        >
          {error}
        </p>
        <Button variant="outline" size="sm" onClick={handleReconnect}>
          <RefreshCw className="size-4 mr-2" />
          {t("guacamole.retry")}
        </Button>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="relative w-full h-full">
        <SimpleLoader
          visible={true}
          message={t("guacamole.connecting", {
            type: (hostConfig.connectionType || "remote").toUpperCase(),
          })}
        />
      </div>
    );
  }

  const protocol = hostConfig.connectionType as "rdp" | "vnc" | "telnet";

  return (
    <div className="relative w-full h-full">
      {connectionError && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-50"
          style={{ backgroundColor: "var(--bg-base)" }}
        >
          <AlertCircle
            className="size-10"
            style={{ color: "var(--foreground)" }}
          />
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--foreground)" }}
          >
            {t("guacamole.connectionFailed")}
          </p>
          <p
            className="text-xs max-w-xs text-center"
            style={{ color: "var(--foreground-secondary)" }}
          >
            {connectionError}
          </p>
          <Button variant="outline" size="sm" onClick={handleReconnect}>
            <RefreshCw className="size-4 mr-2" />
            {t("guacamole.reconnect")}
          </Button>
        </div>
      )}
      <GuacamoleDisplay
        ref={displayRef}
        connectionConfig={{ token, protocol, type: protocol }}
        isVisible={true}
        onError={(err) => setConnectionError(err)}
      />
      {(protocol === "rdp" || protocol === "vnc") && (
        <button
          onClick={sendCtrlAltDelete}
          title="Ctrl+Alt+Delete"
          className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider bg-background/80 backdrop-blur border border-border rounded hover:bg-muted transition-colors opacity-60 hover:opacity-100"
        >
          <Keyboard className="size-3" />
          Ctrl+Alt+Del
        </button>
      )}
    </div>
  );
};

export default GuacamoleApp;
