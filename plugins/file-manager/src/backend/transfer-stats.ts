import { performance } from "node:perf_hooks";

const TRANSFER_PROGRESS_INTERVAL_MS = 200;

export type TransferHopId =
  "source_read" | "dest_sftp_write" | "dest_local_write";

export interface TransferHopMetrics {
  id: TransferHopId;
  bytes: number;
  /** Wall-clock span from first I/O on this hop to last I/O complete. */
  spanMs: number;
  mbPerSec: number;
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

export function elapsedMs(start: number): number {
  return Date.now() - start;
}

export function computeTransferMbPerSec(
  bytes: number,
  ms: number,
): number | undefined {
  if (ms <= 0 || bytes <= 0) return undefined;
  return ((bytes / ms) * 1000) / (1024 * 1024);
}

export interface HopWallClock {
  firstAt: number | null;
  lastAt: number | null;
}

export function createHopWallClock(): HopWallClock {
  return { firstAt: null, lastAt: null };
}

export function noteHopStart(
  clock: HopWallClock,
  t: number = performance.now(),
): void {
  if (clock.firstAt === null) clock.firstAt = t;
}

export function noteHopEnd(
  clock: HopWallClock,
  t: number = performance.now(),
): void {
  clock.lastAt = t;
}

export function hopSpanMs(clock: HopWallClock): number {
  if (clock.firstAt === null || clock.lastAt === null) return 0;
  return Math.max(0, clock.lastAt - clock.firstAt);
}

export function createThrottledProgress(onProgress?: (bytes: number) => void) {
  let pending = 0;
  let lastFlush = 0;

  const flush = () => {
    if (pending > 0) {
      onProgress?.(pending);
      pending = 0;
      lastFlush = Date.now();
    }
  };

  return {
    add(bytes: number) {
      pending += bytes;
      const now = Date.now();
      if (now - lastFlush >= TRANSFER_PROGRESS_INTERVAL_MS) {
        flush();
      }
    },
    flush,
  };
}

export interface PipelinedXferStats {
  bytes: number;
  sourceReadSpanMs: number;
  destWriteSpanMs: number;
  destWriteKind: "sftp" | "local";
}

export function createEmptyXferStats(): PipelinedXferStats {
  return {
    bytes: 0,
    sourceReadSpanMs: 0,
    destWriteSpanMs: 0,
    destWriteKind: "sftp",
  };
}

export function mergeXferStats(
  target: PipelinedXferStats,
  source: PipelinedXferStats,
): void {
  target.bytes += source.bytes;
  target.sourceReadSpanMs += source.sourceReadSpanMs;
  target.destWriteSpanMs += source.destWriteSpanMs;
  target.destWriteKind = source.destWriteKind;
}

export function buildTransferHopTimings(
  stats: PipelinedXferStats,
  transferMs: number,
): Pick<TransferTimings, "transferBytes" | "endToEndMbPerSec" | "hops"> {
  const hops: TransferHopMetrics[] = [];

  const sourceRate = computeTransferMbPerSec(
    stats.bytes,
    stats.sourceReadSpanMs,
  );
  if (sourceRate !== undefined) {
    hops.push({
      id: "source_read",
      bytes: stats.bytes,
      spanMs: stats.sourceReadSpanMs,
      mbPerSec: sourceRate,
    });
  }

  const destHopId: TransferHopId =
    stats.destWriteKind === "local" ? "dest_local_write" : "dest_sftp_write";
  const destRate = computeTransferMbPerSec(stats.bytes, stats.destWriteSpanMs);
  if (destRate !== undefined) {
    hops.push({
      id: destHopId,
      bytes: stats.bytes,
      spanMs: stats.destWriteSpanMs,
      mbPerSec: destRate,
    });
  }

  return {
    transferBytes: stats.bytes,
    endToEndMbPerSec: computeTransferMbPerSec(stats.bytes, transferMs),
    hops,
  };
}
