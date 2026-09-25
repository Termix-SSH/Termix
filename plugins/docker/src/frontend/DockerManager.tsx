/* eslint-disable react-hooks/exhaustive-deps */
import React from "react";
import {
  AlertCircle,
  Box,
  ExternalLink,
  Grid3X3,
  List as ListIcon,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  useConnectionRetry,
  useHost,
  useTranslation,
  logActivity,
  usePluginUiPreferences,
} from "@termix/plugin-sdk/frontend";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  ConnectionLogProvider,
  ConnectionScreen,
  Input,
  SSHAuthDialog,
  Select2,
  Separator,
  TOTPDialog,
  BrowserSignInDialog,
  useAdaptivePolling,
  useConnectionLog,
  useTabsSafe,
} from "@termix/plugin-sdk/ui";
import { DockerApiError, useDockerApi, type ConnectResult } from "./docker-api";
import {
  dockerEnabled,
  hostTitle,
  toDockerHost,
  type DockerContainer,
  type DockerHost,
  type DockerValidation,
} from "./types";
import { ContainerList } from "./components/ContainerList.tsx";
import { ContainerTable } from "./components/ContainerTable.tsx";
import { ContainerDetail } from "./components/ContainerDetail.tsx";

interface DockerManagerProps {
  host?: DockerHost;
  title?: string;
  isVisible?: boolean;
  isTopbarOpen?: boolean;
  embedded?: boolean;
  onClose?: () => void;
}

interface PromptState {
  kind: "totp" | "browser";
  sessionId: string;
  prompt?: string;
  isPassword?: boolean;
  url?: string;
  code?: string;
  label?: string;
}

