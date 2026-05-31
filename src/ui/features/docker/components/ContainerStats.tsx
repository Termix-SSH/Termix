import React from "react";
import {
  Activity,
  Cpu,
  HardDrive,
  Info,
  MemoryStick,
  Network,
  RefreshCw,
} from "lucide-react";
import type { DockerStats } from "@/types";
import { getContainerStats } from "@/main-axios.ts";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/section-card";
import { DockerBadge } from "./ContainerCard.tsx";

interface ContainerStatsProps {
  sessionId: string;
  containerId: string;
  containerName: string;
  containerState: string;
}

export function ContainerStats({
  sessionId,
  containerId,
  containerName,
  containerState,
}: ContainerStatsProps): React.ReactElement {
  const { t } = useTranslation();
  const [stats, setStats] = React.useState<DockerStats | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchStats = React.useCallback(async () => {
    if (containerState !== "running") return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getContainerStats(sessionId, containerId);
      setStats(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("docker.failedToFetchStats"),
      );
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, containerId, containerState, t]);

  React.useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (containerState !== "running") {
    return (
      <div className="flex flex-col items-center justify-center h-full opacity-20 py-20">
        <Activity className="size-16 mb-4" />
        <span className="text-xl font-bold uppercase tracking-widest">
          {t("docker.containerNotRunning")}
        </span>
        <span className="text-xs font-semibold">
          {t("docker.startContainerToViewStats")}
        </span>
      </div>
    );
  }

  if (isLoading && !stats) {
    return (
      <div className="flex flex-col items-center justify-center h-full opacity-40 py-20">
        <RefreshCw className="size-8 animate-spin mb-4" />
        <span className="text-sm font-semibold">
          {t("docker.loadingStats")}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full opacity-40 py-20">
        <Activity className="size-8 mb-4" />
        <span className="text-sm font-semibold text-destructive">
          {t("docker.errorLoadingStats")}
        </span>
        <span className="text-xs text-muted-foreground mt-1">{error}</span>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center h-full opacity-20 py-20">
        <span className="text-sm font-semibold">
          {t("docker.noStatsAvailable")}
        </span>
      </div>
    );
  }

  const cpuPercent = parseFloat(stats.cpu) || 0;
  const memPercent = parseFloat(stats.memoryPercent) || 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      <SectionCard
        title={t("docker.cpuUsage")}
        icon={<Cpu className="size-3.5" />}
      >
        <div className="flex flex-col gap-3 py-2">
          <div className="flex items-end justify-between">
            <span className="text-3xl font-bold text-accent-brand">
              {stats.cpu}
            </span>
            <span className="text-[10px] text-muted-foreground uppercase font-bold">
              {t("docker.current")}
            </span>
          </div>
          <div className="h-1.5 bg-muted w-full overflow-hidden">
            <div
              className="h-full bg-accent-brand transition-all duration-500"
              style={{ width: `${Math.min(cpuPercent, 100)}%` }}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("docker.memoryUsage")}
        icon={<MemoryStick className="size-3.5" />}
      >
        <div className="flex flex-col gap-3 py-2">
          <div className="flex items-end justify-between">
            <span className="text-3xl font-bold text-accent-brand">
              {stats.memoryPercent}
            </span>
            <span className="text-[10px] text-muted-foreground uppercase font-bold">
              {stats.memoryUsed} / {stats.memoryLimit}
            </span>
          </div>
          <div className="h-1.5 bg-muted w-full overflow-hidden">
            <div
              className="h-full bg-accent-brand transition-all duration-500"
              style={{ width: `${Math.min(memPercent, 100)}%` }}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("docker.networkIo")}
        icon={<Network className="size-3.5" />}
      >
        <div className="flex flex-col gap-1 py-1">
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-muted-foreground font-semibold">
              {t("docker.input")}
            </span>
            <span className="text-sm font-mono font-bold">
              {stats.netInput}
            </span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-muted-foreground font-semibold">
              {t("docker.output")}
            </span>
            <span className="text-sm font-mono font-bold text-accent-brand">
              {stats.netOutput}
            </span>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t("docker.blockIo")}
        icon={<HardDrive className="size-3.5" />}
      >
        <div className="flex flex-col gap-1 py-1">
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-muted-foreground font-semibold">
              {t("docker.read")}
            </span>
            <span className="text-sm font-mono font-bold">
              {stats.blockRead}
            </span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-muted-foreground font-semibold">
              {t("docker.write")}
            </span>
            <span className="text-sm font-mono font-bold text-accent-brand">
              {stats.blockWrite}
            </span>
          </div>
          {stats.pids && (
            <div className="flex justify-between items-center py-1">
              <span className="text-xs text-muted-foreground font-semibold">
                {t("docker.pids")}
              </span>
              <span className="text-sm font-mono font-bold">{stats.pids}</span>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title={t("docker.containerInformation")}
        icon={<Info className="size-3.5" />}
      >
        <div className="flex flex-col gap-1.5 py-1">
          <div className="flex justify-between items-center text-xs py-1 border-b border-border/50">
            <span className="text-muted-foreground font-semibold">
              {t("docker.name")}
            </span>
            <span className="font-mono">{containerName}</span>
          </div>
          <div className="flex justify-between items-center text-xs py-1 border-b border-border/50">
            <span className="text-muted-foreground font-semibold">
              {t("docker.id")}
            </span>
            <span className="font-mono">{containerId.substring(0, 12)}</span>
          </div>
          <div className="flex justify-between items-center text-xs py-1">
            <span className="text-muted-foreground font-semibold">
              {t("docker.state")}
            </span>
            <DockerBadge
              state={
                containerState as import("@/types").DockerContainer["state"]
              }
            />
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
