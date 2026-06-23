import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
} from "react";
import {
  GuacamoleDisplay,
  type GuacamoleDisplayHandle,
} from "@/features/guacamole/GuacamoleDisplay.tsx";
import {
  getGuacamoleTokenFromHost,
  getGuacdStatus,
  getSSHHosts,
  logActivity,
} from "@/main-axios.ts";
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

export interface GuacamoleAppHandle {
  disconnect: () => void;
  isConnected: () => boolean;
}

const GuacamoleApp = React.forwardRef<GuacamoleAppHandle, GuacamoleAppProps>(
  function GuacamoleApp({ hostId, tabId, protocol }, ref) {
    const { t } = useTranslation();
    const [hostConfig, setHostConfig] = useState<SSHHost | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      if (!hostId) {
        setLoading(false);
        return;
      }
      getSSHHosts()
        .then((hosts) => {
          const host = hosts.find((h) => h.id === parseInt(hostId, 10));
          setHostConfig(host ?? null);
        })
        .catch(() => setHostConfig(null))
        .finally(() => setLoading(false));
    }, [hostId]);

    if (loading) {
      return (
        <div className="relative w-full h-full">
          <SimpleLoader visible={true} message={t("common.loading")} />
        </div>
      );
    }

    if (!hostConfig || !hostId) {
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
        hostName={hostConfig.name || hostConfig.ip || String(hostId)}
        tabId={tabId}
        protocol={protocol}
        ref={ref}
      />
    );
  },
);

interface GuacamoleAppInnerProps {
  hostId: number;
  hostConfig: Pick<SSHHost, "connectionType">;
  hostName: string;
  tabId?: string;
  protocol?: "rdp" | "vnc" | "telnet";
}

const GuacamoleAppInner = React.forwardRef<
  GuacamoleAppHandle,
  GuacamoleAppInnerProps
>(function GuacamoleAppInner(
  { hostId, hostConfig, hostName, tabId, protocol },
  ref,
) {
  const { t } = useTranslation();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const displayRef = useRef<GuacamoleDisplayHandle>(null);

  useImperativeHandle(ref, () => ({
    disconnect: () => displayRef.current?.disconnect(),
    isConnected: () => displayRef.current?.isConnected() === true,
  }));

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
        if (result) {
          setToken(result.token);
          const resolvedProtocol = (protocol ??
            hostConfig.connectionType ??
            "rdp") as "rdp" | "vnc" | "telnet";
          logActivity(resolvedProtocol, hostId, hostName).catch(() => {});
        }
      })
      .catch((err) => setError(err?.message || t("guacamole.failedToConnect")));
  }, [hostConfig.connectionType, hostId, hostName, protocol, retryCount, t]);

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
      <GuacamoleToolbar displayRef={displayRef} protocol={resolvedProtocol} />
    </div>
  );
});

export default GuacamoleApp;
