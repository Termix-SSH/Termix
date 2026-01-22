import React, { useEffect, useRef } from "react";
import { useConnectionLog } from "./ConnectionLogContext";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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

interface ConnectionLogProps {
  isConnecting: boolean;
  isConnected: boolean;
  hasConnectionError: boolean;
  position: "top" | "bottom";
}

export function ConnectionLog({
  isConnecting,
  isConnected,
  hasConnectionError,
  position,
}: ConnectionLogProps) {
  const { t } = useTranslation();
  const { logs, clearLogs, isExpanded, toggleExpanded, setIsExpanded } =
    useConnectionLog();
  const logContainerRef = useRef<HTMLDivElement>(null);
  const lastLogRef = useRef<HTMLDivElement>(null);

  // Auto-expand on error
  useEffect(() => {
    if (hasConnectionError) {
      setIsExpanded(true);
    }
  }, [hasConnectionError, setIsExpanded]);

  // Clear logs immediately when successfully connected
  useEffect(() => {
    if (isConnected && !hasConnectionError && !isConnecting) {
      clearLogs();
    }
  }, [isConnected, hasConnectionError, isConnecting, clearLogs]);

  // Scroll to the bottom when new logs are added and it's expanded
  useEffect(() => {
    if (isExpanded && lastLogRef.current) {
      lastLogRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, isExpanded]);

  // Show when connecting (even with no logs) or when there are logs and not yet connected
  const shouldShow = isConnecting || (logs.length > 0 && !isConnected);

  if (!shouldShow) {
    return null;
  }

  const copyLogsToClipboard = async () => {
    const logsText = logs
      .map((log) => {
        const time = log.timestamp.toLocaleTimeString();
        return `[${time}] [${log.type.toUpperCase()}] ${log.message}`;
      })
      .join("\n");

    try {
      await navigator.clipboard.writeText(logsText);
      toast.success(t("terminal.connectionLogCopied"));
    } catch (error) {
      toast.error(t("terminal.connectionLogCopyFailed"));
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "info":
        return <Info className="h-4 w-4 text-blue-500" />;
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Info className="h-4 w-4" />;
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

  const borderClass =
    position === "bottom" && !isExpanded
      ? "border-t-2 border-border"
      : "border-b-2 border-border";

  return (
    <div
      className={`absolute inset-0 z-[110] flex flex-col pointer-events-none ${position === "top" ? "justify-start" : "justify-end"}`}
    >
      {/* Backdrop for visibility when expanded or error */}
      {(isExpanded || hasConnectionError) && (
        <div className="absolute inset-0 bg-bg-base/80 pointer-events-none" />
      )}

      <div
        className={`relative z-10 bg-bg-subtle pointer-events-auto ${isExpanded ? "flex flex-col h-full" : ""} ${!isExpanded ? borderClass : ""}`}
      >
        {/* Header - always visible */}
        <div className="flex items-center justify-between px-3 py-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleExpanded}
            className="flex items-center gap-2"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
            <span className="text-sm font-medium">
              {t("terminal.connectionLogTitle")} ({logs.length})
            </span>
          </Button>
          <div className="flex items-center gap-2">
            {logs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={copyLogsToClipboard}
                title={t("terminal.connectionLogCopy")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Scrollable content - fills remaining space */}
        {isExpanded && (
          <div
            ref={logContainerRef}
            className="flex-1 h-0 overflow-y-auto overflow-x-hidden thin-scrollbar border-t-2 border-border bg-bg-base"
          >
            <div className="px-3 py-2">
              {logs.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  {isConnecting
                    ? t("terminal.connectionLogConnecting")
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
                      <div className="shrink-0">{getIcon(log.type)}</div>
                      <span
                        className={`flex-1 min-w-0 break-all whitespace-pre-wrap ${getTextColor(
                          log.type,
                        )}`}
                      >
                        {log.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
