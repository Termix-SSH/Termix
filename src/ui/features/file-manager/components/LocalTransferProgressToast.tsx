import { Button } from "@/components/button.tsx";
import { useTranslation } from "react-i18next";
import { formatFileSize } from "../file-manager-utils.ts";

export interface LocalTransferBatchStatus {
  direction: "upload" | "download";
  totalFiles: number;
  completedFiles: number;
  currentFileName?: string;
  bytesDone: number;
  totalBytes: number;
  mbPerSec?: number;
  cancelling?: boolean;
}

interface LocalTransferProgressToastProps {
  status: LocalTransferBatchStatus;
  onCancel?: () => void;
}

export function LocalTransferProgressToast({
  status,
  onCancel,
}: LocalTransferProgressToastProps) {
  const { t } = useTranslation();
  const percent =
    status.totalBytes > 0
      ? Math.min(100, Math.round((status.bytesDone / status.totalBytes) * 100))
      : undefined;

  const title =
    status.direction === "upload"
      ? t("fileManager.localUploadingProgress", {
          current: Math.min(status.completedFiles + 1, status.totalFiles),
          total: status.totalFiles,
        })
      : t("fileManager.localDownloadingProgress", {
          current: Math.min(status.completedFiles + 1, status.totalFiles),
          total: status.totalFiles,
        });

  return (
    <div className="flex w-[min(calc(100vw-5rem),288px)] max-w-full flex-col gap-2 pr-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight">{title}</p>
          {status.currentFileName && (
            <p
              className="text-xs text-muted-foreground truncate"
              title={status.currentFileName}
            >
              {status.currentFileName}
            </p>
          )}
        </div>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            disabled={status.cancelling}
            onClick={onCancel}
          >
            {status.cancelling
              ? t("transfer.progressCancelling")
              : t("transfer.progressCancel")}
          </Button>
        )}
      </div>
      <div className="bg-primary/20 relative h-2 w-full overflow-hidden rounded-full">
        {percent === undefined ? (
          <div className="bg-primary/60 absolute inset-y-0 left-0 w-1/3 animate-pulse rounded-full" />
        ) : (
          <div
            className="bg-primary h-full rounded-full transition-[width]"
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-3 pr-1 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">
          {formatFileSize(status.bytesDone)} /{" "}
          {formatFileSize(status.totalBytes)}
        </span>
        <span className="shrink-0 tabular-nums font-medium text-foreground">
          {status.mbPerSec !== undefined
            ? `${status.mbPerSec.toFixed(status.mbPerSec >= 10 ? 0 : 1)} MB/s`
            : ""}
        </span>
      </div>
    </div>
  );
}
