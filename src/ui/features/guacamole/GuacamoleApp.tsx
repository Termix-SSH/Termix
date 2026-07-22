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
  type GuacamoleTouchMode,
} from "@/features/guacamole/GuacamoleDisplay.tsx";
import {
  getGuacamoleTokenFromHost,
  getGuacdStatus,
  getSSHHosts,
  logActivity,
  isElectron,
} from "@/main-axios.ts";
import { resolveConnectionOrigin } from "@/lib/connection-origin.ts";
import { useTranslation } from "react-i18next";
import { AlertCircle, RefreshCw } from "lucide-react";
import { GuacamoleToolbar } from "@/features/guacamole/GuacamoleToolbar.tsx";
import { Button } from "@/components/button.tsx";
import { Input } from "@/components/input.tsx";
import { PasswordInput } from "@/components/password-input.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog.tsx";
import { SimpleLoader } from "@/lib/SimpleLoader.tsx";
import { ShareSessionModal } from "@/features/session-sharing/ShareSessionModal.tsx";
import type { SSHHost } from "@/types";

interface GuacamoleAppProps {
  hostId?: string;
  tabId?: string;
  protocol?: "rdp" | "vnc" | "telnet";
  isVisible?: boolean;
}

export interface GuacamoleAppHandle {
  disconnect: () => void;
  isConnected: () => boolean;
  openShareModal: () => void;
  canShare: () => boolean;
}

const GuacamoleApp = React.forwardRef<GuacamoleAppHandle, GuacamoleAppProps>(
  function GuacamoleApp({ hostId, tabId, protocol, isVisible = true }, ref) {
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
        isVisible={isVisible}
        ref={ref}
      />
    );
  },
);

interface GuacamoleAppInnerProps {
  hostId: number;
  hostConfig: Pick<
    SSHHost,
    "connectionType" | "guacamoleConfig" | "rdpAuthType"
  >;
  hostName: string;
  tabId?: string;
  protocol?: "rdp" | "vnc" | "telnet";
  isVisible: boolean;
}

const GuacamoleAppInner = React.forwardRef<
  GuacamoleAppHandle,
  GuacamoleAppInnerProps
>(function GuacamoleAppInner(
  { hostId, hostConfig, hostName, tabId, protocol, isVisible },
  ref,
) {
  const { t } = useTranslation();
  const [token, setToken] = useState<string | null>(null);
  const [guacamoleConnectionId, setGuacamoleConnectionId] = useState<
    string | null
  >(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [touchMode, setTouchMode] = useState<GuacamoleTouchMode | null>(() =>
    typeof window !== "undefined" &&
    (navigator.maxTouchPoints > 0 || "ontouchstart" in window)
      ? "touchscreen"
      : null,
  );
  const displayRef = useRef<GuacamoleDisplayHandle>(null);

  const resolvedProtocolForConnect = (protocol ??
    hostConfig.connectionType ??
    "rdp") as "rdp" | "vnc" | "telnet";
  const needsCredentialPrompt =
    resolvedProtocolForConnect === "rdp" && hostConfig.rdpAuthType === "none";

  const [promptedCredentials, setPromptedCredentials] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const [promptOpen, setPromptOpen] = useState(needsCredentialPrompt);
  const [promptUsername, setPromptUsername] = useState("");
  const [promptPassword, setPromptPassword] = useState("");

  useImperativeHandle(ref, () => ({
    disconnect: () => displayRef.current?.disconnect(),
    isConnected: () => displayRef.current?.isConnected() === true,
    openShareModal: () => setShareModalOpen(true),
    canShare: () => guacamoleConnectionId !== null,
  }));

  useEffect(() => {
    if (needsCredentialPrompt && !promptedCredentials) {
      setPromptOpen(true);
      return;
    }

    setToken(null);
    setGuacamoleConnectionId(null);
    setError(null);

    (async () => {
      if (isElectron()) {
        const origin = await resolveConnectionOrigin({
          connectionType: resolvedProtocolForConnect,
        });
        if (origin === "remote") {
          const remoteConfig = (await window.electronAPI?.invoke?.(
            "get-remote-sync-config",
          )) as { serverUrl?: string } | null;
          if (!remoteConfig?.serverUrl) {
            setError(t("errors.remoteServerRequired"));
            return;
          }
        }
      }

      try {
        const status = await getGuacdStatus();
        if (status.guacd.status !== "connected") {
          setError(t("guacamole.guacdUnavailable"));
          return;
        }
        const result = await getGuacamoleTokenFromHost(
          hostId,
          protocol,
          promptedCredentials ?? undefined,
        );
        if (result) {
          setToken(result.token);
          setGuacamoleConnectionId(result.guacamoleConnectionId ?? null);
          logActivity(resolvedProtocolForConnect, hostId, hostName).catch(
            () => {},
          );
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : t("guacamole.failedToConnect");
        setError(message || t("guacamole.failedToConnect"));
      }
    })();
  }, [
    hostId,
    hostName,
    protocol,
    retryCount,
    t,
    needsCredentialPrompt,
    promptedCredentials,
    resolvedProtocolForConnect,
  ]);

  const handleReconnect = useCallback(() => {
    setConnectionError(null);
    setError(null);
    setToken(null);
    if (needsCredentialPrompt) {
      setPromptedCredentials(null);
      setPromptUsername("");
      setPromptPassword("");
      setPromptOpen(true);
    }
    setRetryCount((c) => c + 1);
  }, [needsCredentialPrompt]);

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

  if (promptOpen) {
    return (
      <Dialog
        open={promptOpen}
        onOpenChange={(open) => {
          if (!open) setPromptOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {t("guacamole.credentialPromptTitle")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("guacamole.credentialPromptDescription")}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4 mt-1"
            onSubmit={(e) => {
              e.preventDefault();
              setPromptedCredentials({
                username: promptUsername,
                password: promptPassword,
              });
              setPromptOpen(false);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold">
                {t("hosts.guac.username")}
              </label>
              <Input
                autoFocus
                placeholder="Administrator"
                value={promptUsername}
                onChange={(e) => setPromptUsername(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold">
                {t("hosts.guac.password")}
              </label>
              <PasswordInput
                className="h-8 text-xs pr-8"
                placeholder="••••••••"
                value={promptPassword}
                onChange={(e) => setPromptPassword(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-end gap-2 mt-2">
              <Button type="submit" variant="outline">
                {t("guacamole.connect")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    );
  }

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

  const resolvedProtocol = resolvedProtocolForConnect;
  const configuredDpi = Number(hostConfig.guacamoleConfig?.dpi);

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
        key={`${token}-${touchMode}`}
        ref={displayRef}
        connectionConfig={{
          token,
          protocol: resolvedProtocol,
          type: resolvedProtocol,
          dpi:
            Number.isFinite(configuredDpi) && configuredDpi > 0
              ? configuredDpi
              : undefined,
        }}
        isVisible={isVisible}
        touchMode={touchMode}
        onError={(err) => setConnectionError(err)}
      />
      <GuacamoleToolbar
        displayRef={displayRef}
        protocol={resolvedProtocol}
        touchMode={touchMode}
        onTouchModeChange={setTouchMode}
      />
      {shareModalOpen && guacamoleConnectionId && (
        <ShareSessionModal
          open={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          hostId={hostId}
          sessionId={guacamoleConnectionId}
          protocol={resolvedProtocol}
          tabInstanceId={tabId}
        />
      )}
    </div>
  );
});

export default GuacamoleApp;
