import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getTransferStatus, listActiveTransfers } from "@/main-axios.ts";
import { createFormatTransferMetrics } from "./transferMetricsFormat.ts";
import {
  beginTransferProgressMonitoring,
  isTransferBeingMonitored,
  showTransferCompletionToast,
} from "./transferProgressMonitor.tsx";
import {
  clearStalePendingTransfer,
  getPendingTransferIds,
  isTransferNotified,
} from "./transferNotificationStore.ts";
import { runAdaptivePolling } from "@/lib/adaptive-polling.ts";

const POLL_INTERVAL_MS = 2000;

export function TransferMonitor() {
  const { t } = useTranslation();
  const formatTransferMetrics = useMemo(
    () => createFormatTransferMetrics(t),
    [t],
  );

  useEffect(() => {
    const reconcileTransfers = async () => {
      let hasWork = false;
      try {
        const { transfers } = await listActiveTransfers();
        hasWork = transfers.length > 0;
        for (const transfer of transfers) {
          if (isTransferBeingMonitored(transfer.transferId)) continue;
          beginTransferProgressMonitoring(transfer.transferId, t, {
            resumed: true,
            initialStatus: transfer,
            formatTransferMetrics,
          });
        }
      } catch {
        // Non-fatal: file-manager service may be unavailable briefly
      }

      const pendingTransferIds = getPendingTransferIds();
      for (const transferId of pendingTransferIds) {
        if (
          isTransferBeingMonitored(transferId) ||
          isTransferNotified(transferId)
        ) {
          continue;
        }
        hasWork = true;

        try {
          const status = await getTransferStatus(transferId);
          if (status.status === "running") {
            if (!isTransferBeingMonitored(transferId)) {
              beginTransferProgressMonitoring(transferId, t, {
                resumed: true,
                initialStatus: status,
                formatTransferMetrics,
              });
            }
            continue;
          }

          showTransferCompletionToast(
            status,
            t,
            undefined,
            formatTransferMetrics,
          );
        } catch {
          clearStalePendingTransfer(transferId);
        }
      }
      return hasWork;
    };

    return runAdaptivePolling(reconcileTransfers, {
      minIntervalMs: POLL_INTERVAL_MS,
      maxIntervalMs: 30_000,
      stablePollsPerStep: 1,
    });
  }, [t, formatTransferMetrics]);

  return null;
}
