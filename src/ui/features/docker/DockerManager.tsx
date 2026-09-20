/* eslint-disable react-hooks/exhaustive-deps */
import React from "react";
import { Separator } from "@/components/separator.tsx";
import { Alert, AlertDescription } from "@/components/alert.tsx";
import { Button } from "@/components/button.tsx";
import { Card } from "@/components/card.tsx";
import { Input } from "@/components/input.tsx";
import {
  AlertCircle,
  Box,
  ExternalLink,
  RefreshCw,
  Search,
} from "lucide-react";

import { useTranslation } from "react-i18next";
import type { SSHHost, DockerContainer, DockerValidation } from "@/types";
import {
  connectDockerSession,
  disconnectDockerSession,
  listDockerContainers,
  validateDockerAvailability,
  keepaliveDockerSession,
  verifyDockerTOTP,
  verifyDockerWarpgate,
  logActivity,
  getSSHHosts,
} from "@/main-axios.ts";
import { ContainerList } from "./components/ContainerList.tsx";
import { ContainerDetail } from "./components/ContainerDetail.tsx";
import { TOTPDialog } from "@/ssh/dialogs/TOTPDialog.tsx";
import { SSHAuthDialog } from "@/ssh/dialogs/SSHAuthDialog.tsx";
import { WarpgateDialog } from "@/ssh/dialogs/WarpgateDialog.tsx";
import { useTabsSafe } from "@/shell/TabContext.tsx";
import { useAreaPreferences } from "@/contexts/UiPreferencesContext";
import {
  ConnectionLogProvider,
  useConnectionLog,
} from "@/ssh/connection-log/ConnectionLogContext.tsx";
import { ConnectionScreen } from "@/components/connection/ConnectionScreen.tsx";
import { useConnectionRetry } from "@/lib/useConnectionRetry.ts";
import { useAdaptivePolling } from "@/hooks/use-adaptive-polling.ts";
import type { LogEntry } from "@/types/connection-log.ts";
import { Select2 } from "@/components/select2";

interface DockerManagerProps {
  hostConfig?: SSHHost;
  title?: string;
  isVisible?: boolean;
  isTopbarOpen?: boolean;
  embedded?: boolean;
  onClose?: () => void;
}

type ConnectionLogInput = Omit<LogEntry, "id" | "timestamp">;

interface DockerConnectionError {
  message?: string;
  connectionLogs?: ConnectionLogInput[];
}

