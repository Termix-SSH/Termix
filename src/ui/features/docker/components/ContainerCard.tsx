import React from "react";
import { Card } from "@/components/card.tsx";
import { Button } from "@/components/button.tsx";
import {
  Box,
  Play,
  Square,
  RotateCw,
  Pause,
  PlayCircle,
  Trash2,
  RefreshCw,
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
} from "@/main-axios.ts";
import { useConfirmation } from "@/hooks/use-confirmation.ts";

interface ContainerCardProps {
  container: DockerContainer;
  sessionId: string;
  onSelect?: () => void;
  isSelected?: boolean;
  onRefresh?: () => void;
}

export function DockerBadge({ state }: { state: DockerContainer["state"] }) {
  let colorClass = "border-border text-muted-foreground";
  if (state === "running")
    colorClass = "border-accent-brand/40 text-accent-brand bg-accent-brand/10";
  if (state === "paused")
    colorClass = "border-yellow-500/40 text-yellow-500 bg-yellow-500/10";
  if (state === "exited")
    colorClass = "border-destructive/40 text-destructive bg-destructive/5";
  if (state === "restarting")
    colorClass = "border-blue-400/40 text-blue-400 bg-blue-400/10";
  return (
    <span
      className={`text-[10px] font-bold px-1.5 py-0.5 border uppercase tracking-wider ${colorClass}`}
    >
      {state}
    </span>
  );
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

  const isLoading =
    isStarting || isStopping || isRestarting || isPausing || isRemoving;

  const containerName = container.name.startsWith("/")
    ? container.name.slice(1)
    : container.name;
  const portsList = (container.ports ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const handleStart = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsStarting(true);
    try {
      await startDockerContainer(sessionId, container.id);
      toast.success(t("docker.containerStarted", { name: containerName }));
      onRefresh?.();
    } catch (err) {
      toast.error(
        t("docker.failedToStartContainer", {
          error: err instanceof Error ? err.message : "Unknown error",
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
      toast.success(t("docker.containerStopped", { name: containerName }));
      onRefresh?.();
    } catch (err) {
      toast.error(
        t("docker.failedToStopContainer", {
          error: err instanceof Error ? err.message : "Unknown error",
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
      toast.success(t("docker.containerRestarted", { name: containerName }));
      onRefresh?.();
    } catch (err) {
      toast.error(
        t("docker.failedToRestartContainer", {
          error: err instanceof Error ? err.message : "Unknown error",
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
        toast.success(t("docker.containerUnpaused", { name: containerName }));
      } else {
        await pauseDockerContainer(sessionId, container.id);
        toast.success(t("docker.containerPaused", { name: containerName }));
      }
      onRefresh?.();
    } catch (err) {
      toast.error(
        t("docker.failedToTogglePauseContainer", {
          action: container.state === "paused" ? "unpause" : "pause",
          error: err instanceof Error ? err.message : "Unknown error",
        }),
      );
    } finally {
      setIsPausing(false);
    }
  };

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    confirmWithToast(
      t("docker.confirmRemoveContainer", { name: containerName }) +
        (container.state === "running"
          ? " " + t("docker.runningContainerWarning")
          : ""),
      async () => {
        setIsRemoving(true);
        try {
          await removeDockerContainer(
            sessionId,
            container.id,
            container.state === "running",
          );
          toast.success(t("docker.containerRemoved", { name: containerName }));
          onRefresh?.();
        } catch (err) {
          toast.error(
            t("docker.failedToRemoveContainer", {
              error: err instanceof Error ? err.message : "Unknown error",
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

  return (
    <Card
      className={`flex flex-col overflow-hidden p-0 gap-0 group hover:border-accent-brand/40 transition-colors cursor-pointer ${isSelected ? "border-accent-brand/60 bg-accent-brand/5" : ""}`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/10">
        <div className="flex items-center gap-2 min-w-0">
          <Box
            className={`size-3.5 ${container.state === "running" ? "text-accent-brand" : "text-muted-foreground"}`}
          />
          <span className="text-sm font-bold truncate">{containerName}</span>
        </div>
        <DockerBadge state={container.state} />
      </div>
      <div className="px-4 py-3 flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
            {t("docker.image")}
          </span>
          <span className="text-xs font-mono truncate text-foreground/80">
            {container.image}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 mt-1">
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
            {t("docker.ports")}
          </span>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {portsList.length > 0 ? (
              portsList.slice(0, 3).map((p) => (
                <span
                  key={p}
                  className="text-[10px] font-mono px-1 border border-border bg-muted/30"
                >
                  {p}
                </span>
              ))
            ) : (
              <span className="text-[10px] text-muted-foreground italic">
                {t("docker.noPorts")}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="px-4 py-2 border-t border-border bg-muted/5 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[10px] text-muted-foreground italic">
          {container.id.substring(0, 12)}
        </span>
        <div className="flex items-center gap-1">
          {container.state !== "running" && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-accent-brand"
              disabled={isLoading}
              onClick={handleStart}
            >
              {isStarting ? (
                <RefreshCw className="size-3 animate-spin" />
              ) : (
                <Play className="size-3" />
              )}
            </Button>
          )}
          {container.state === "running" && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-destructive"
              disabled={isLoading}
              onClick={handleStop}
            >
              {isStopping ? (
                <RefreshCw className="size-3 animate-spin" />
              ) : (
                <Square className="size-3" />
              )}
            </Button>
          )}
          {(container.state === "running" || container.state === "paused") && (
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={isLoading}
              onClick={handlePause}
            >
              {isPausing ? (
                <RefreshCw className="size-3 animate-spin" />
              ) : container.state === "paused" ? (
                <PlayCircle className="size-3" />
              ) : (
                <Pause className="size-3" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            disabled={isLoading || container.state === "exited"}
            onClick={handleRestart}
          >
            {isRestarting ? (
              <RefreshCw className="size-3 animate-spin" />
            ) : (
              <RotateCw className="size-3" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-destructive"
            disabled={isLoading}
            onClick={handleRemove}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
