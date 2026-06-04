import { toast } from "sonner";
import type { TFunction } from "i18next";
import {
  pollTransferUntilComplete,
  cancelTransferToHost,
  cleanupCancelledTransfer,
  retryTransferToHost,
  createTransferProgressTracker,
  type TransferProgressResponse,
  type TransferTimings,
} from "@/main-axios.ts";
import { TransferProgressToast } from "./components/TransferProgressToast.tsx";
import {
  markTransferNotified,
  registerPendingTransfer,
} from "./transferNotificationStore.ts";

const monitoredTransferIds = new Set<string>();
const TOAST_CLASS = "!pr-10 !pl-4 transfer-progress-toast";

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "-";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  const formattedSize =
    size < 10 && unitIndex > 0 ? size.toFixed(1) : Math.round(size).toString();
  return `${formattedSize} ${units[unitIndex]}`;
}

function renderTransferProgressToast(
  toastId: string | number,
  status: TransferProgressResponse,
  liveMbPerSec?: number,
  onCancel?: () => void,
  cancelling?: boolean,
  stalled?: boolean,
): void {
  toast.loading(
    <TransferProgressToast
      status={status}
      liveMbPerSec={liveMbPerSec}
      stalled={stalled}
      formatSize={formatFileSize}
      onCancel={onCancel}
      cancelling={cancelling}
    />,
    { id: toastId, duration: Infinity, className: TOAST_CLASS },
  );
}

export function showTransferCompletionToast(
  finalStatus: TransferProgressResponse,
  t: TFunction,
  toastId?: string | number,
  formatTransferMetrics?: (timings?: TransferTimings) => string,
): void {
  showDefaultCompletionToast(
    finalStatus,
    toastId ?? `transfer-done-${finalStatus.transferId}`,
    t,
    formatTransferMetrics,
  );
  markTransferNotified(finalStatus.transferId);
}

export function isTransferBeingMonitored(transferId: string): boolean {
  return monitoredTransferIds.has(transferId);
}

export interface TransferMonitorHandle {
  toastId: string | number;
  waitForCompletion: Promise<TransferProgressResponse>;
}

export interface BeginTransferMonitoringOptions {
  resumed?: boolean;
  initialStatus?: Partial<TransferProgressResponse>;
  onComplete?: (
    finalStatus: TransferProgressResponse,
    toastId: string | number,
  ) => void;
  formatTransferMetrics?: (timings?: TransferTimings) => string;
}

function showCancelledTransferToast(
  finalStatus: TransferProgressResponse,
  toastId: string | number,
  t: TFunction,
): void {
  const hasPartialDest =
    (finalStatus.partialDestRemaining ??
      (finalStatus.bytesTransferred ?? 0) > 0) ||
    (finalStatus.itemsCompleted ?? 0) > 0;

  let description: string | undefined;
  if (finalStatus.moveRequested && hasPartialDest) {
    description = t("transfer.transferCancelledMoveHint");
  } else if (hasPartialDest) {
    description = t("transfer.transferCancelledCopyHint");
  }

  const showCleanupAction = hasPartialDest && !finalStatus.cleanupCompleted;

  toast.info(t("transfer.transferCancelled"), {
    id: toastId,
    description,
    className: TOAST_CLASS,
    duration: showCleanupAction ? Infinity : undefined,
    action: showCleanupAction
      ? {
          label: t("transfer.cleanupDestFiles"),
          onClick: () => {
            void cleanupCancelledTransfer(finalStatus.transferId)
              .then((result) => {
                toast.dismiss(toastId);
                if (result.failedPaths.length > 0) {
                  toast.warning(t("transfer.cleanupDestFilesPartial"));
                } else if (result.removedPaths.length > 0) {
                  toast.success(t("transfer.cleanupDestFilesSuccess"));
                } else {
                  toast.info(t("transfer.cleanupDestFilesNothing"));
                }
              })
              .catch((error: unknown) => {
                const message =
                  error instanceof Error
                    ? error.message
                    : t("fileManager.unknownError");
                toast.error(
                  `${t("transfer.cleanupDestFilesError")}: ${message}`,
                );
              });
          },
        }
      : undefined,
  });
}