function newSessionId(): string {
  return `docker-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function DockerManagerInner({
  host,
  title,
  isVisible = true,
  isTopbarOpen = true,
  embedded = false,
  onClose,
}: DockerManagerProps): React.ReactElement {
  const { t } = useTranslation();
  const docker = useDockerApi();
  const { addLog, setLogs, clearLogs } = useConnectionLog();
  const { currentTab, removeTab } = useTabsSafe();
  const { values: dockerPrefs, set: setDockerPref } = usePluginUiPreferences<{
    viewMode: "list" | "detail";
    containerLayout: "card" | "table";
  }>();

  // The shell's host list keeps the host current after an edit; a
  // standalone window has no shell, so it keeps the host it was given.
  const liveRecord = useHost(host?.id);
  const currentHost = React.useMemo(
    () =>
      liveRecord
        ? toDockerHost(liveRecord as unknown as Record<string, unknown>)
        : host,
    [liveRecord, host],
  );
  const enabled = dockerEnabled(currentHost);

  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [containers, setContainers] = React.useState<DockerContainer[]>([]);
  const containersSignatureRef = React.useRef("");
  const [selectedContainer, setSelectedContainer] = React.useState<
    string | null
  >(null);
  const [detailInitialTab, setDetailInitialTab] = React.useState<
    "logs" | "stats" | "console"
  >("logs");
  const [containerLayout, setContainerLayout] = React.useState<
    "card" | "table"
  >(dockerPrefs.containerLayout);

  const handleSetContainerLayout = React.useCallback(
    (layout: "card" | "table") => {
      setContainerLayout(layout);
      setDockerPref("containerLayout", layout);
    },
    [setDockerPref],
  );
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [dockerValidation, setDockerValidation] =
    React.useState<DockerValidation | null>(null);
  const [isValidating, setIsValidating] = React.useState(false);
  // Initial view follows the interface preset; switching it afterwards is a
  // per-session choice.
  const [viewMode, setViewMode] = React.useState<"list" | "detail">(
    dockerPrefs.viewMode,
  );
  const [isLoadingContainers, setIsLoadingContainers] = React.useState(false);
  const [hasLoadedContainersOnce, setHasLoadedContainersOnce] =
    React.useState(false);
  const [prompt, setPrompt] = React.useState<PromptState | null>(null);
  const [showAuthDialog, setShowAuthDialog] = React.useState(false);
  const [authReason, setAuthReason] = React.useState<
    "no_keyboard" | "auth_failed" | "timeout"
  >("no_keyboard");
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [retryCount, setRetryCount] = React.useState(0);

  const activityLoggedRef = React.useRef(false);

  const logDockerActivity = () => {
    if (!currentHost?.id || activityLoggedRef.current) return;
    activityLoggedRef.current = true;
    logActivity("docker", currentHost.id, hostTitle(currentHost)).catch(() => {
      activityLoggedRef.current = false;
    });
  };

  React.useEffect(() => {
    setContainers([]);
    setSelectedContainer(null);
    setSessionId(null);
    setDockerValidation(null);
    setViewMode("list");
  }, [host?.id]);

  const retryRef = React.useRef<ReturnType<typeof useConnectionRetry> | null>(
    null,
  );

  const validate = async (sid: string, clearAfter: boolean) => {
    setSessionId(sid);
    setIsValidating(true);
    try {
      const validation = await docker.validate(sid);
      setDockerValidation(validation);
      if (!validation.available) {
        addLog({
          type: "error",
          stage: "validation",
          message: validation.error || t("docker.error"),
          details: validation.code
            ? `Error code: ${validation.code}`
            : undefined,
        });
        retryRef.current?.markFailed();
      } else {
        logDockerActivity();
        if (clearAfter) setTimeout(() => clearLogs(), 1000);
        retryRef.current?.markConnected();
      }
    } finally {
      setIsValidating(false);
    }
  };

  /** Acts on one step of a connect, whichever request it answered. */
  const applyConnectResult = async (
    sid: string,
    result: ConnectResult,
    clearAfter: boolean,
  ) => {
    if (result.connectionLogs) setLogs(result.connectionLogs);

    if (result.requires_browser_sign_in) {
      setPrompt({
        kind: "browser",
        sessionId: sid,
        url: result.url || "",
        code: result.code || "",
        label: result.label || "",
      });
      return;
    }
    if (result.requires_totp) {
      if (result.retry) {
        addLog({
          type: "error",
          stage: "auth",
          message: t("docker.totpVerificationFailed"),
        });
      }
      setPrompt({
        kind: "totp",
        sessionId: sid,
        prompt: result.prompt || t("docker.verificationCodePrompt"),
        isPassword: result.isPassword,
      });
      return;
    }
    if (result.status === "auth_required") {
      setAuthReason(
        result.reason === "no_keyboard" ? "no_keyboard" : "auth_failed",
      );
      setShowAuthDialog(true);
      return;
    }
    setPrompt(null);
    await validate(sid, clearAfter);
  };

  const reportFailure = (error: unknown, fallback: string) => {
    if (error instanceof DockerApiError && error.connectionLogs?.length) {
      setLogs(error.connectionLogs);
    } else {
      addLog({
        type: "error",
        stage: "connection",
        message: error instanceof Error ? error.message : fallback,
      });
    }
    retryRef.current?.markFailed();
  };

  const connect = async (credentials?: {
    userProvidedPassword?: string;
    userProvidedSshKey?: string;
    userProvidedKeyPassword?: string;
  }) => {
    if (!currentHost?.id) return;
    const sid = newSessionId();
    setIsConnecting(true);
    try {
      const result = await docker.connect(sid, currentHost.id, credentials);
      await applyConnectResult(sid, result, !credentials);
    } catch (error) {
      reportFailure(error, t("docker.connectionFailed"));
    } finally {
      setIsConnecting(false);
    }
  };

  const initializingRef = React.useRef(false);

  React.useEffect(() => {
    if (!currentHost?.id || !enabled) return;
    if (initializingRef.current || sessionId) return;
    initializingRef.current = true;
    clearLogs();
    void connect();

    return () => {
      initializingRef.current = false;
    };
  }, [currentHost?.id, enabled, retryCount]);

  React.useEffect(() => {
    if (!sessionId) return;
    return () => {
      docker.disconnect(sessionId).catch(() => {});
    };
  }, [sessionId]);

  React.useEffect(() => {
    if (!sessionId || !isVisible) return;
    const keepalive = setInterval(
      () => {
        docker.keepalive(sessionId).catch(() => {});
      },
      10 * 60 * 1000,
    );
    return () => clearInterval(keepalive);
  }, [sessionId, isVisible]);

  const refreshContainers = React.useCallback(async () => {
    if (!sessionId) return;
    try {
      setContainers(await docker.listContainers(sessionId, true));
    } catch {
      // the next poll tries again
    }
  }, [sessionId, docker]);

  React.useEffect(() => {
    setHasLoadedContainersOnce(false);
  }, [sessionId]);

  useAdaptivePolling(
    async () => {
      if (!sessionId) return;
      setIsLoadingContainers((loading) =>
        hasLoadedContainersOnce ? loading : true,
      );
      const data = await docker.listContainers(sessionId, true);
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

  const closeTab = () => {
    if (currentTab !== null) removeTab(currentTab);
  };

  const handleTotpSubmit = async (code: string) => {
    if (!prompt || prompt.kind !== "totp" || !code) return;
    const sid = prompt.sessionId;
    setPrompt(null);
    setIsConnecting(true);
    try {
      await applyConnectResult(sid, await docker.answerTotp(sid, code), false);
    } catch (error) {
      reportFailure(error, t("docker.totpVerificationFailed"));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleBrowserSignInContinue = async () => {
    if (!prompt || prompt.kind !== "browser") return;
    const sid = prompt.sessionId;
    setPrompt(null);
    setIsConnecting(true);
    try {
      await applyConnectResult(
        sid,
        await docker.continueBrowserSignIn(sid),
        false,
      );
    } catch (error) {
      reportFailure(error, t("docker.browserSignInFailed"));
    } finally {
      setIsConnecting(false);
    }
  };

  const handlePromptCancel = () => {
    const sid = prompt?.sessionId;
    setPrompt(null);
    setIsConnecting(false);
    if (sid) docker.disconnect(sid).catch(() => {});
    closeTab();
  };

  const handleBrowserSignInOpenUrl = () => {
    if (prompt?.url) window.open(prompt.url, "_blank", "noopener,noreferrer");
  };

  const handleAuthSubmit = async (credentials: {
    password?: string;
    sshKey?: string;
    keyPassword?: string;
  }) => {
    setShowAuthDialog(false);
    await connect({
      userProvidedPassword: credentials.password,
      userProvidedSshKey: credentials.sshKey,
      userProvidedKeyPassword: credentials.keyPassword,
    });
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
    enabled: enabled && !prompt && !showAuthDialog,
    autoStart: false,
  });
  retryRef.current = dockerConnectRetry;

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
    : "bg-canvas text-foreground border-2 border-edge overflow-hidden";

  if (!enabled) {
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

  const dialogs = (
    <>
      <TOTPDialog
        isOpen={prompt?.kind === "totp"}
        prompt={prompt?.prompt ?? ""}
        mode={prompt?.isPassword ? "password" : "totp"}
        onSubmit={handleTotpSubmit}
        onCancel={handlePromptCancel}
      />
      <BrowserSignInDialog
        isOpen={prompt?.kind === "browser"}
        label={prompt?.label ?? ""}
        url={prompt?.url ?? ""}
        code={prompt?.code ?? ""}
        onContinue={handleBrowserSignInContinue}
        onCancel={handlePromptCancel}
        onOpenUrl={handleBrowserSignInOpenUrl}
      />
      {currentHost && (
        <SSHAuthDialog
          isOpen={showAuthDialog}
          reason={authReason}
          onSubmit={handleAuthSubmit}
          onCancel={handleAuthCancel}
          hostInfo={{
            ip: currentHost.ip,
            port: currentHost.port,
            username: currentHost.username ?? "",
            name: currentHost.name,
          }}
        />
      )}
    </>
  );

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
        {dialogs}
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
        currentHost ? (
          <ContainerDetail
            sessionId={sessionId}
            containerId={selectedContainer}
            containers={containers}
            hostConfig={currentHost}
            onBack={handleBack}
            initialTab={detailInitialTab}
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
                <div className="flex items-center border border-border overflow-hidden">
                  <Button
                    variant={containerLayout === "card" ? "secondary" : "ghost"}
                    size="icon"
                    onClick={() => handleSetContainerLayout("card")}
                    className={`size-8 rounded-none ${containerLayout === "card" ? "bg-accent-brand/10 text-accent-brand" : ""}`}
                    title={t("docker.cardView")}
                  >
                    <Grid3X3 className="size-4" />
                  </Button>
                  <Button
                    variant={
                      containerLayout === "table" ? "secondary" : "ghost"
                    }
                    size="icon"
                    onClick={() => handleSetContainerLayout("table")}
                    className={`size-8 rounded-none border-l border-border ${containerLayout === "table" ? "bg-accent-brand/10 text-accent-brand" : ""}`}
                    title={t("docker.listView")}
                  >
                    <ListIcon className="size-4" />
                  </Button>
                </div>
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
              ) : containerLayout === "table" ? (
                <ContainerTable
                  containers={containers}
                  sessionId={sessionId}
                  onSelectContainer={(id, tab) => {
                    setSelectedContainer(id);
                    setDetailInitialTab(tab ?? "logs");
                    setViewMode("detail");
                  }}
                  selectedContainerId={selectedContainer}
                  onRefresh={refreshContainers}
                  search={search}
                  statusFilter={statusFilter}
                />
              ) : (
                <ContainerList
                  containers={containers}
                  sessionId={sessionId}
                  onSelectContainer={(id) => {
                    setSelectedContainer(id);
                    setDetailInitialTab("logs");
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
      {dialogs}
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
