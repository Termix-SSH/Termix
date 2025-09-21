import React from "react";
import { cn } from "@/lib/utils";
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
      return `错误: ${error}`;
    }

    if (isDragging) {
      return `正在拖拽${fileName ? ` ${fileName}` : ""}到桌面...`;
    }

    if (isDownloading) {
      return `正在准备拖拽${fileName ? ` ${fileName}` : ""}...`;
    }

    return `准备拖拽${fileCount > 1 ? ` ${fileCount} 个文件` : fileName ? ` ${fileName}` : ""}`;
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
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="text-sm font-medium text-foreground mb-2">
            {fileCount > 1 ? "批量拖拽到桌面" : "拖拽到桌面"}
          </div>

          {/* Status text */}
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

          {/* Progress bar */}
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

          {/* Progress percentage */}
          {(isDownloading || isDragging) && !error && (
            <div className="text-xs text-muted-foreground">
              {progress.toFixed(0)}%
            </div>
          )}

          {/* Drag hint */}
          {isDragging && !error && (
            <div className="text-xs text-green-500 mt-2 flex items-center gap-1">
              <Download className="w-3 h-3" />
              现在可以拖拽到桌面任意位置
            </div>
          )}
        </div>
      </div>

      {/* Background with animation effect */}
      {isDragging && !error && (
        <div className="absolute inset-0 rounded-lg bg-green-500/5 animate-pulse" />
      )}
    </div>
  );
}
