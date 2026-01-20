import React, { useEffect, useRef } from "react";
import { useConnectionLog } from "./ConnectionLogContext";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  Trash2,
  Copy,
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

export function ConnectionLog() {
  const { t } = useTranslation();
  const { logs, clearLogs, isExpanded, toggleExpanded } = useConnectionLog();
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isExpanded && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, isExpanded]);

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

  return (
    <div className="border-t border-border bg-bg-subtle">
      <div className="flex items-center justify-between px-3 py-2">
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
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={copyLogsToClipboard}
                title={t("terminal.connectionLogCopy")}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearLogs}
                title={t("terminal.connectionLogClear")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
      {isExpanded && (
        <div className="max-h-[200px] overflow-y-auto border-t border-border bg-bg-base px-3 py-2">
          {logs.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {t("terminal.connectionLogEmpty")}
            </div>
          ) : (
            <div className="space-y-1 font-mono text-xs">
              {logs.map((log) => (
                <div key={log.id} className="flex items-start gap-2">
                  <span className="text-muted-foreground shrink-0">
                    {log.timestamp.toLocaleTimeString()}
                  </span>
                  <div className="shrink-0">{getIcon(log.type)}</div>
                  <span className={`flex-1 ${getTextColor(log.type)}`}>
                    {log.message}
                  </span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
