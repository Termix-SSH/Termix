import React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Play,
  Square,
  RotateCw,
  Pause,
  Trash2,
  PlayCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { DockerContainer } from "@/types";
import {
  startDockerContainer,
  stopDockerContainer,
  restartDockerContainer,
  pauseDockerContainer,
  unpauseDockerContainer,
  removeDockerContainer,
} from "@/ui/main-axios.ts";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import { useConfirmation } from "@/hooks/use-confirmation.ts";

interface ContainerCardProps {
  container: DockerContainer;
  sessionId: string;
  onSelect?: () => void;
  isSelected?: boolean;
  onRefresh?: () => void;
}

export function ContainerCard({
  container,
  sessionId,
  onSelect,
  isSelected = false,
  onRefresh,
}: ContainerCardProps): React.ReactElement {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();
  const [isStarting, setIsStarting] = React.useState(false);
  const [isStopping, setIsStopping] = React.useState(false);
  const [isRestarting, setIsRestarting] = React.useState(false);
  const [isPausing, setIsPausing] = React.useState(false);
  const [isRemoving, setIsRemoving] = React.useState(false);

  const statusColors = {
    running: {
      bg: "bg-green-500/10",
      border: "border-green-500/20",
      text: "text-green-400",
      badge: "bg-green-500/20 text-green-300 border-green-500/30",
    },
    exited: {
      bg: "bg-red-500/10",
      border: "border-red-500/20",
      text: "text-red-400",
      badge: "bg-red-500/20 text-red-300 border-red-500/30",
    },
    paused: {
      bg: "bg-yellow-500/10",
      border: "border-yellow-500/20",
      text: "text-yellow-400",
      badge: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    },
    created: {
      bg: "bg-blue-500/10",
      border: "border-blue-500/20",
      text: "text-blue-400",
      badge: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    },
    restarting: {
      bg: "bg-orange-500/10",
      border: "border-orange-500/20",
      text: "text-orange-400",
      badge: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    },
    removing: {
      bg: "bg-purple-500/10",
      border: "border-purple-500/20",
      text: "text-purple-400",
      badge: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    },
    dead: {
      bg: "bg-muted/10",
      border: "border-muted/20",
      text: "text-muted-foreground",
      badge: "bg-muted/20 text-muted-foreground border-muted/30",
    },
  };

  const colors = statusColors[container.state] || statusColors.created;

  const handleStart = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsStarting(true);
    try {
      await startDockerContainer(sessionId, container.id);
      toast.success(t("docker.containerStarted", { name: container.name }));
      onRefresh?.();
    } catch (error) {
      toast.error(
        t("docker.failedToStartContainer", {
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsStopping(true);
    try {
      await stopDockerContainer(sessionId, container.id);
      toast.success(t("docker.containerStopped", { name: container.name }));
      onRefresh?.();
    } catch (error) {
      toast.error(
        t("docker.failedToStopContainer", {
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    } finally {
      setIsStopping(false);
    }
  };

  const handleRestart = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRestarting(true);
    try {
      await restartDockerContainer(sessionId, container.id);
      toast.success(t("docker.containerRestarted", { name: container.name }));
      onRefresh?.();
    } catch (error) {
      toast.error(
        t("docker.failedToRestartContainer", {
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    } finally {
      setIsRestarting(false);
    }
  };

  const handlePause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPausing(true);
    try {
      if (container.state === "paused") {
        await unpauseDockerContainer(sessionId, container.id);
        toast.success(t("docker.containerUnpaused", { name: container.name }));
      } else {
        await pauseDockerContainer(sessionId, container.id);
        toast.success(t("docker.containerPaused", { name: container.name }));
      }
      onRefresh?.();
    } catch (error) {
      toast.error(
        t("docker.failedToTogglePauseContainer", {
          action: container.state === "paused" ? "unpause" : "pause",
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    } finally {
      setIsPausing(false);
    }
  };

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const containerName = container.name.startsWith("/")
      ? container.name.slice(1)
      : container.name;

    let confirmMessage = t("docker.confirmRemoveContainer", {
      name: containerName,
    });

    if (container.state === "running") {
      confirmMessage += " " + t("docker.runningContainerWarning");
    }

    confirmWithToast(
      confirmMessage,
      async () => {
        setIsRemoving(true);
        try {
          const force = container.state === "running";
          await removeDockerContainer(sessionId, container.id, force);
          toast.success(t("docker.containerRemoved", { name: containerName }));
          onRefresh?.();
        } catch (error) {
          toast.error(
            t("docker.failedToRemoveContainer", {
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          );
        } finally {
          setIsRemoving(false);
        }
      },
      t("common.remove"),
      t("common.cancel"),
    );
  };

  const isLoading =
    isStarting || isStopping || isRestarting || isPausing || isRemoving;

  const formatCreatedDate = (dateStr: string): string => {
    try {
      const cleanDate = dateStr.replace(/\s*\+\d{4}\s*UTC\s*$/, "").trim();
      return cleanDate;
    } catch {
      return dateStr;
    }
  };

  const parsePorts = (portsStr: string | undefined): string[] => {
    if (!portsStr || portsStr.trim() === "") return [];

    return portsStr
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  };

  const portsList = parsePorts(container.ports);

  return (
    <>
      <Card
        className={`cursor-pointer transition-all hover:shadow-lg ${
          isSelected
            ? "ring-2 ring-primary border-primary"
            : `border-2 ${colors.border}`
        } ${colors.bg} pt-3 pb-0`}
        onClick={onSelect}
      >
        <CardHeader className="pb-2 px-4">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base font-semibold truncate flex-1">
              {container.name.startsWith("/")
                ? container.name.slice(1)
                : container.name}
            </CardTitle>
            <Badge className={`${colors.badge} border shrink-0`}>
              {container.state}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-3">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground min-w-[50px] text-xs">
                {t("docker.image")}
              </span>
              <span className="truncate text-foreground text-xs">
                {container.image}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground min-w-[50px] text-xs">
                {t("docker.idLabel")}
              </span>
              <span className="font-mono text-xs text-foreground">
                {container.id.substring(0, 12)}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-muted-foreground min-w-[50px] text-xs shrink-0">
                {t("docker.ports")}
              </span>
              <div className="flex flex-wrap gap-1">
                {portsList.length > 0 ? (
                  portsList.map((port, idx) => (
                    <Badge
                      key={idx}
                      variant="outline"
                      className="text-xs font-mono bg-muted/10 text-muted-foreground border-muted/30"
                    >
                      {port}
                    </Badge>
                  ))
                ) : (
                  <Badge
                    variant="outline"
                    className="text-xs bg-muted/10 text-muted-foreground border-muted/30"
                  >
                    {t("docker.noPorts")}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground min-w-[50px] text-xs">
                {t("docker.created")}
              </span>
              <span className="text-foreground text-xs">
                {formatCreatedDate(container.created)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-edge-panel">
            <TooltipProvider>
              {container.state !== "running" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={handleStart}
                      disabled={isLoading}
                    >
                      {isStarting ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-edge-hover border-t-transparent" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("docker.start")}</TooltipContent>
                </Tooltip>
              )}

              {container.state === "running" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={handleStop}
                      disabled={isLoading}
                    >
                      {isStopping ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-edge-hover border-t-transparent" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("docker.stop")}</TooltipContent>
                </Tooltip>
              )}

              {(container.state === "running" ||
                container.state === "paused") && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={handlePause}
                      disabled={isLoading}
                    >
                      {isPausing ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-edge-hover border-t-transparent" />
                      ) : container.state === "paused" ? (
                        <PlayCircle className="h-4 w-4" />
                      ) : (
                        <Pause className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {container.state === "paused"
                      ? t("docker.unpause")
                      : t("docker.pause")}
                  </TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={handleRestart}
                    disabled={isLoading || container.state === "exited"}
                  >
                    {isRestarting ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-edge-hover border-t-transparent" />
                    ) : (
                      <RotateCw className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("docker.restart")}</TooltipContent>{" "}
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-red-400 hover:text-red-300 hover:bg-red-500/20"
                    onClick={handleRemove}
                    disabled={isLoading}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("docker.remove")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
