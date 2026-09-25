import { createFrontendLogger } from "@termix/plugin-sdk/ui";
import { fileManagerApi, handleApiError } from "./client";

const fileLogger = createFrontendLogger("FILE");

// ============================================================================
// HOST-TO-HOST TRANSFER
// ============================================================================

export type TransferMethodPreference = "auto" | "tar" | "item_sftp";

export interface TransferScanSummary {
  fileCount: number;
  totalBytes: number;
  largestFileBytes: number;
  incompressibleRatio: number;
}

export interface TransferMethodPreview {
  methodPreference: TransferMethodPreference;
  resolvedMethod: "tar" | "item_sftp";
  reasonKey: string;
  sourcePlatform: "unix" | "windows";
  destPlatform: "unix" | "windows";
  sourceHasTar: boolean;
  destHasTar: boolean;
  summary: TransferScanSummary;
}

export async function getTransferMethodPreview(
  sourceSessionId: string,
  sourcePaths: string[],
  destSessionId: string,
  destPath: string,
  methodPreference?: TransferMethodPreference,
): Promise<TransferMethodPreview> {
  try {
    const response = await fileManagerApi().post("/transferMethodPreview", {
      sourceSessionId,
      sourcePaths,
      destSessionId,
      destPath,
      methodPreference: methodPreference ?? "auto",
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "preview transfer method");
    throw error;
  }
}

export interface TransferHopMetrics {
  id: string;
  mbPerSec?: number;
}

export interface TransferTimings {
  prepareDestMs?: number;
  compressMs?: number;
  transferMs?: number;
  extractMs?: number;
  verifyMs?: number;
  directBenchmarkMs?: number;
  relayBenchmarkMs?: number;
  sourceDeleteMs?: number;
  totalMs?: number;
  transferBytes?: number;
  endToEndMbPerSec?: number;
  hops?: TransferHopMetrics[];
}

export function getTransferProgressPercent(
  status: TransferProgressResponse,
): number | undefined {
  if (
    status.bytesTransferred !== undefined &&
    status.totalBytes !== undefined &&
    status.totalBytes > 0
  ) {
    return Math.min(
      100,
      Math.round((status.bytesTransferred / status.totalBytes) * 100),
    );
  }
  if (
    status.itemsCompleted !== undefined &&
    status.totalItems !== undefined &&
    status.totalItems > 0
  ) {
    return Math.min(
      100,
      Math.round((status.itemsCompleted / status.totalItems) * 100),
    );
  }
  return undefined;
}

export function formatTransferMbPerSec(
  mbPerSec?: number,
  _bytes?: number,
  _ms?: number,
): string {
  if (mbPerSec === undefined || mbPerSec <= 0) return "";
  if (mbPerSec < 1) return `${(mbPerSec * 1024).toFixed(0)} KB/s`;
  return `${mbPerSec.toFixed(1)} MB/s`;
}

export function formatDurationMs(ms?: number): string {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

interface TransferProgressTracker {
  update(status: TransferProgressResponse): {
    rate: number | undefined;
    stalled: boolean;
  };
}

export function createTransferProgressTracker(): TransferProgressTracker {
  let lastBytes: number | undefined;
  let lastTime: number | undefined;
  let lastRate: number | undefined;
  let lastActivityTime: number | undefined;
  const STALL_THRESHOLD_MS = 5000;

  return {
    update(status) {
      const now = Date.now();
      const bytes = status.bytesTransferred;

      if (
        bytes !== undefined &&
        lastBytes !== undefined &&
        lastTime !== undefined
      ) {
        const deltaBytes = bytes - lastBytes;
        const deltaMs = now - lastTime;
        if (deltaMs > 0 && deltaBytes >= 0) {
          lastRate = (deltaBytes / deltaMs / 1024 / 1024) * 1000;
          if (deltaBytes > 0) lastActivityTime = now;
        }
      } else if (bytes !== undefined) {
        lastActivityTime = now;
      }

      lastBytes = bytes;
      lastTime = now;

      const stalled =
        lastActivityTime !== undefined &&
        now - lastActivityTime > STALL_THRESHOLD_MS &&
        status.status === "running" &&
        status.phase === "transferring";

      return { rate: lastRate, stalled };
    },
  };
}

export interface TransferProgressResponse {
  transferId: string;
  status: "running" | "success" | "partial" | "error" | "cancelled";
  phase:
    | "compressing"
    | "transferring"
    | "benchmarking"
    | "verifying"
    | "extracting"
    | "reconnecting";
  bytesTransferred?: number;
  totalBytes?: number;
  itemsCompleted?: number;
  totalItems?: number;
  failedPaths?: string[];
  message?: string;
  method?: "stream" | "tar" | "item_sftp" | "direct_rsync";
  sourcePaths?: string[];
  destPath?: string;
  sourceSessionId?: string;
  destSessionId?: string;
  startedAt?: number;
  timings?: TransferTimings;
  sourceDeleted?: boolean;
  moveRequested?: boolean;
  partialDestRemaining?: boolean;
  cleanupCompleted?: boolean;
  retryable?: boolean;
  integrityVerified?: boolean;
  parallelSegmentCount?: number;
}

export async function transferToHost(
  sourceSessionId: string,
  sourcePaths: string[],
  destSessionId: string,
  destPath: string,
  move?: boolean,
  methodPreference?: TransferMethodPreference,
  parallelSegmentCount?: number,
): Promise<{ transferId: string }> {
  try {
    fileLogger.info("Starting host transfer", {
      operation: "host_transfer",
      sourceSessionId,
      destSessionId,
      sourcePaths,
      destPath,
      move,
      methodPreference,
      parallelSegmentCount,
    });

    const response = await fileManagerApi().post("/transferToHost", {
      sourceSessionId,
      sourcePaths,
      destSessionId,
      destPath,
      move,
      methodPreference: methodPreference ?? "auto",
      parallelSegmentCount,
    });

    return response.data;
  } catch (error) {
    fileLogger.error("Failed to start host transfer", error, {
      operation: "host_transfer",
      sourceSessionId,
      destSessionId,
      sourcePaths,
    });
    handleApiError(error, "transfer to host");
    throw error;
  }
}

export async function getTransferStatus(
  transferId: string,
): Promise<TransferProgressResponse> {
  try {
    const response = await fileManagerApi().get(
      `/transferStatus/${transferId}`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "get transfer status");
    throw error;
  }
}

export async function listActiveTransfers(): Promise<{
  transfers: TransferProgressResponse[];
}> {
  try {
    const response = await fileManagerApi().get("/activeTransfers");
    return response.data;
  } catch (error) {
    handleApiError(error, "list active transfers");
    throw error;
  }
}

export async function cancelTransferToHost(transferId: string): Promise<void> {
  try {
    await fileManagerApi().post(`/transferCancel/${transferId}`);
  } catch (error) {
    fileLogger.warn("Transfer cancel request failed (non-fatal)", {
      operation: "host_transfer",
      transferId,
      error,
    });
  }
}

export async function cleanupCancelledTransfer(
  transferId: string,
): Promise<{ removedPaths: string[]; failedPaths: string[] }> {
  try {
    const response = await fileManagerApi().post(
      `/transferCleanup/${transferId}`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "clean up cancelled transfer");
    throw error;
  }
}

export async function retryTransferToHost(
  transferId: string,
): Promise<{ ok: boolean; transferId: string }> {
  try {
    const response = await fileManagerApi().post(
      `/transferRetry/${transferId}`,
    );
    return response.data;
  } catch (error) {
    handleApiError(error, "retry transfer");
    throw error;
  }
}

export async function pollTransferUntilComplete(
  transferId: string,
  onProgress?: (status: TransferProgressResponse) => void,
  intervalMs = 500,
): Promise<TransferProgressResponse> {
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const status = await getTransferStatus(transferId);
        onProgress?.(status);

        if (
          status.status === "success" ||
          status.status === "partial" ||
          status.status === "error" ||
          status.status === "cancelled"
        ) {
          resolve(status);
          return;
        }

        setTimeout(poll, intervalMs);
      } catch (err) {
        reject(err);
      }
    };

    void poll();
  });
}

// ============================================================================
// FILE MANAGER DATA
// ============================================================================

export interface TransferDestination {
  id: number;
  userId: string;
  sourceHostId: number;
  destHostId: number;
  destPath: string;
  destPathLabel?: string;
  lastUsed?: string;
}

export async function getTransferRecent(
  sourceHostId: number,
): Promise<TransferDestination[]> {
  try {
    const response = await fileManagerApi().get("/transfer-recent", {
      params: { sourceHostId },
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "get transfer recent destinations");
    throw error;
  }
}

export async function addTransferRecent(
  sourceHostId: number,
  destHostId: number,
  destPath: string,
  destPathLabel?: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fileManagerApi().post("/transfer-recent", {
      sourceHostId,
      destHostId,
      destPath,
      destPathLabel,
    });
    return response.data;
  } catch (error) {
    handleApiError(error, "add transfer recent destination");
    throw error;
  }
}
