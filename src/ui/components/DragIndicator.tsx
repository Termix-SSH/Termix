import React from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import {
  Download,
  FileDown,
  FolderDown,
  Loader2,
  CheckCircle,
  AlertCircle,
} from "lucide-react";

interface DragIndicatorProps {
  isVisible: boolean;
  isDragging: boolean;
  isDownloading: boolean;
  progress: number;
  fileName?: string;
  fileCount?: number;
  error?: string | null;
  className?: string;
}

export function DragIndicator({
  isVisible,
  isDragging,
  isDownloading,
  progress,
  fileName,
  fileCount = 1,
  error,
  className,
}: DragIndicatorProps) {
  const { t } = useTranslation();

  if (!isVisible) return null;

  const getIcon = () => {
    if (error) {
      return <AlertCircle className="w-6 h-6 text-red-500" />;
    }

    if (isDragging) {
      return <CheckCircle className="w-6 h-6 text-green-500" />;
    }

    if (isDownloading) {
      return <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />;
    }

    if (fileCount > 1) {
      return <FolderDown className="w-6 h-6 text-blue-500" />;
    }

    return <FileDown className="w-6 h-6 text-blue-500" />;
  };

  const getStatusText = () => {
    if (error) {
      return t("dragIndicator.error", { error });
    }

    if (isDragging) {
      return t("dragIndicator.dragging", { fileName: fileName || "" });
    }

    if (isDownloading) {
      return t("dragIndicator.preparing", { fileName: fileName || "" });
    }

    if (fileCount > 1) {
      return t("dragIndicator.readyMultiple", { count: fileCount });
    }

    return t("dragIndicator.readySingle", { fileName: fileName || "" });
  };

  return (
    <div
      className={cn(
        "fixed top-4 right-4 z-50 min-w-[300px] max-w-[400px]",
        "bg-dark-bg border border-dark-border rounded-lg shadow-lg",
        "p-4 transition-all duration-300 ease-in-out",
        isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-full",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground mb-2">
            {fileCount > 1
              ? t("dragIndicator.batchDrag")
              : t("dragIndicator.dragToDesktop")}
          </div>

          <div
            className={cn(
              "text-xs mb-3",
              error
                ? "text-red-500"
                : isDragging
                  ? "text-green-500"
                  : "text-muted-foreground",
            )}
          >
            {getStatusText()}
          </div>

          {(isDownloading || isDragging) && !error && (
            <div className="w-full bg-dark-border rounded-full h-2 mb-2">
              <div
                className={cn(
                  "h-2 rounded-full transition-all duration-300",
                  isDragging ? "bg-green-500" : "bg-blue-500",
                )}
                style={{ width: `${Math.max(5, progress)}%` }}
              />
            </div>
          )}

          {(isDownloading || isDragging) && !error && (
            <div className="text-xs text-muted-foreground">
              {progress.toFixed(0)}%
            </div>
          )}

          {isDragging && !error && (
            <div className="text-xs text-green-500 mt-2 flex items-center gap-1">
              <Download className="w-3 h-3" />
              {t("dragIndicator.canDragAnywhere")}
            </div>
          )}
        </div>
      </div>

      {isDragging && !error && (
        <div className="absolute inset-0 rounded-lg bg-green-500/5 animate-pulse" />
      )}
    </div>
  );
}
