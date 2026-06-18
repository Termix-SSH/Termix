import React from "react";
import { Button } from "@/components/button.tsx";
import { Input } from "@/components/input.tsx";
import { Separator } from "@/components/separator.tsx";
import { Download, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { DockerLogOptions } from "@/types";
import { getContainerLogs, downloadContainerLogs } from "@/main-axios.ts";

interface LogViewerProps {
  sessionId: string;
  containerId: string;
  containerName: string;
}

function AdminToggle({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground uppercase font-bold">
        {label}
      </span>
      <button
        type="button"
        onClick={onToggle}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center border-2 transition-colors ${on ? "bg-accent-brand border-accent-brand" : "bg-muted border-border"}`}
      >
        <span
          className={`pointer-events-none inline-block h-3 w-3 bg-background shadow-sm transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </button>
    </div>
  );
}

function getLogColor(line: string): string {
  if (line.includes(" WARN") || line.includes(" warn"))
    return "text-yellow-400/90";
  if (line.includes(" ERROR") || line.includes(" error"))
    return "text-destructive";
  if (line.includes(" DEBUG") || line.includes(" debug"))
    return "text-muted-foreground/60";
  return "text-foreground/90";
}

export function LogViewer({
  sessionId,
  containerId,
  containerName,
}: LogViewerProps): React.ReactElement {
  const { t } = useTranslation();
  const [rawLogs, setRawLogs] = React.useState<string[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [tailLines, setTailLines] = React.useState("100");
  const [showTimestamps, setShowTimestamps] = React.useState(false);
  const [autoRefresh, setAutoRefresh] = React.useState(false);
  const [logSearch, setLogSearch] = React.useState("");
  const logsEndRef = React.useRef<HTMLDivElement>(null);

  const fetchLogs = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const options: DockerLogOptions = {
        tail: tailLines === "all" ? undefined : parseInt(tailLines, 10),
        timestamps: showTimestamps,
      };
      const data = await getContainerLogs(sessionId, containerId, options);
      setRawLogs(data.logs.split("\n").filter(Boolean));
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

  React.useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  React.useEffect(() => {
    if (autoRefresh && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [rawLogs, autoRefresh]);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const blob = await downloadContainerLogs(sessionId, containerId, {
        timestamps: showTimestamps,
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${containerName.replace(/[^a-z0-9]/gi, "_")}_logs.txt`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success(t("docker.logsDownloaded"));
    } catch (error) {
      toast.error(
        `Failed to download logs: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const filteredLogs = logSearch
    ? rawLogs.filter((l) => l.toLowerCase().includes(logSearch.toLowerCase()))
    : rawLogs;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      <div className="flex items-center justify-between bg-card border border-border px-3 py-2 gap-3 flex-wrap">
        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          <AdminToggle
            on={autoRefresh}
            onToggle={() => setAutoRefresh(!autoRefresh)}
            label={t("docker.autoRefresh")}
          />
          <Separator orientation="vertical" className="h-4" />
          <AdminToggle
            on={showTimestamps}
            onToggle={() => setShowTimestamps(!showTimestamps)}
            label={t("docker.timestamps")}
          />
          <Separator orientation="vertical" className="h-4" />
          <select
            value={tailLines}
            onChange={(e) => setTailLines(e.target.value)}
            className="h-7 px-2 text-[10px] bg-background border border-border text-foreground outline-none uppercase font-bold"
          >
            <option value="50">{t("docker.last50")}</option>
            <option value="100">{t("docker.last100")}</option>
            <option value="500">{t("docker.last500")}</option>
            <option value="1000">{t("docker.last1000")}</option>
            <option value="all">{t("docker.allLogs")}</option>
          </select>
          <Separator orientation="vertical" className="h-4" />
          <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
            {filteredLogs.length}/{rawLogs.length} {t("docker.lines")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
            <Input
              placeholder={t("docker.filterLogs")}
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              className="pl-7 h-7 text-xs bg-background border-border rounded-none"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={fetchLogs}
            disabled={isLoading}
          >
            <RefreshCw
              className={`size-3 ${isLoading ? "animate-spin" : ""}`}
            />
            {t("docker.refresh")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={handleDownload}
            disabled={isDownloading}
          >
            <Download className="size-3" />
            {t("docker.download")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => setRawLogs([])}
          >
            <Trash2 className="size-3" />
            {t("docker.clear")}
          </Button>
        </div>
      </div>

      <div className="flex-1 bg-muted border border-border p-3 overflow-auto font-mono text-xs leading-relaxed scrollbar-thin min-h-0">
        {filteredLogs.length > 0 ? (
          filteredLogs.map((line, i) => {
            const tsEnd = line.indexOf(" ", 1);
            const maybeTs = tsEnd > 10 ? line.substring(0, tsEnd) : null;
            const rest = maybeTs ? line.substring(tsEnd) : line;
            return (
              <div key={i} className="whitespace-pre-wrap break-all">
                {maybeTs && (
                  <span className="text-accent-brand/50">{maybeTs}</span>
                )}
                <span className={getLogColor(rest)}>{rest}</span>
              </div>
            );
          })
        ) : (
          <span className="text-muted-foreground italic">
            {logSearch
              ? t("docker.noLogsMatching", { query: logSearch })
              : t("docker.noLogsAvailable")}
          </span>
        )}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
