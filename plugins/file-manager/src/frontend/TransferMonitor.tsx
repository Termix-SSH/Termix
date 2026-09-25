import type { TranslateFn } from "@termix/plugin-sdk/frontend";
import type { TFunction } from "i18next";
import { getTransferStatus, listActiveTransfers } from "./api/transfer-api";
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
import { runAdaptivePolling } from "@termix/plugin-sdk/ui";

const POLL_INTERVAL_MS = 2000;

/**
 * Resumes progress toasts for in-flight host-to-host transfers across app
 * reloads and tab switches. No UI of its own, so it runs as plain background
 * polling from activate() rather than a mounted headless component - core
 * cannot mount a plugin component outside a tab/panel/slot, and this needs
 * nothing from one.
 */
export function startTransferMonitor(translate: TranslateFn): () => void {
  // Every call here is a plain t("key") / t("key", {options}) - the calls
  // these helpers make everywhere else, so the SDK's simpler translate
  // function satisfies the same shape they're already typed against.
  const t = translate as unknown as TFunction;
  const formatTransferMetrics = createFormatTransferMetrics(t);

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
}
