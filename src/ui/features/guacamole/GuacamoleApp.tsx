import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useImperativeHandle,
} from "react";
import type Guacamole from "guacamole-common-js";
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
import { readConfiguredDimension } from "@/features/guacamole/guacamole-display-size.ts";
import { parseGuacamoleConfig } from "@/api/guacamole-api";
import { resolveConnectionOrigin } from "@/lib/connection-origin.ts";
import { useTranslation } from "react-i18next";
import { GuacamoleToolbar } from "@/features/guacamole/GuacamoleToolbar.tsx";
import { GuacamoleFileBrowser } from "@/features/guacamole/GuacamoleFileBrowser.tsx";
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
import { ConnectionScreen } from "@/components/connection/ConnectionScreen.tsx";
import {
  ConnectionLogProvider,
  useConnectionLog,
} from "@/ssh/connection-log/ConnectionLogContext.tsx";
import { useConnectionRetry } from "@/lib/useConnectionRetry.ts";
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
          <ConnectionScreen status="connecting" message={t("common.loading")} />
        </div>
      );
    }

    if (!hostConfig || !hostId) {
      return (
        <div className="relative w-full h-full">
          <ConnectionScreen
            status="disconnected"
            message={t("guacamole.hostNotFound")}
          />
        </div>
      );
    }

    return (
      <ConnectionLogProvider>
        <GuacamoleAppInner
          hostId={parseInt(hostId, 10)}
          hostConfig={hostConfig}
          hostName={hostConfig.name || hostConfig.ip || String(hostId)}
          tabId={tabId}
          protocol={protocol}
          isVisible={isVisible}
          ref={ref}
        />
      </ConnectionLogProvider>
    );
  },
);

interface GuacamoleAppInnerProps {
  hostId: number;
  hostConfig: Pick<
    SSHHost,
    "connectionType" | "domain" | "guacamoleConfig" | "rdpAuthType"
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
  const { addLog, clearLogs } = useConnectionLog();
  const [token, setToken] = useState<string | null>(null);
  const [guacamoleConnectionId, setGuacamoleConnectionId] = useState<
    string | null
  >(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isDisplayReady, setIsDisplayReady] = useState(false);
  const [touchMode, setTouchMode] = useState<GuacamoleTouchMode | null>(() =>
    typeof window !== "undefined" &&
    (navigator.maxTouchPoints > 0 || "ontouchstart" in window)
      ? "touchscreen"
      : null,
  );
  const displayRef = useRef<GuacamoleDisplayHandle>(null);
  const [filesystem, setFilesystem] = useState<Guacamole.Object | null>(null);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<File[]>([]);

  const guacConfig = parseGuacamoleConfig(hostConfig.guacamoleConfig);
  const allowUpload = guacConfig.disableUpload !== true;
  const allowDownload = guacConfig.disableDownload !== true;

  // A dropped file has nowhere to go until the browser is showing the target
  // directory, so opening it is part of accepting the drop.
  const handleDropFiles = useCallback((files: File[]) => {
    setPendingUploads(files);
    setFileBrowserOpen(true);
  }, []);

  const resolvedProtocolForConnect = (protocol ??
    hostConfig.connectionType ??
    "rdp") as "rdp" | "vnc" | "telnet";
  const needsCredentialPrompt =
    resolvedProtocolForConnect === "rdp" && hostConfig.rdpAuthType === "none";

  const [promptedCredentials, setPromptedCredentials] = useState<{
    username: string;
    password: string;
    domain: string;
  } | null>(null);
  const [promptOpen, setPromptOpen] = useState(needsCredentialPrompt);
  const [promptUsername, setPromptUsername] = useState("");
  const [promptPassword, setPromptPassword] = useState("");
  const [promptDomain, setPromptDomain] = useState(hostConfig.domain ?? "");

  useImperativeHandle(ref, () => ({
    disconnect: () => displayRef.current?.disconnect(),
    isConnected: () => displayRef.current?.isConnected() === true,
    openShareModal: () => setShareModalOpen(true),
    canShare: () => guacamoleConnectionId !== null,
  }));

  const fetchToken = useCallback(async (): Promise<void> => {
    setToken(null);
    setGuacamoleConnectionId(null);
    setError(null);

    if (isElectron()) {
      const origin = await resolveConnectionOrigin({
        connectionType: resolvedProtocolForConnect,
      });
      if (origin === "remote") {
        const remoteConfig = (await window.electronAPI?.invoke?.(
          "get-remote-sync-config",
        )) as { serverUrl?: string } | null;
        if (!remoteConfig?.serverUrl) {
          throw new Error(t("errors.remoteServerRequired"));
        }
      }
    }

    addLog({
      type: "info",
      stage: "guac_guacd",
      message: t("guacamole.connecting", {
        type: resolvedProtocolForConnect.toUpperCase(),
      }),
    });
    const status = await getGuacdStatus();
    if (status.guacd.status !== "connected") {
      throw new Error(t("guacamole.guacdUnavailable"));
    }

    addLog({
      type: "info",
      stage: "guac_token",
      message: t("guacamole.connecting", {
        type: resolvedProtocolForConnect.toUpperCase(),
      }),
    });
    const result = await getGuacamoleTokenFromHost(
      hostId,
      protocol,
      promptedCredentials ?? undefined,
    );
    if (result) {
      setToken(result.token);
      setGuacamoleConnectionId(result.guacamoleConnectionId ?? null);
      logActivity(resolvedProtocolForConnect, hostId, hostName).catch(() => {});
    }
  }, [
    hostId,
    hostName,
    protocol,
    promptedCredentials,
    resolvedProtocolForConnect,
    addLog,
    t,
  ]);

