import React, { useEffect, useRef, useState } from "react";
import { useConnectionLog } from "@/ssh/connection-log/ConnectionLogContext.tsx";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/clipboard.ts";
import { Button } from "@/components/button.tsx";
import { cn } from "@/lib/utils.ts";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

interface ConnectionLogPanelProps {
  isConnecting: boolean;
  isConnected: boolean;
  hasConnectionError: boolean;
  position?: "top" | "bottom";
  className?: string;
}

const COLLAPSED_HEIGHT = "h-[140px]";
const EXPANDED_HEIGHT = "h-[45%] min-h-[240px]";

export function ConnectionLogPanel({
  isConnecting,
  isConnected,
  hasConnectionError,
  position = "bottom",
  className,
}: ConnectionLogPanelProps) {
  const { t } = useTranslation();
  const { logs, clearLogs, isExpanded, toggleExpanded, setIsExpanded } =
    useConnectionLog();
  const lastLogRef = useRef<HTMLDivElement>(null);
  const [manuallyCollapsed, setManuallyCollapsed] = useState(false);

  useEffect(() => {
    if (hasConnectionError) {
      setManuallyCollapsed(false);
      setIsExpanded(true);
    }
  }, [hasConnectionError, setIsExpanded]);

  useEffect(() => {
    if (isConnected && !hasConnectionError && !isConnecting) {
      clearLogs();
      setManuallyCollapsed(false);
    }
  }, [isConnected, hasConnectionError, isConnecting, clearLogs]);

  useEffect(() => {
    if (lastLogRef.current) {
      lastLogRef.current.scrollIntoView({ block: "end" });
    }
  }, [logs]);

  const shouldShow =
    !isConnected && (isConnecting || hasConnectionError || logs.length > 0);

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
    if (ok) toast.success(t("terminal.connectionLogCopied"));
    else toast.error(t("terminal.connectionLogCopyFailed"));
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "info":
        return <Info className="h-4 w-4 text-blue-500 shrink-0" />;
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
      case "error":
        return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
      default:
        return <Info className="h-4 w-4 shrink-0" />;
    }
  };

  const getTextColor = (type: string) => {
    switch (type) {
      case "info":
        return "text-blue-400";
      case "success":
        return "text-green-400";
      case "warning":
        return "text-yellow-400";
      case "error":
        return "text-red-400";
      default:
        return "text-muted-foreground";
    }
  };

  return (
    <div
      className={cn(
        "relative z-10 shrink-0 flex flex-col bg-bg-base",
        position === "bottom"
          ? "border-t border-border"
          : "border-b border-border",
        expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT,
        "transition-[height] duration-150",
        className,
      )}
    >
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0 border-b border-border/60">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggle}
          className="flex items-center gap-2 -ml-2"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
          <span className="text-sm font-medium">
            {t("terminal.connectionLogTitle")} ({logs.length})
          </span>
        </Button>
        {logs.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={copyLogsToClipboard}
            title={t("terminal.connectionLogCopy")}
          >
            <Copy className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden thin-scrollbar">
        <div className="px-3 py-2">
          {logs.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {isConnecting
                ? t("terminal.connectionLogWaiting")
                : t("terminal.connectionLogEmpty")}
            </div>
          ) : (
            <div className="space-y-1 font-mono text-xs">
              {logs.map((log, index) => (
                <div
                  key={log.id}
                  ref={index === logs.length - 1 ? lastLogRef : null}
                  className="flex items-start gap-2"
                >
                  <span className="shrink-0 text-muted-foreground">
                    {log.timestamp.toLocaleTimeString()}
                  </span>
                  {getIcon(log.type)}
                  <span
                    className={cn(
                      "flex-1 min-w-0 break-all whitespace-pre-wrap",
                      getTextColor(log.type),
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
    </div>
  );
}