function DockerManagerInner({
  hostConfig,
  title,
  isVisible = true,
  isTopbarOpen = true,
  embedded = false,
  onClose,
}: DockerManagerProps): React.ReactElement {
  const { t } = useTranslation();
  const { addLog, setLogs, clearLogs } = useConnectionLog();
  const { currentTab, removeTab } = useTabsSafe();
  const dockerPrefs = useAreaPreferences("docker");
  const [currentHostConfig, setCurrentHostConfig] = React.useState(hostConfig);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [containers, setContainers] = React.useState<DockerContainer[]>([]);
  const containersSignatureRef = React.useRef("");
  const [selectedContainer, setSelectedContainer] = React.useState<
    string | null
  >(null);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [dockerValidation, setDockerValidation] =
    React.useState<DockerValidation | null>(null);
  const [isValidating, setIsValidating] = React.useState(false);
  // Initial view follows the interface preset; switching it afterwards is a
  // per-session choice, same as before.
  const [viewMode, setViewMode] = React.useState<"list" | "detail">(
    dockerPrefs.viewMode,
  );
  const [isLoadingContainers, setIsLoadingContainers] = React.useState(false);
  const [hasLoadedContainersOnce, setHasLoadedContainersOnce] =
    React.useState(false);
  const [totpRequired, setTotpRequired] = React.useState(false);
  const [totpSessionId, setTotpSessionId] = React.useState<string | null>(null);
  const [totpPrompt, setTotpPrompt] = React.useState<string>("");
  const [warpgateRequired, setWarpgateRequired] = React.useState(false);
  const [warpgateSessionId, setWarpgateSessionId] = React.useState<
    string | null
  >(null);
  const [warpgateUrl, setWarpgateUrl] = React.useState<string>("");
  const [warpgateSecurityKey, setWarpgateSecurityKey] =
    React.useState<string>("");
  const [showAuthDialog, setShowAuthDialog] = React.useState(false);
  const [authReason, setAuthReason] = React.useState<
    "no_keyboard" | "auth_failed" | "timeout"
  >("no_keyboard");
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [retryCount, setRetryCount] = React.useState(0);

  const activityLoggedRef = React.useRef(false);
  const activityLoggingRef = React.useRef(false);

  const logDockerActivity = async () => {
    if (
      !currentHostConfig?.id ||
      activityLoggedRef.current ||
      activityLoggingRef.current
    ) {
      return;
    }

    activityLoggingRef.current = true;
    activityLoggedRef.current = true;

    try {
      const hostName =
        currentHostConfig.name ||
        `${currentHostConfig.username}@${currentHostConfig.ip}`;
      await logActivity("docker", currentHostConfig.id, hostName);
    } catch (err) {
      console.warn("Failed to log docker activity:", err);
      activityLoggedRef.current = false;
    } finally {
      activityLoggingRef.current = false;
    }
  };

  React.useEffect(() => {
    if (hostConfig?.id !== currentHostConfig?.id) {
      setCurrentHostConfig(hostConfig);
      setContainers([]);
      setSelectedContainer(null);
      setSessionId(null);
      setDockerValidation(null);
      setViewMode("list");
    }
  }, [hostConfig?.id]);

  React.useEffect(() => {
    const fetchLatestHostConfig = async () => {
      if (hostConfig?.id) {
        try {
          const hosts = await getSSHHosts();
          const updatedHost = hosts.find((h) => h.id === hostConfig.id);
          if (updatedHost) {
            setCurrentHostConfig(updatedHost);
          }
        } catch {
          // Silently handle error
        }
      }
    };

    fetchLatestHostConfig();

    const handleHostsChanged = async () => {
      if (hostConfig?.id) {
        try {
          const hosts = await getSSHHosts();
          const updatedHost = hosts.find((h) => h.id === hostConfig.id);
          if (updatedHost) {
            setCurrentHostConfig(updatedHost);
          }
        } catch {
          // Silently handle error
        }
      }
    };

    window.addEventListener("ssh-hosts:changed", handleHostsChanged);
    return () =>
      window.removeEventListener("ssh-hosts:changed", handleHostsChanged);
  }, [hostConfig?.id]);

  const initializingRef = React.useRef(false);

  React.useEffect(() => {
    const initSession = async () => {
      if (!currentHostConfig?.id || !currentHostConfig.enableDocker) {
        return;
      }

      if (initializingRef.current) return;
      initializingRef.current = true;

      if (sessionId) {
        initializingRef.current = false;
        return;
      }

      setIsConnecting(true);
      clearLogs();
      const sid = `docker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      try {
        const result = await connectDockerSession(sid, currentHostConfig.id, {
          useSocks5: currentHostConfig.useSocks5,
          socks5Host: currentHostConfig.socks5Host,
          socks5Port: currentHostConfig.socks5Port,
          socks5Username: currentHostConfig.socks5Username,
          socks5Password: currentHostConfig.socks5Password,
          socks5ProxyChain: currentHostConfig.socks5ProxyChain,
        });

        if (result?.requires_warpgate) {
          setWarpgateRequired(true);
          setWarpgateSessionId(sid);
          setWarpgateUrl(result.url || "");
          setWarpgateSecurityKey(result.securityKey || "");
          setIsConnecting(false);
          return;
        }

        if (result?.requires_totp) {
          setTotpRequired(true);
          setTotpSessionId(sid);
          setTotpPrompt(result.prompt || t("docker.verificationCodePrompt"));
          setIsConnecting(false);
          return;
        }

        if (result?.status === "auth_required") {
          setShowAuthDialog(true);
          setAuthReason(
            result.reason === "no_keyboard" ? "no_keyboard" : "auth_failed",
          );
          setIsConnecting(false);
          return;
        }

        setSessionId(sid);

        setIsValidating(true);
        const validation = await validateDockerAvailability(sid);
        setDockerValidation(validation);
        setIsValidating(false);

        if (!validation.available) {
          addLog({
            type: "error",
            stage: "validation",
            message: validation.error || t("docker.error"),
            details: validation.code
              ? `Error code: ${validation.code}`
              : undefined,
          });
          dockerConnectRetryRef.current.markFailed();
        } else {
          logDockerActivity();
          setTimeout(() => clearLogs(), 1000);
          dockerConnectRetryRef.current.markConnected();
        }
      } catch (error) {
        const dockerError = error as DockerConnectionError;
        setIsConnecting(false);
        setIsValidating(false);

        if (Array.isArray(dockerError.connectionLogs)) {
          setLogs(dockerError.connectionLogs);
        } else {
          addLog({
            type: "error",
            stage: "connection",
            message: dockerError.message || t("docker.connectionFailed"),
          });
        }
        dockerConnectRetryRef.current.markFailed();
      } finally {
        setIsConnecting(false);
      }
    };

    initSession();

    return () => {
      initializingRef.current = false;
      if (sessionId) {
        disconnectDockerSession(sessionId).catch(() => {
          // Silently handle disconnect errors
        });
      }
    };
  }, [currentHostConfig?.id, currentHostConfig?.enableDocker, retryCount]);

  React.useEffect(() => {
    if (!sessionId || !isVisible) return;

    const keepalive = setInterval(
      () => {
        keepaliveDockerSession(sessionId).catch(() => {
          // Silently handle keepalive errors
        });
      },
      10 * 60 * 1000,
    );

    return () => clearInterval(keepalive);
  }, [sessionId, isVisible]);

  const refreshContainers = React.useCallback(async () => {
    if (!sessionId) return;
    try {
      const data = await listDockerContainers(sessionId, true);
      setContainers(data);
    } catch {
      // Silently handle polling errors
    }
  }, [sessionId]);

  React.useEffect(() => {
    setHasLoadedContainersOnce(false);
  }, [sessionId]);

  useAdaptivePolling(
    async () => {
      if (!sessionId) return;
      setIsLoadingContainers((loading) =>
        hasLoadedContainersOnce ? loading : true,
      );
      const data = await listDockerContainers(sessionId, true);
      const signature = JSON.stringify(data);
      const changed = signature !== containersSignatureRef.current;
      containersSignatureRef.current = signature;
      setContainers(data);
      setIsLoadingContainers(false);
      setHasLoadedContainersOnce(true);
      return changed;
    },
    {
      minIntervalMs: 5000,
      maxIntervalMs: 30000,
      stablePollsPerStep: 3,
    },
    !!sessionId && isVisible && !!dockerValidation?.available,
    {
      onError: () => {
        setIsLoadingContainers(false);
        setHasLoadedContainersOnce(true);
      },
    },
  );

  const handleBack = React.useCallback(() => {
    setViewMode("list");
    setSelectedContainer(null);
  }, []);

  const handleTotpSubmit = async (code: string) => {
    if (!totpSessionId || !code) return;

    try {
      setIsConnecting(true);
      const result = await verifyDockerTOTP(totpSessionId, code);

      if (result?.status === "success") {
        setTotpRequired(false);
        setTotpPrompt("");
        setSessionId(totpSessionId);
        setTotpSessionId(null);

        setIsValidating(true);
        const validation = await validateDockerAvailability(totpSessionId);
        setDockerValidation(validation);
        setIsValidating(false);

        if (!validation.available) {
          addLog({
            type: "error",
            stage: "validation",
            message: validation.error || t("docker.error"),
            details: validation.code
              ? `Error code: ${validation.code}`
              : undefined,
          });
          dockerConnectRetryRef.current.markFailed();
        } else {
          logDockerActivity();
          dockerConnectRetryRef.current.markConnected();
        }
      }
    } catch (error) {
      console.error("TOTP verification failed:", error);
      addLog({
        type: "error",
        stage: "auth",
        message: t("docker.totpVerificationFailed"),
      });
      dockerConnectRetryRef.current.markFailed();
    } finally {
      setIsConnecting(false);
    }
  };

  const handleTotpCancel = () => {
    setTotpRequired(false);
    setTotpSessionId(null);
    setTotpPrompt("");
    setIsConnecting(false);
    if (currentTab !== null) {
      removeTab(currentTab);
    }
  };

  const handleWarpgateContinue = async () => {
    if (!warpgateSessionId) return;

    try {
      setIsConnecting(true);
      const result = await verifyDockerWarpgate(warpgateSessionId);

      if (result?.status === "success") {
        setWarpgateRequired(false);
        setWarpgateUrl("");
        setWarpgateSecurityKey("");
        setSessionId(warpgateSessionId);
        setWarpgateSessionId(null);

        setIsValidating(true);
        const validation = await validateDockerAvailability(warpgateSessionId);
        setDockerValidation(validation);
        setIsValidating(false);

        if (!validation.available) {
          addLog({
            type: "error",
            stage: "validation",
            message: validation.error || t("docker.error"),
            details: validation.code
              ? `Error code: ${validation.code}`
              : undefined,
          });
          dockerConnectRetryRef.current.markFailed();
        } else {
          logDockerActivity();
          dockerConnectRetryRef.current.markConnected();
        }
      }
    } catch (error) {
      console.error("Warpgate verification failed:", error);
      addLog({
        type: "error",
        stage: "auth",
        message: t("docker.warpgateVerificationFailed"),
      });
      dockerConnectRetryRef.current.markFailed();
    } finally {
      setIsConnecting(false);
    }
  };

  const handleWarpgateCancel = () => {
    setWarpgateRequired(false);
    setWarpgateSessionId(null);
    setWarpgateUrl("");
    setWarpgateSecurityKey("");
    setIsConnecting(false);
    if (currentTab !== null) {
      removeTab(currentTab);
    }
  };

  const handleWarpgateOpenUrl = () => {
    if (warpgateUrl) {
      window.open(warpgateUrl, "_blank", "noopener,noreferrer");
    }
  };

  const handleAuthSubmit = async (credentials: {
    password?: string;
    sshKey?: string;
    keyPassword?: string;
  }) => {
    if (!currentHostConfig?.id) return;

    setShowAuthDialog(false);
    setIsConnecting(true);

    const sid = `docker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      const result = await connectDockerSession(sid, currentHostConfig.id, {
        userProvidedPassword: credentials.password,
        userProvidedSshKey: credentials.sshKey,
        userProvidedKeyPassword: credentials.keyPassword,
        useSocks5: currentHostConfig.useSocks5,
        socks5Host: currentHostConfig.socks5Host,
        socks5Port: currentHostConfig.socks5Port,
        socks5Username: currentHostConfig.socks5Username,
        socks5Password: currentHostConfig.socks5Password,
        socks5ProxyChain: currentHostConfig.socks5ProxyChain,
      });

      if (result?.requires_warpgate) {
        setWarpgateRequired(true);
        setWarpgateSessionId(sid);
        setWarpgateUrl(result.url || "");
        setWarpgateSecurityKey(result.securityKey || "N/A");
        setIsConnecting(false);
        return;
      }

      if (result?.requires_totp) {
        setTotpRequired(true);
        setTotpSessionId(sid);
        setTotpPrompt(result.prompt || t("docker.verificationCodePrompt"));
        setIsConnecting(false);
        return;
      }

      if (result?.status === "auth_required") {
        setShowAuthDialog(true);
        setAuthReason("auth_failed");
        setIsConnecting(false);
        return;
      }

      setSessionId(sid);

      setIsValidating(true);
      const validation = await validateDockerAvailability(sid);
      setDockerValidation(validation);
      setIsValidating(false);

      if (!validation.available) {
        dockerConnectRetryRef.current.markFailed();
      } else {
        logDockerActivity();
        dockerConnectRetryRef.current.markConnected();
      }
    } catch (error) {
      setIsConnecting(false);
      setIsValidating(false);
      addLog({
        type: "error",
        stage: "connection",
        message: error?.message || t("docker.connectionFailed"),
      });
      dockerConnectRetryRef.current.markFailed();
    } finally {
      setIsConnecting(false);
    }
  };

  const handleAuthCancel = () => {
    setShowAuthDialog(false);
    setIsConnecting(false);
    onClose?.();
  };

  const handleRetry = () => {
    initializingRef.current = false;
    setSessionId(null);
    setDockerValidation(null);
    clearLogs();
    setRetryCount((c) => c + 1);
  };

  const dockerConnectRetry = useConnectionRetry({
    connect: () => {
      handleRetry();
    },
    enabled:
      !!currentHostConfig?.enableDocker &&
      !totpRequired &&
      !warpgateRequired &&
      !showAuthDialog,
    autoStart: false,
  });
  const dockerConnectRetryRef = React.useRef(dockerConnectRetry);
  dockerConnectRetryRef.current = dockerConnectRetry;

  const topMarginPx = isTopbarOpen ? 74 : 16;
  const leftMarginPx = 8;
  const bottomMarginPx = 8;

  const wrapperStyle: React.CSSProperties = embedded
    ? { opacity: isVisible ? 1 : 0, height: "100%", width: "100%" }
    : {
        opacity: isVisible ? 1 : 0,
        marginLeft: leftMarginPx,
        marginRight: 17,
        marginTop: topMarginPx,
        marginBottom: bottomMarginPx,
        height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
      };

  const containerClass = embedded
    ? "h-full w-full text-foreground overflow-hidden bg-transparent"
    : "bg-canvas text-foreground rounded-lg border-2 border-edge overflow-hidden";

  if (!currentHostConfig?.enableDocker) {
    return (
      <div style={wrapperStyle} className={`${containerClass} relative`}>
        <div className="h-full w-full flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
            <Card className="flex-row items-center justify-between px-3 py-3 shrink-0 gap-0">
              <div className="flex items-center gap-3">
                <div className="size-10 border border-border bg-muted flex items-center justify-center shrink-0">
                  <Box className="size-5 text-accent-brand" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">{title}</h1>
                  <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                    {t("docker.manager")}
                  </span>
                </div>
              </div>
            </Card>
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{t("docker.notEnabled")}</AlertDescription>
            </Alert>
          </div>
        </div>
      </div>
    );
  }

  if (isConnecting || isValidating) {
    return (
      <div style={wrapperStyle} className={`${containerClass} relative`}>
        <ConnectionScreen
          status={dockerConnectRetry.status}
          message={
            isValidating ? t("docker.validating") : t("docker.connecting")
          }
          attempt={dockerConnectRetry.attempt}
          maxAttempts={dockerConnectRetry.maxAttempts}
          nextRetryInMs={dockerConnectRetry.nextRetryInMs}
          onManualRetry={dockerConnectRetry.retryNow}
        />
      </div>
    );
  }

  if (dockerValidation && !dockerValidation.available) {
    return (
      <div style={wrapperStyle} className={`${containerClass} relative`}>
        <ConnectionScreen
          status={dockerConnectRetry.status}
          message={t("docker.connectionFailed")}
          attempt={dockerConnectRetry.attempt}
          maxAttempts={dockerConnectRetry.maxAttempts}
          nextRetryInMs={dockerConnectRetry.nextRetryInMs}
          onManualRetry={dockerConnectRetry.retryNow}
          retryLabel={t("terminal.retry")}
          logPosition="top"
        />
      </div>
    );
  }

  return (
    <div style={wrapperStyle} className={`${containerClass} relative`}>
      <div className="h-full w-full flex flex-col flex-1 min-h-0 overflow-hidden">
        {viewMode === "detail" &&
        sessionId &&
        selectedContainer &&
        currentHostConfig ? (
          <ContainerDetail
            sessionId={sessionId}
            containerId={selectedContainer}
            containers={containers}
            hostConfig={currentHostConfig}
            onBack={handleBack}
          />
        ) : (
          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
            <Card className="flex-row items-center justify-between px-3 py-3 shrink-0 gap-0">
              <div className="flex items-center gap-3">
                <div className="size-10 border border-border bg-muted flex items-center justify-center shrink-0">
                  <Box className="size-5 text-accent-brand" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">{title}</h1>
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-accent-brand" />
                    <span className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                      {dockerValidation?.version
                        ? t("docker.version", {
                            runtime:
                              dockerValidation.runtime === "podman"
                                ? "Podman"
                                : "Docker",
                            version: dockerValidation.version,
                          })
                        : t("docker.manager")}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative w-56">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                  <Input
                    placeholder={t("docker.searchPlaceholder")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-8"
                  />
                </div>
                <Select2
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-8 px-2 text-xs bg-background border border-border text-foreground outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="all">{t("docker.allStatuses")}</option>
                  <option value="running">{t("docker.stateRunning")}</option>
                  <option value="paused">{t("docker.statePaused")}</option>
                  <option value="exited">{t("docker.stateExited")}</option>
                  <option value="restarting">
                    {t("docker.stateRestarting")}
                  </option>
                </Select2>
                <Separator orientation="vertical" className="h-8 mx-1" />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={refreshContainers}
                  disabled={isLoadingContainers}
                >
                  <RefreshCw
                    className={`size-4 text-accent-brand ${isLoadingContainers ? "animate-spin" : ""}`}
                  />
                </Button>
                <a
                  href="https://docs.termix.site/features/networking/docker"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center size-9 text-muted-foreground hover:text-foreground transition-colors"
                  title={t("hosts.docsLink")}
                >
                  <ExternalLink className="size-4" />
                </a>
              </div>
            </Card>

            {sessionId ? (
              !hasLoadedContainersOnce ? (
                <div className="flex flex-col items-center justify-center h-full opacity-40 py-20">
                  <RefreshCw className="size-8 animate-spin mb-4" />
                  <span className="text-sm font-semibold">
                    {t("docker.loadingContainers")}
                  </span>
                </div>
              ) : (
                <ContainerList
                  containers={containers}
                  sessionId={sessionId}
                  onSelectContainer={(id) => {
                    setSelectedContainer(id);
                    setViewMode("detail");
                  }}
                  selectedContainerId={selectedContainer}
                  onRefresh={refreshContainers}
                  search={search}
                  statusFilter={statusFilter}
                />
              )
            ) : null}
          </div>
        )}
      </div>
      <TOTPDialog
        isOpen={totpRequired}
        prompt={totpPrompt}
        onSubmit={handleTotpSubmit}
        onCancel={handleTotpCancel}
      />
      <WarpgateDialog
        isOpen={warpgateRequired}
        url={warpgateUrl}
        securityKey={warpgateSecurityKey}
        onContinue={handleWarpgateContinue}
        onCancel={handleWarpgateCancel}
        onOpenUrl={handleWarpgateOpenUrl}
      />
      {currentHostConfig && (
        <SSHAuthDialog
          isOpen={showAuthDialog}
          reason={authReason}
          onSubmit={handleAuthSubmit}
          onCancel={handleAuthCancel}
          hostInfo={{
            ip: currentHostConfig.ip,
            port: currentHostConfig.port,
            username: currentHostConfig.username,
            name: currentHostConfig.name,
          }}
        />
      )}
      <ConnectionScreen
        status={dockerConnectRetry.status}
        message={t("docker.connecting")}
        attempt={dockerConnectRetry.attempt}
        maxAttempts={dockerConnectRetry.maxAttempts}
        nextRetryInMs={dockerConnectRetry.nextRetryInMs}
        onManualRetry={dockerConnectRetry.retryNow}
        retryLabel={t("terminal.retry")}
        logPosition="top"
      />
    </div>
  );
}

export function DockerManager(props: DockerManagerProps): React.ReactElement {
  return (
    <ConnectionLogProvider>
      <DockerManagerInner {...props} />
    </ConnectionLogProvider>
  );
}