  const tokenRetry = useConnectionRetry({
    connect: async () => {
      try {
        await fetchToken();
        tokenRetryRef.current.markConnected();
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : t("guacamole.failedToConnect");
        setError(message || t("guacamole.failedToConnect"));
        addLog({ type: "error", stage: "error", message });
        tokenRetryRef.current.markFailed();
      }
    },
    enabled: !needsCredentialPrompt || !!promptedCredentials,
    autoStart: false,
  });
  const tokenRetryRef = useRef(tokenRetry);
  tokenRetryRef.current = tokenRetry;

  useEffect(() => {
    if (needsCredentialPrompt && !promptedCredentials) {
      setPromptOpen(true);
      return;
    }
    clearLogs();
    tokenRetryRef.current.reset();
    tokenRetryRef.current.retryNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, protocol, needsCredentialPrompt, promptedCredentials]);

  const handleReconnect = useCallback(() => {
    setConnectionError(null);
    setError(null);
    setToken(null);
    setIsDisplayReady(false);
    if (needsCredentialPrompt) {
      setPromptedCredentials(null);
      setPromptUsername("");
      setPromptPassword("");
      setPromptDomain(hostConfig.domain ?? "");
      setPromptOpen(true);
      return;
    }
    clearLogs();
    tokenRetryRef.current.reset();
    tokenRetryRef.current.retryNow();
  }, [needsCredentialPrompt, hostConfig.domain, clearLogs]);

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
                domain: promptDomain,
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
                {t("hosts.guac.domain")}
              </label>
              <Input
                placeholder="WORKGROUP"
                value={promptDomain}
                onChange={(e) => setPromptDomain(e.target.value)}
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

  if (error || !token) {
    return (
      <div className="relative w-full h-full">
        <ConnectionScreen
          status={error ? tokenRetry.status : "connecting"}
          message={t("guacamole.connecting", {
            type: (
              protocol ||
              hostConfig.connectionType ||
              "remote"
            ).toUpperCase(),
          })}
          attempt={tokenRetry.attempt}
          maxAttempts={tokenRetry.maxAttempts}
          nextRetryInMs={tokenRetry.nextRetryInMs}
          onManualRetry={handleReconnect}
          retryLabel={t("guacamole.retry")}
        />
      </div>
    );
  }

  const resolvedProtocol = resolvedProtocolForConnect;
  const configuredDpi = readConfiguredDimension(guacConfig.dpi);
  const configuredWidth = readConfiguredDimension(guacConfig.width);
  const configuredHeight = readConfiguredDimension(guacConfig.height);

  return (
    <div className="relative w-full h-full">
      {(!isDisplayReady || connectionError) && (
        <ConnectionScreen
          status={connectionError ? "disconnected" : "connecting"}
          message={t("guacamole.connecting", {
            type: resolvedProtocol.toUpperCase(),
          })}
          onManualRetry={handleReconnect}
          retryLabel={t("guacamole.reconnect")}
          className="z-50"
        />
      )}
      <GuacamoleDisplay
        key={`${token}-${touchMode}`}
        ref={displayRef}
        connectionConfig={{
          token,
          protocol: resolvedProtocol,
          type: resolvedProtocol,
          width: configuredWidth,
          height: configuredHeight,
          dpi: configuredDpi,
        }}
        isVisible={isVisible}
        touchMode={touchMode}
        allowUpload={allowUpload && filesystem !== null}
        onConnect={() => setIsDisplayReady(true)}
        onError={(err) => {
          setConnectionError(err);
          addLog({ type: "error", stage: "error", message: err });
        }}
        onStageChange={(stage) =>
          addLog({
            type: "info",
            stage,
            message: t("guacamole.connecting", {
              type: resolvedProtocol.toUpperCase(),
            }),
          })
        }
        onFilesystem={setFilesystem}
        onDropFiles={handleDropFiles}
      />
      {filesystem && fileBrowserOpen && (
        <GuacamoleFileBrowser
          filesystem={filesystem}
          allowUpload={allowUpload}
          allowDownload={allowDownload}
          pendingUploads={pendingUploads}
          onPendingUploadsHandled={() => setPendingUploads([])}
          onClose={() => setFileBrowserOpen(false)}
        />
      )}
      <GuacamoleToolbar
        displayRef={displayRef}
        protocol={resolvedProtocol}
        touchMode={touchMode}
        hasFilesystem={filesystem !== null}
        fileBrowserOpen={fileBrowserOpen}
        onToggleFileBrowser={() => setFileBrowserOpen((open) => !open)}
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
