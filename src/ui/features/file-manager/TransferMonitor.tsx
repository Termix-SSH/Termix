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

const POLL_INTERVAL_MS = 2000;

export function TransferMonitor() {
  const { t } = useTranslation();
  const formatTransferMetrics = useMemo(
    () => createFormatTransferMetrics(t),
    [t],
  );

  useEffect(() => {
    const reconcileTransfers = async () => {
      try {
        const { transfers } = await listActiveTransfers();
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

      for (const transferId of getPendingTransferIds()) {
        if (
          isTransferBeingMonitored(transferId) ||
          isTransferNotified(transferId)
        ) {
          continue;
        }

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
    };

    void reconcileTransfers();
    const interval = setInterval(reconcileTransfers, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [t, formatTransferMetrics]);

  return null;
}
