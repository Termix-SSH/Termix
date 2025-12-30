import React from "react";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { SSHHost, DockerContainer, DockerValidation } from "@/types";
import {
  connectDockerSession,
  disconnectDockerSession,
  listDockerContainers,
  validateDockerAvailability,
  keepaliveDockerSession,
} from "@/ui/main-axios.ts";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { ContainerList } from "./components/ContainerList.tsx";
import { ContainerDetail } from "./components/ContainerDetail.tsx";

interface DockerManagerProps {
  hostConfig?: SSHHost;
  title?: string;
  isVisible?: boolean;
  isTopbarOpen?: boolean;
  embedded?: boolean;
}

export function DockerManager({
  hostConfig,
  title,
  isVisible = true,
  isTopbarOpen = true,
  embedded = false,
}: DockerManagerProps): React.ReactElement {
  const { t } = useTranslation();
  const { state: sidebarState } = useSidebar();
  const [currentHostConfig, setCurrentHostConfig] = React.useState(hostConfig);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [containers, setContainers] = React.useState<DockerContainer[]>([]);
  const [selectedContainer, setSelectedContainer] = React.useState<
    string | null
  >(null);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("containers");
  const [dockerValidation, setDockerValidation] =
    React.useState<DockerValidation | null>(null);
  const [isValidating, setIsValidating] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<"list" | "detail">("list");
  const [isLoadingContainers, setIsLoadingContainers] = React.useState(false);

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
          const { getSSHHosts } = await import("@/ui/main-axios.ts");
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
          const { getSSHHosts } = await import("@/ui/main-axios.ts");
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

  React.useEffect(() => {
    const initSession = async () => {
      if (!currentHostConfig?.id || !currentHostConfig.enableDocker) {
        return;
      }

      setIsConnecting(true);
      const sid = `docker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      try {
        await connectDockerSession(sid, currentHostConfig.id);
        setSessionId(sid);

        setIsValidating(true);
        const validation = await validateDockerAvailability(sid);
        setDockerValidation(validation);
        setIsValidating(false);

        if (!validation.available) {
          toast.error(
            validation.error || "Docker is not available on this host",
          );
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to connect to host",
        );
        setIsConnecting(false);
        setIsValidating(false);
      } finally {
        setIsConnecting(false);
      }
    };

    initSession();

    return () => {
      if (sessionId) {
        disconnectDockerSession(sessionId).catch(() => {
          // Silently handle disconnect errors
        });
      }
    };
  }, [currentHostConfig?.id, currentHostConfig?.enableDocker]);

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
    } catch (error) {
      // Silently handle polling errors
    }
  }, [sessionId]);

  React.useEffect(() => {
    if (!sessionId || !isVisible || !dockerValidation?.available) return;

    let cancelled = false;

    const pollContainers = async () => {
      try {
        setIsLoadingContainers(true);
        const data = await listDockerContainers(sessionId, true);
        if (!cancelled) {
          setContainers(data);
        }
      } catch (error) {
        // Silently handle polling errors
      } finally {
        if (!cancelled) {
          setIsLoadingContainers(false);
        }
      }
    };

    pollContainers();
    const interval = setInterval(pollContainers, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, isVisible, dockerValidation?.available]);

  const handleBack = React.useCallback(() => {
    setViewMode("list");
    setSelectedContainer(null);
  }, []);

  const topMarginPx = isTopbarOpen ? 74 : 16;
  const leftMarginPx = sidebarState === "collapsed" ? 16 : 8;
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
      <div style={wrapperStyle} className={containerClass}>
        <div className="h-full w-full flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 pt-3 pb-3 gap-3">
            <div className="flex items-center gap-4 min-w-0">
              <div className="min-w-0">
                <h1 className="font-bold text-lg truncate">
                  {currentHostConfig?.folder} / {title}
                </h1>
              </div>
            </div>
          </div>
          <Separator className="p-0.25 w-full" />

          <div className="flex-1 overflow-hidden min-h-0 p-4">
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
      <div style={wrapperStyle} className={containerClass}>
        <div className="h-full w-full flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 pt-3 pb-3 gap-3">
            <div className="flex items-center gap-4 min-w-0">
              <div className="min-w-0">
                <h1 className="font-bold text-lg truncate">
                  {currentHostConfig?.folder} / {title}
                </h1>
              </div>
            </div>
          </div>
          <Separator className="p-0.25 w-full" />

          <div className="flex-1 overflow-hidden min-h-0 p-4 flex items-center justify-center">
            <div className="text-center">
              <SimpleLoader size="lg" />
              <p className="text-muted-foreground mt-4">
                {isValidating
                  ? t("docker.validating")
                  : t("docker.connectingToHost")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (dockerValidation && !dockerValidation.available) {
    return (
      <div style={wrapperStyle} className={containerClass}>
        <div className="h-full w-full flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 pt-3 pb-3 gap-3">
            <div className="flex items-center gap-4 min-w-0">
              <div className="min-w-0">
                <h1 className="font-bold text-lg truncate">
                  {currentHostConfig?.folder} / {title}
                </h1>
              </div>
            </div>
          </div>
          <Separator className="p-0.25 w-full" />

          <div className="flex-1 overflow-hidden min-h-0 p-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-semibold mb-2">{t("docker.error")}</div>
                <div>{dockerValidation.error}</div>
                {dockerValidation.code && (
                  <div className="mt-2 text-xs opacity-70">
                    {t("docker.errorCode", { code: dockerValidation.code })}
                  </div>
                )}
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={wrapperStyle} className={containerClass}>
      <div className="h-full w-full flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 pt-3 pb-3 gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <div className="min-w-0">
              <h1 className="font-bold text-lg truncate">
                {currentHostConfig?.folder} / {title}
              </h1>
              {dockerValidation?.version && (
                <p className="text-xs text-muted-foreground">
                  {t("docker.version", { version: dockerValidation.version })}
                </p>
              )}
            </div>
          </div>
        </div>
        <Separator className="p-0.25 w-full" />

        <div className="flex-1 overflow-hidden min-h-0">
          {viewMode === "list" ? (
            <div className="h-full px-4 py-4">
              {sessionId ? (
                isLoadingContainers && containers.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <SimpleLoader size="lg" />
                      <p className="text-muted-foreground mt-4">
                        {t("docker.loadingContainers")}
                      </p>
                    </div>
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
                  />
                )
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">No session available</p>
                </div>
              )}
            </div>
          ) : sessionId && selectedContainer && currentHostConfig ? (
            <ContainerDetail
              sessionId={sessionId}
              containerId={selectedContainer}
              containers={containers}
              hostConfig={currentHostConfig}
              onBack={handleBack}
            />
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                Select a container to view details
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
