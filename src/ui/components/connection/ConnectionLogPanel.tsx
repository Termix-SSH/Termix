import { useEffect, useRef, useState } from "react";
import { useOptionalConnectionLog } from "@/ssh/connection-log/ConnectionLogContext.tsx";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/clipboard.ts";
import { Button } from "@/components/button.tsx";
import { cn } from "@/lib/utils.ts";
import { Check, ChevronDown, ChevronUp, Copy } from "lucide-react";
import { toast } from "sonner";

interface ConnectionLogPanelProps {
  isConnecting: boolean;
  isConnected: boolean;
  hasConnectionError: boolean;
  /** Kept for older callers. The log always sits at the bottom. */
  position?: "top" | "bottom";
  className?: string;
}

const COLLAPSED_HEIGHT = "h-[136px]";
const EXPANDED_HEIGHT = "h-[46%] min-h-[220px]";

/** A dot per line, so the log reads as one column of text. */
const DOT: Record<string, string> = {
  info: "bg-muted-foreground/50",
  success: "bg-accent-brand",
  warning: "bg-warning",
  error: "bg-destructive",
};

const TEXT: Record<string, string> = {
  info: "text-foreground-secondary",
  success: "text-foreground",
  warning: "text-warning",
  error: "text-destructive",
};

export function ConnectionLogPanel({
  isConnecting,
  isConnected,
  hasConnectionError,
  className,
}: ConnectionLogPanelProps) {
  const { t } = useTranslation();
  const connectionLog = useOptionalConnectionLog();
  const { logs, clearLogs, isExpanded, toggleExpanded, setIsExpanded } =
    connectionLog ?? {};
  const lastLogRef = useRef<HTMLDivElement>(null);
  const [manuallyCollapsed, setManuallyCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (hasConnectionError && setIsExpanded) {
      setManuallyCollapsed(false);
      setIsExpanded(true);
    }
  }, [hasConnectionError, setIsExpanded]);

  useEffect(() => {
    if (isConnected && !hasConnectionError && !isConnecting && clearLogs) {
      clearLogs();
      setManuallyCollapsed(false);
    }
  }, [isConnected, hasConnectionError, isConnecting, clearLogs]);

  useEffect(() => {
    if (lastLogRef.current) {
      lastLogRef.current.scrollIntoView?.({ block: "end" });
    }
  }, [logs]);

  const shouldShow =
    !!connectionLog &&
    !isConnected &&
    (isConnecting || hasConnectionError || logs.length > 0);

  if (!shouldShow) {
    return null;
  }

  const expanded = isExpanded && !manuallyCollapsed;

  const handleToggle = () => {
    if (hasConnectionError) {
      setManuallyCollapsed((prev) => !prev);
      return;
    }
    toggleExpanded();
  };

  const copyLogsToClipboard = async () => {
    const logsText = logs
      .map((log) => {
        const time = log.timestamp.toLocaleTimeString();
        return `[${time}] [${log.type.toUpperCase()}] ${log.message}`;
      })
      .join("\n");

    const ok = await copyToClipboard(logsText);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
      toast.success(t("sshAuth.connectionLogCopied"));
    } else {
      toast.error(t("sshAuth.connectionLogCopyFailed"));
    }
  };

  return (
    <div
      className={cn(
        "relative z-10 flex shrink-0 flex-col bg-surface-dim/60",
        "border-t border-border",
        expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT,
        "transition-[height] duration-200",
        className,
      )}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2 pr-1.5">
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={expanded}
          className="flex min-w-0 items-center gap-1.5 px-1.5 py-1 text-foreground-secondary transition-colors hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0" />
          ) : (
            <ChevronUp className="size-3.5 shrink-0" />
          )}
          <span className="text-[10px] font-semibold uppercase tracking-widest">
            {t("sshAuth.connectionLogTitle")}
          </span>
        </button>

        <span className="text-xs tabular-nums text-muted-foreground">
          {logs.length}
        </span>

        {logs.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={copyLogsToClipboard}
            title={t("sshAuth.connectionLogCopy")}
            className="ml-auto text-muted-foreground"
          >
            {copied ? (
              <Check className="size-3.5 text-accent-brand" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
        )}
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {logs.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {isConnecting
              ? t("sshAuth.connectionLogWaiting")
              : t("sshAuth.connectionLogEmpty")}
          </p>
        ) : (
          <div className="px-2 py-1.5 font-mono text-[11px] leading-[1.7]">
            {logs.map((log, index) => (
              <div
                key={log.id}
                ref={index === logs.length - 1 ? lastLogRef : null}
                className="flex items-baseline gap-2 px-1 hover:bg-foreground/[0.03]"
              >
                <span className="shrink-0 tabular-nums text-muted-foreground/70">
                  {log.timestamp.toLocaleTimeString([], { hour12: false })}
                </span>
                <span
                  className={cn(
                    "size-1.5 shrink-0 translate-y-[-1px] rounded-full",
                    DOT[log.type] ?? DOT.info,
                  )}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 whitespace-pre-wrap break-all",
                    TEXT[log.type] ?? TEXT.info,
                  )}
                >
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
