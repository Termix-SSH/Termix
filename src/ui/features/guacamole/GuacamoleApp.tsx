import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  GuacamoleDisplay,
  type GuacamoleDisplayHandle,
} from "@/features/guacamole/GuacamoleDisplay.tsx";
import { FullScreenAppWrapper } from "@/features/FullScreenAppWrapper.tsx";
import { getGuacamoleTokenFromHost, getGuacdStatus } from "@/main-axios.ts";
import { useTranslation } from "react-i18next";
import { AlertCircle, RefreshCw } from "lucide-react";
import { GuacamoleToolbar } from "@/features/guacamole/GuacamoleToolbar.tsx";
import { Button } from "@/components/button.tsx";
import { SimpleLoader } from "@/lib/SimpleLoader.tsx";
import type { SSHHost } from "@/types";

interface GuacamoleAppProps {
  hostId?: string;
  tabId?: string;
  protocol?: "rdp" | "vnc" | "telnet";
}

const GuacamoleApp: React.FC<GuacamoleAppProps> = ({
  hostId,
  tabId,
  protocol,
}) => {
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

        if (!hostId) {
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
            hostId={parseInt(hostId, 10)}
            hostConfig={hostConfig}
            tabId={tabId}
            protocol={protocol}
          />
        );
      }}
    </FullScreenAppWrapper>
  );
};

interface GuacamoleAppInnerProps {
  hostId: number;
  hostConfig: Pick<SSHHost, "connectionType">;
  tabId?: string;
  protocol?: "rdp" | "vnc" | "telnet";
}

const GuacamoleAppInner: React.FC<GuacamoleAppInnerProps> = ({
  hostId,
  hostConfig,
  tabId,
  protocol,
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
          setError(t("guacamole.guacdUnavailable"));
          return;
        }
        return getGuacamoleTokenFromHost(hostId, protocol);
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

  useEffect(() => {
    if (!tabId) return;
    const handler = (e: Event) => {
      const { tabId: eventTabId } = (e as CustomEvent).detail;
      if (eventTabId === tabId) handleReconnect();
    };
    window.addEventListener("termix:refresh-guacamole", handler);
    return () =>
      window.removeEventListener("termix:refresh-guacamole", handler);
  }, [tabId, handleReconnect]);

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
            type: (
              protocol ||
              hostConfig.connectionType ||
              "remote"
            ).toUpperCase(),
          })}
        />
      </div>
    );
  }

  const resolvedProtocol = (protocol ?? hostConfig.connectionType) as
    | "rdp"
    | "vnc"
    | "telnet";

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
        key={token}
        ref={displayRef}
        connectionConfig={{
          token,
          protocol: resolvedProtocol,
          type: resolvedProtocol,
        }}
        isVisible={true}
        onError={(err) => setConnectionError(err)}
      />
      <GuacamoleToolbar
        displayRef={displayRef}
        protocol={resolvedProtocol}
        onReconnect={handleReconnect}
      />
    </div>
  );
};

export default GuacamoleApp;
