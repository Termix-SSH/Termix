import { Button } from "@/components/button.tsx";
import {
  formatTransferMbPerSec,
  getTransferProgressPercent,
  type TransferProgressResponse,
} from "@/main-axios.ts";
import { useTranslation } from "react-i18next";

interface TransferProgressToastProps {
  status: TransferProgressResponse;
  liveMbPerSec?: number;
  stalled?: boolean;
  formatSize: (bytes?: number) => string;
  onCancel?: () => void;
  cancelling?: boolean;
}

function IndeterminateProgressBar() {
  return (
    <div className="bg-primary/20 relative h-2 w-full overflow-hidden rounded-full">
      <div className="bg-primary/60 absolute inset-y-0 left-0 w-1/3 animate-pulse rounded-full" />
    </div>
  );
}

function DeterminateProgressBar({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className="bg-primary/20 relative h-2 w-full overflow-hidden rounded-full">
      <div
        className="bg-primary h-full rounded-full transition-[width]"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function TransferProgressToast({
  status,
  liveMbPerSec,
  stalled = false,
  formatSize,
  onCancel,
  cancelling = false,
}: TransferProgressToastProps) {
  const { t } = useTranslation();
  const percent = getTransferProgressPercent(status);

  let title = t("transfer.progressTransferring");
  if (status.phase === "reconnecting") {
    title = t("transfer.progressReconnecting");
  } else if (status.phase === "compressing") {
    title = t("transfer.progressCompressing");
  } else if (status.phase === "extracting") {
    title = t("transfer.progressExtracting");
  } else if (
    status.method === "item_sftp" &&
    status.totalItems !== undefined &&
    status.itemsCompleted !== undefined
  ) {
    title = t("transfer.progressTransferringItems", {
      current: status.itemsCompleted,
      total: status.totalItems,
    });
  }

  const hasByteProgress =
    status.bytesTransferred !== undefined &&
    status.totalBytes !== undefined &&
    status.totalBytes > 0;

  const detailLeft = hasByteProgress
    ? t("transfer.progressBytes", {
        transferred: formatSize(status.bytesTransferred),
        total: formatSize(status.totalBytes),
      })
    : status.method === "item_sftp" &&
        status.totalItems !== undefined &&
        status.itemsCompleted !== undefined
      ? t("transfer.progressItems", {
          current: status.itemsCompleted,
          total: status.totalItems,
        })
      : null;

  const liveRate =
    status.phase === "reconnecting"
      ? undefined
      : stalled
        ? t("transfer.progressStalled")
        : liveMbPerSec !== undefined
          ? status.parallelSegmentCount && status.parallelSegmentCount > 1
            ? t("transfer.progressTotalSpeed", {
                speed: formatTransferMbPerSec(liveMbPerSec),
                lanes: status.parallelSegmentCount,
              })
            : formatTransferMbPerSec(liveMbPerSec)
          : undefined;

  const showIndeterminate =
    status.phase === "reconnecting" || percent === undefined;

  return (
    <div className="flex w-[min(calc(100vw-5rem),288px)] max-w-full flex-col gap-2 pr-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-tight">{title}</p>
        {onCancel && status.status === "running" && status.transferId && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            disabled={cancelling}
            onClick={onCancel}
          >
            {cancelling
              ? t("transfer.progressCancelling")
              : t("transfer.progressCancel")}
          </Button>
        )}
      </div>
      {showIndeterminate ? (
        <IndeterminateProgressBar />
      ) : (
        <DeterminateProgressBar value={percent} />
      )}
      <div className="flex items-center justify-between gap-3 pr-1 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{detailLeft ?? ""}</span>
        <span
          className={`shrink-0 tabular-nums ${stalled ? "text-amber-500" : liveRate ? "font-medium text-foreground" : "invisible"}`}
          aria-hidden={!liveRate}
        >
          {liveRate ?? "0 MB/s"}
        </span>
      </div>
    </div>
  );
}
