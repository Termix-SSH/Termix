import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/clipboard";
import { Input } from "@/components/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/tooltip";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Eye,
  Loader2,
  ScrollText,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  getSessionLogs,
  getSessionLogContent,
  deleteSessionLog,
  type SessionLogRecord,
} from "@/api/session-log-api";

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "--";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes === 0) return "--";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildFilename(log: SessionLogRecord): string {
  const host = (log.hostName ?? log.hostIp ?? "session")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 40);
  const d = new Date(log.startedAt);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${host}_${y}-${m}-${day}_${h}-${min}-${s}.log`;
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-muted/20">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 flex-1">
        {label}
      </span>
      <span className="text-[10px] font-semibold text-muted-foreground/40 bg-muted/60 px-1.5 py-0.5">
        {count}
      </span>
    </div>
  );
}

function LogRow({
  log,
  onView,
  onDownload,
  onDelete,
}: {
  log: SessionLogRecord;
  onView: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const hostLabel = log.hostName ?? log.hostIp ?? `Host ${log.hostId}`;

  return (
    <div className="group flex items-center gap-2.5 px-3 py-2.5 border-b border-border/40 last:border-b-0 hover:bg-muted/40 transition-colors">
      <div className="shrink-0 flex items-center justify-center size-7 bg-muted/60 text-muted-foreground">
        <ScrollText className="size-3.5" />
      </div>

      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
        <span className="text-xs font-semibold truncate text-foreground">
          {hostLabel}
        </span>
        <span className="text-[10px] text-muted-foreground/60 truncate">
          {formatDate(log.startedAt)}
          {" · "}
          {formatDuration(log.duration)}
          {" · "}
          {formatBytes(log.sizeBytes)}
        </span>
      </div>

      <TooltipProvider>
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onView}
                className="size-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <Eye className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">View log</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onDownload}
                className="size-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <Download className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Download</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onDelete}
                className="size-6 flex items-center justify-center text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <X className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Delete</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}

export function SessionLogsPanel() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<SessionLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [viewLog, setViewLog] = useState<SessionLogRecord | null>(null);
  const [viewContent, setViewContent] = useState<string>("");
  const [viewLoading, setViewLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SessionLogRecord | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    (initial = false) => {
      if (initial) setLoading(true);
      getSessionLogs()
        .then((fresh) => {
          setLogs((prev) => {
            if (
              JSON.stringify(prev.map((l) => l.id)) ===
              JSON.stringify(fresh.map((l) => l.id))
            )
              return prev;
            return fresh;
          });
        })
        .catch(() => {
          if (initial) toast.error(t("sessionLogs.loadError"));
        })
        .finally(() => {
          if (initial) setLoading(false);
        });
    },
    [t],
  );

  useEffect(() => {
    load(true);
    const interval = setInterval(() => load(false), 5000);
    return () => clearInterval(interval);
  }, [load]);

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? logs.filter((l) =>
        (l.hostName ?? l.hostIp ?? "").toLowerCase().includes(q),
      )
    : logs;

  const handleView = async (log: SessionLogRecord) => {
    setViewLog(log);
    setViewContent("");
    setViewLoading(true);
    try {
      const content = await getSessionLogContent(log.id);
      setViewContent(content);
    } catch {
      toast.error(t("sessionLogs.loadError"));
    } finally {
      setViewLoading(false);
    }
  };

  const handleDownload = async (log: SessionLogRecord) => {
    try {
      const content = await getSessionLogContent(log.id);
      const blob = new Blob([content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = buildFilename(log);
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("sessionLogs.loadError"));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteSessionLog(deleteTarget.id);
      setLogs((prev) => prev.filter((l) => l.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch {
      toast.error(t("sessionLogs.deleteError"));
    } finally {
      setDeleting(false);
    }
  };

  const handleCopy = async () => {
    if (!viewContent) return;
    const ok = await copyToClipboard(viewContent);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error(t("common.copyFailed"));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 p-8">
        <Loader2 className="size-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  // Inline log viewer
  if (viewLog) {
    const hostLabel =
      viewLog.hostName ?? viewLog.hostIp ?? `Host ${viewLog.hostId}`;
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Viewer header */}
        <div className="flex items-center gap-2 px-2 py-2 border-b border-border/60 bg-muted/20 shrink-0">
          <button
            onClick={() => setViewLog(null)}
            className="size-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <ArrowLeft className="size-3.5" />
          </button>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-xs font-semibold truncate text-foreground">
              {hostLabel}
            </span>
            <span className="text-[10px] text-muted-foreground/50">
              {formatDate(viewLog.startedAt)}
              {viewLog.duration != null
                ? ` · ${formatDuration(viewLog.duration)}`
                : ""}
              {" · "}
              {formatBytes(viewLog.sizeBytes)}
            </span>
          </div>
          <TooltipProvider>
            <div className="flex items-center gap-0.5 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleCopy}
                    className="size-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
                  >
                    {copied ? (
                      <Check className="size-3 text-green-500" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {copied
                    ? t("sessionLogs.copied")
                    : t("sessionLogs.copyContent")}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handleDownload(viewLog)}
                    className="size-6 flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
                  >
                    <Download className="size-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {t("sessionLogs.downloadLog")}
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>

        {/* Log content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {viewLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap break-all text-foreground/80 leading-relaxed">
              {viewContent || "(empty)"}
            </pre>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 p-6 text-center py-16">
            <div className="size-10 bg-muted/40 flex items-center justify-center">
              <ScrollText className="size-5 text-muted-foreground/30" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-muted-foreground/60">
                {t("sessionLogs.noLogs")}
              </span>
              <span className="text-xs text-muted-foreground/40">
                {t("sessionLogs.noLogsDesc")}
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="relative px-3 py-2 border-b border-border/60">
              <Search className="absolute left-5.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50 pointer-events-none" />
              <Input
                placeholder={t("sessionLogs.filterByHost")}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="pl-8 h-7 text-xs"
              />
            </div>

            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <span className="text-xs text-muted-foreground/50">
                  No results for &quot;{filter}&quot;
                </span>
              </div>
            ) : (
              <div className="flex flex-col">
                <SectionHeader
                  label={t("sessionLogs.title")}
                  count={filtered.length}
                />
                {filtered.map((log) => (
                  <LogRow
                    key={log.id}
                    log={log}
                    onView={() => handleView(log)}
                    onDownload={() => handleDownload(log)}
                    onDelete={() => setDeleteTarget(log)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Inline delete confirmation - positioned against the relative parent in AppShell */}
      {deleteTarget && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-popover border border-border shadow-xl w-full max-w-xs flex flex-col gap-4 p-4">
            <p className="text-sm text-foreground">
              {t("sessionLogs.confirmDelete")}
            </p>
            <p className="text-xs text-muted-foreground">
              {deleteTarget.hostName ??
                deleteTarget.hostIp ??
                `Session ${deleteTarget.id}`}
              {" · "}
              {formatDate(deleteTarget.startedAt)}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-3 py-1.5 text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-3 py-1.5 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors flex items-center gap-1.5"
              >
                {deleting && <Loader2 className="size-3 animate-spin" />}
                {t("sessionLogs.deleteLog")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
