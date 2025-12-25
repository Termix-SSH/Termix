import React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Cpu, MemoryStick, Network, HardDrive, Activity } from "lucide-react";
import type { DockerStats } from "@/types";
import { getContainerStats } from "@/ui/main-axios.ts";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";
import { useTranslation } from "react-i18next";

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
    if (containerState !== "running") {
      setError(t("docker.containerMustBeRunningToViewStats"));
      return;
    }

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
  }, [sessionId, containerId, containerState]);

  React.useEffect(() => {
    fetchStats();

    // Poll stats every 2 seconds
    const interval = setInterval(fetchStats, 2000);

    return () => clearInterval(interval);
  }, [fetchStats]);

  if (containerState !== "running") {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <Activity className="h-12 w-12 text-muted-foreground/50 mx-auto" />
          <p className="text-muted-foreground text-lg">
            {t("docker.containerNotRunning")}
          </p>
          <p className="text-muted-foreground text-sm">
            {t("docker.startContainerToViewStats")}
          </p>
        </div>
      </div>
    );
  }

  if (isLoading && !stats) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <SimpleLoader size="lg" />
          <p className="text-muted-foreground mt-4">
            {t("docker.loadingStats")}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <p className="text-red-400 text-lg">
            {t("docker.errorLoadingStats")}
          </p>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">{t("docker.noStatsAvailable")}</p>
      </div>
    );
  }

  const cpuPercent = parseFloat(stats.cpu) || 0;
  const memPercent = parseFloat(stats.memoryPercent) || 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 h-full overflow-auto thin-scrollbar">
      {/* CPU Usage */}
      <Card className="py-3">
        <CardHeader className="pb-2 px-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="h-5 w-5 text-blue-400" />
            {t("docker.cpuUsage")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">
                {t("docker.current")}
              </span>{" "}
              <span className="font-mono font-semibold text-blue-400">
                {stats.cpu}
              </span>
            </div>
            <Progress value={Math.min(cpuPercent, 100)} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Memory Usage */}
      <Card className="py-3">
        <CardHeader className="pb-2 px-4">
          <CardTitle className="text-base flex items-center gap-2">
            <MemoryStick className="h-5 w-5 text-purple-400" />
            {t("docker.memoryUsage")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">
                {t("docker.usedLimit")}
              </span>
              <span className="font-mono font-semibold text-purple-400">
                {stats.memoryUsed} / {stats.memoryLimit}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">
                {t("docker.percentage")}
              </span>
              <span className="font-mono text-purple-400">
                {stats.memoryPercent}
              </span>
            </div>
            <Progress value={Math.min(memPercent, 100)} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Network I/O */}
      <Card className="py-3">
        <CardHeader className="pb-2 px-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Network className="h-5 w-5 text-green-400" />
            {t("docker.networkIo")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">{t("docker.input")}</span>
              <span className="font-mono text-green-400">{stats.netInput}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">
                {t("docker.output")}
              </span>
              <span className="font-mono text-green-400">
                {stats.netOutput}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Block I/O */}
      <Card className="py-3">
        <CardHeader className="pb-2 px-4">
          <CardTitle className="text-base flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-orange-400" />
            {t("docker.blockIo")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">{t("docker.read")}</span>
              <span className="font-mono text-orange-400">
                {stats.blockRead}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">{t("docker.write")}</span>
              <span className="font-mono text-orange-400">
                {stats.blockWrite}
              </span>
            </div>
            {stats.pids && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">
                  {t("docker.pids")}
                </span>
                <span className="font-mono text-orange-400">{stats.pids}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Container Info */}
      <Card className="md:col-span-2 py-3">
        <CardHeader className="pb-2 px-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-5 w-5 text-cyan-400" />
            {t("docker.containerInformation")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">{t("docker.name")}</span>
              <span className="font-mono text-foreground">{containerName}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">{t("docker.id")}</span>
              <span className="font-mono text-sm text-foreground">
                {containerId.substring(0, 12)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">{t("docker.state")}</span>
              <span className="font-semibold text-green-400 capitalize">
                {containerState}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
