import type { TFunction } from "i18next";
import {
  formatDurationMs,
  formatTransferMbPerSec,
  type TransferTimings,
} from "@/main-axios.ts";

export function createFormatTransferMetrics(t: TFunction) {
  return (timings?: TransferTimings): string => {
    if (!timings) return "";
    const parts: string[] = [];
    if (timings.prepareDestMs !== undefined) {
      parts.push(
        t("transfer.metricsPrepare", {
          duration: formatDurationMs(timings.prepareDestMs),
        }),
      );
    }
    if (timings.compressMs !== undefined) {
      parts.push(
        t("transfer.metricsCompress", {
          duration: formatDurationMs(timings.compressMs),
        }),
      );
    }
    for (const hop of timings.hops ?? []) {
      const hopKey =
        hop.id === "source_read"
          ? "transfer.metricsHopSourceRead"
          : hop.id === "dest_local_write"
            ? "transfer.metricsHopDestLocalWrite"
            : "transfer.metricsHopDestSftpWrite";
      parts.push(
        t(hopKey, {
          throughput: formatTransferMbPerSec(hop.mbPerSec),
        }),
      );
    }
    if (timings.transferMs !== undefined) {
      parts.push(
        t("transfer.metricsTransfer", {
          duration: formatDurationMs(timings.transferMs),
          throughput: formatTransferMbPerSec(
            timings.endToEndMbPerSec,
            timings.transferBytes,
            timings.transferMs,
          ),
        }),
      );
    }
    if (timings.extractMs !== undefined) {
      parts.push(
        t("transfer.metricsExtract", {
          duration: formatDurationMs(timings.extractMs),
        }),
      );
    }
    if (timings.sourceDeleteMs !== undefined) {
      parts.push(
        t("transfer.metricsSourceDelete", {
          duration: formatDurationMs(timings.sourceDeleteMs),
        }),
      );
    }
    if (timings.totalMs !== undefined) {
      parts.push(
        t("transfer.metricsTotal", {
          duration: formatDurationMs(timings.totalMs),
        }),
      );
    }
    return parts.join(" · ");
  };
}
