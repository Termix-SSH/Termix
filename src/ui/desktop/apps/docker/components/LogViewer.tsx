import React from "react";
import { Button } from "@/components/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Download, RefreshCw, Filter } from "lucide-react";
import { toast } from "sonner";
import type { DockerLogOptions } from "@/types/index.js";
import { getContainerLogs, downloadContainerLogs } from "@/ui/main-axios.ts";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";

interface LogViewerProps {
  sessionId: string;
  containerId: string;
  containerName: string;
}

export function LogViewer({
  sessionId,
  containerId,
  containerName,
}: LogViewerProps): React.ReactElement {
  const [logs, setLogs] = React.useState<string>("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [tailLines, setTailLines] = React.useState<string>("100");
  const [showTimestamps, setShowTimestamps] = React.useState(false);
  const [autoRefresh, setAutoRefresh] = React.useState(false);
  const [searchFilter, setSearchFilter] = React.useState("");
  const logsEndRef = React.useRef<HTMLDivElement>(null);

  const fetchLogs = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const options: DockerLogOptions = {
        tail: tailLines === "all" ? undefined : parseInt(tailLines, 10),
        timestamps: showTimestamps,
      };

      const data = await getContainerLogs(sessionId, containerId, options);
      setLogs(data.logs);
    } catch (error) {
      toast.error(
        `Failed to fetch logs: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, containerId, tailLines, showTimestamps]);

  React.useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh
  React.useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchLogs();
    }, 3000); // Refresh every 3 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  // Auto-scroll to bottom when new logs arrive
  React.useEffect(() => {
    if (autoRefresh && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoRefresh]);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const options: DockerLogOptions = {
        timestamps: showTimestamps,
      };

      const blob = await downloadContainerLogs(sessionId, containerId, options);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${containerName.replace(/[^a-z0-9]/gi, "_")}_logs.txt`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Logs downloaded successfully");
    } catch (error) {
      toast.error(
        `Failed to download logs: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const filteredLogs = React.useMemo(() => {
    if (!searchFilter.trim()) return logs;

    return logs
      .split("\n")
      .filter((line) => line.toLowerCase().includes(searchFilter.toLowerCase()))
      .join("\n");
  }, [logs, searchFilter]);

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Controls */}
      <Card className="py-3">
        <CardContent className="px-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Tail Lines */}
            <div className="flex flex-col">
              <Label htmlFor="tail-lines" className="mb-1">
                Lines to show
              </Label>
              <Select value={tailLines} onValueChange={setTailLines}>
                <SelectTrigger id="tail-lines">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">Last 50 lines</SelectItem>
                  <SelectItem value="100">Last 100 lines</SelectItem>
                  <SelectItem value="500">Last 500 lines</SelectItem>
                  <SelectItem value="1000">Last 1000 lines</SelectItem>
                  <SelectItem value="all">All logs</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Timestamps */}
            <div className="flex flex-col">
              <Label htmlFor="timestamps" className="mb-1">
                Show Timestamps
              </Label>
              <div className="flex items-center h-10 px-3 border rounded-md">
                <Switch
                  id="timestamps"
                  checked={showTimestamps}
                  onCheckedChange={setShowTimestamps}
                />
                <span className="ml-2 text-sm">
                  {showTimestamps ? "Enabled" : "Disabled"}
                </span>
              </div>
            </div>

            {/* Auto Refresh */}
            <div className="flex flex-col">
              <Label htmlFor="auto-refresh" className="mb-1">
                Auto Refresh
              </Label>
              <div className="flex items-center h-10 px-3 border rounded-md">
                <Switch
                  id="auto-refresh"
                  checked={autoRefresh}
                  onCheckedChange={setAutoRefresh}
                />
                <span className="ml-2 text-sm">
                  {autoRefresh ? "On" : "Off"}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col">
              <Label className="mb-1">Actions</Label>
              <div className="flex gap-2 h-10">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={fetchLogs}
                  disabled={isLoading}
                  className="flex-1 h-full"
                >
                  {isLoading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="flex-1 h-full"
                >
                  {isDownloading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* Search Filter */}
          <div className="mt-2">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filter logs..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Logs Display */}
      <Card className="flex-1 overflow-hidden py-0">
        <CardContent className="p-0 h-full">
          {isLoading && !logs ? (
            <div className="flex items-center justify-center h-full">
              <SimpleLoader size="lg" />
            </div>
          ) : (
            <div className="h-full overflow-auto thin-scrollbar">
              <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words text-foreground leading-relaxed">
                {filteredLogs || (
                  <span className="text-muted-foreground">
                    No logs available
                  </span>
                )}
                <div ref={logsEndRef} />
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
