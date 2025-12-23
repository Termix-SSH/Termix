import React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Progress } from "@/components/ui/progress.tsx";
import { Cpu, MemoryStick, Network, HardDrive, Activity } from "lucide-react";
import type { DockerStats } from "@/types/index.js";
import { getContainerStats } from "@/ui/main-axios.ts";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";

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
  const [stats, setStats] = React.useState<DockerStats | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchStats = React.useCallback(async () => {
    if (containerState !== "running") {
      setError("Container must be running to view stats");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const data = await getContainerStats(sessionId, containerId);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch stats");
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
          <Activity className="h-12 w-12 text-gray-600 mx-auto" />
          <p className="text-gray-400 text-lg">Container is not running</p>
          <p className="text-gray-500 text-sm">
            Start the container to view statistics
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
          <p className="text-gray-400 mt-4">Loading stats...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <p className="text-red-400 text-lg">Error loading stats</p>
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-400">No stats available</p>
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
            CPU Usage
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400">Current</span>
              <span className="font-mono font-semibold text-blue-300">
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
            Memory Usage
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400">Used / Limit</span>
              <span className="font-mono font-semibold text-purple-300">
                {stats.memoryUsed} / {stats.memoryLimit}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400">Percentage</span>
              <span className="font-mono text-purple-300">
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
            Network I/O
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400">Input</span>
              <span className="font-mono text-green-300">{stats.netInput}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400">Output</span>
              <span className="font-mono text-green-300">
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
            Block I/O
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400">Read</span>
              <span className="font-mono text-orange-300">
                {stats.blockRead}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400">Write</span>
              <span className="font-mono text-orange-300">
                {stats.blockWrite}
              </span>
            </div>
            {stats.pids && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">PIDs</span>
                <span className="font-mono text-orange-300">{stats.pids}</span>
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
            Container Information
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Name:</span>
              <span className="font-mono text-gray-200">{containerName}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">ID:</span>
              <span className="font-mono text-sm text-gray-300">
                {containerId.substring(0, 12)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">State:</span>
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