function showFailedTransferToast(
  finalStatus: TransferProgressResponse,
  toastId: string | number,
  t: TFunction,
  formatTransferMetrics?: (timings?: TransferTimings) => string,
): void {
  const hasPartial =
    (finalStatus.partialDestRemaining ??
      (finalStatus.bytesTransferred ?? 0) > 0) ||
    (finalStatus.itemsCompleted ?? 0) > 0;

  const descriptionParts: string[] = [];
  if (finalStatus.message) {
    descriptionParts.push(finalStatus.message);
  }
  if (finalStatus.retryable && hasPartial) {
    descriptionParts.push(t("transfer.transferFailedRetryHint"));
  }

  const showRetry = finalStatus.retryable === true;

  toast.error(t("transfer.transferError"), {
    id: toastId,
    description:
      descriptionParts.length > 0 ? descriptionParts.join(" ") : undefined,
    className: TOAST_CLASS,
    duration: showRetry ? Infinity : undefined,
    action: showRetry
      ? {
          label: t("transfer.retryTransfer"),
          onClick: () => {
            void retryTransferToHost(finalStatus.transferId)
              .then(() => {
                toast.dismiss(toastId);
                beginTransferProgressMonitoring(finalStatus.transferId, t, {
                  resumed: true,
                  formatTransferMetrics,
                });
              })
              .catch((error: unknown) => {
                const message =
                  error instanceof Error
                    ? error.message
                    : t("fileManager.unknownError");
                toast.error(`${t("transfer.retryTransferError")}: ${message}`);
              });
          },
        }
      : undefined,
  });
}

function showDefaultCompletionToast(
  finalStatus: TransferProgressResponse,
  toastId: string | number,
  t: TFunction,
  formatTransferMetrics?: (timings?: TransferTimings) => string,
): void {
  if (finalStatus.status === "cancelled") {
    showCancelledTransferToast(finalStatus, toastId, t);
    return;
  }

  if (finalStatus.status === "error") {
    showFailedTransferToast(finalStatus, toastId, t, formatTransferMetrics);
    return;
  }

  if (finalStatus.status === "partial") {
    const failed = finalStatus.failedPaths?.join(", ") || "";
    const metrics = formatTransferMetrics?.(finalStatus.timings);
    toast.warning(
      t("transfer.transferPartialHint", {
        paths: failed,
        count: finalStatus.failedPaths?.length || 0,
      }),
      {
        id: toastId,
        description: metrics || undefined,
        className: TOAST_CLASS,
      },
    );
    return;
  }

  const metrics = formatTransferMetrics?.(finalStatus.timings);
  toast.success(t("transfer.transferSuccess"), {
    id: toastId,
    description: metrics || undefined,
    className: TOAST_CLASS,
  });
}

export function beginTransferProgressMonitoring(
  transferId: string,
  t: TFunction,
  options: BeginTransferMonitoringOptions = {},
): TransferMonitorHandle | null {
  if (monitoredTransferIds.has(transferId)) {
    return null;
  }
  monitoredTransferIds.add(transferId);
  registerPendingTransfer(transferId);

  const progressTracker = createTransferProgressTracker();
  let cancelling = false;

  const initialStatus: TransferProgressResponse = {
    transferId,
    status: "running",
    phase: "transferring",
    ...options.initialStatus,
  };

  const progressToast = toast.loading(
    <TransferProgressToast
      status={initialStatus}
      formatSize={formatFileSize}
    />,
    {
      duration: Infinity,
      description: options.resumed ? t("transfer.resumedHint") : undefined,
      className: TOAST_CLASS,
    },
  );

  const handleCancelTransfer = () => {
    if (cancelling) return;
    cancelling = true;
    renderTransferProgressToast(
      progressToast,
      { ...initialStatus, transferId },
      undefined,
      handleCancelTransfer,
      true,
    );
    void cancelTransferToHost(transferId);
  };

  const waitForCompletion = pollTransferUntilComplete(
    transferId,
    (status) => {
      const { rate, stalled } = progressTracker.update(status);
      renderTransferProgressToast(
        progressToast,
        status,
        rate,
        handleCancelTransfer,
        cancelling,
        stalled,
      );
    },
    250,
  )
    .then((finalStatus) => {
      markTransferNotified(transferId);
      if (options.onComplete) {
        options.onComplete(finalStatus, progressToast);
      } else {
        showDefaultCompletionToast(
          finalStatus,
          progressToast,
          t,
          options.formatTransferMetrics,
        );
      }
      return finalStatus;
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : t("fileManager.unknownError");
      toast.error(`${t("transfer.transferError")}: ${message}`, {
        id: progressToast,
        className: TOAST_CLASS,
      });
      markTransferNotified(transferId);
      throw error;
    })
    .finally(() => {
      monitoredTransferIds.delete(transferId);
    });

  renderTransferProgressToast(
    progressToast,
    initialStatus,
    undefined,
    handleCancelTransfer,
    cancelling,
  );

  return { toastId: progressToast, waitForCompletion };
}
