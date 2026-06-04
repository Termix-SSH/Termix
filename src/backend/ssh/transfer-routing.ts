import type { TransferPlatform } from "./transfer-paths.js";

export type TransferMethodPreference = "auto" | "tar" | "item_sftp";

export interface TransferScanSummary {
  fileCount: number;
  totalBytes: number;
  largestFileBytes: number;
  /** Share of total bytes in likely incompressible file types (0–1). */
  incompressibleRatio: number;
}

const INCOMPRESSIBLE_EXT =
  /\.(zip|gz|bz2|xz|7z|rar|tar|tgz|jpg|jpeg|png|gif|webp|mp3|mp4|mkv|avi|mov|wmv|iso|dmg|deb|rpm|pdf|db|sqlite|wasm|vmdk|qcow2)$/i;

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

export function isLikelyIncompressiblePath(path: string): boolean {
  return INCOMPRESSIBLE_EXT.test(path);
}

export function buildTransferScanSummary(
  items: Array<{ sourcePath: string; size: number }>,
): TransferScanSummary {
  let totalBytes = 0;
  let largestFileBytes = 0;
  let incompressibleBytes = 0;

  for (const item of items) {
    totalBytes += item.size;
    largestFileBytes = Math.max(largestFileBytes, item.size);
    if (isLikelyIncompressiblePath(item.sourcePath)) {
      incompressibleBytes += item.size;
    }
  }

  return {
    fileCount: items.length,
    totalBytes,
    largestFileBytes,
    incompressibleRatio: totalBytes > 0 ? incompressibleBytes / totalBytes : 0,
  };
}

/**
 * Choose tar vs per-item SFTP for directory / multi-file transfers.
 * Single-file stream transfers bypass this entirely.
 */
export function resolveArchiveTransferMethod(
  preference: TransferMethodPreference,
  summary: TransferScanSummary,
  sourcePlatform: TransferPlatform,
  destPlatform: TransferPlatform,
  sourceHasTar: boolean,
  destHasTar: boolean,
): "tar" | "item_sftp" {
  if (sourcePlatform === "windows" || destPlatform === "windows") {
    return "item_sftp";
  }

  if (preference === "item_sftp") {
    return "item_sftp";
  }

  if (preference === "tar") {
    return sourceHasTar && destHasTar ? "tar" : "item_sftp";
  }

  // auto
  if (!sourceHasTar || !destHasTar) {
    return "item_sftp";
  }

  const { fileCount, totalBytes, largestFileBytes, incompressibleRatio } =
    summary;

  if (fileCount === 0) {
    return "item_sftp";
  }

  if (fileCount === 1 && largestFileBytes >= 2 * GB) {
    return "item_sftp";
  }

  // Multi-item sets with a large file: tar only when data is likely compressible
  // (mostly video/zip → per-file SFTP is simpler and avoids pack/unpack time).
  if (
    fileCount > 1 &&
    largestFileBytes >= 2 * GB &&
    totalBytes >= 500 * MB &&
    incompressibleRatio < 0.7
  ) {
    return "tar";
  }

  if (fileCount === 1 && largestFileBytes >= 5 * GB) {
    return "item_sftp";
  }

  if (totalBytes >= 10 * GB && incompressibleRatio >= 0.5) {
    return "item_sftp";
  }

  if (incompressibleRatio >= 0.85) {
    return "item_sftp";
  }

  if (fileCount >= 100) {
    return "tar";
  }

  if (fileCount >= 20 && totalBytes >= 50 * MB && incompressibleRatio < 0.5) {
    return "tar";
  }

  if (fileCount > 5 && incompressibleRatio < 0.7) {
    return "tar";
  }

  return "item_sftp";
}

export type ArchiveTransferReasonKey =
  | "user_item_sftp"
  | "user_tar"
  | "tar_unavailable"
  | "windows_host"
  | "auto_multi_large"
  | "auto_single_large_in_archive"
  | "auto_many_incompressible"
  | "auto_many_files"
  | "auto_default";

/** i18n key suffix under transfer.methodReason.* */
export function getArchiveTransferReasonKey(
  preference: TransferMethodPreference,
  resolvedMethod: "tar" | "item_sftp",
  summary: TransferScanSummary,
  sourcePlatform: TransferPlatform,
  destPlatform: TransferPlatform,
  sourceHasTar: boolean,
  destHasTar: boolean,
): ArchiveTransferReasonKey {
  if (preference === "item_sftp") return "user_item_sftp";
  if (preference === "tar") {
    return sourceHasTar && destHasTar ? "user_tar" : "tar_unavailable";
  }

  if (sourcePlatform === "windows" || destPlatform === "windows") {
    return "windows_host";
  }
  if (!sourceHasTar || !destHasTar) {
    return "tar_unavailable";
  }

  const { fileCount, totalBytes, largestFileBytes, incompressibleRatio } =
    summary;

  if (
    fileCount > 1 &&
    largestFileBytes >= 2 * GB &&
    totalBytes >= 500 * MB &&
    incompressibleRatio < 0.7
  ) {
    return "auto_multi_large";
  }

  if (fileCount === 1 && largestFileBytes >= 2 * GB) {
    return "auto_single_large_in_archive";
  }

  if (totalBytes >= 10 * GB && incompressibleRatio >= 0.5) {
    return "auto_many_incompressible";
  }
  if (incompressibleRatio >= 0.85) {
    return "auto_many_incompressible";
  }

  if (
    fileCount >= 100 ||
    (fileCount >= 20 && totalBytes >= 50 * MB && incompressibleRatio < 0.5) ||
    (fileCount > 5 && incompressibleRatio < 0.7)
  ) {
    return "auto_many_files";
  }

  if (resolvedMethod === "tar") {
    return "auto_many_files";
  }

  return "auto_default";
}
