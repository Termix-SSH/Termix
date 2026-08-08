import type { Client } from "ssh2";
import { execCommand, toFixedNum } from "./common-utils.js";

const PSEUDO_FS_RE = /^(tmpfs|devtmpfs|overlay|udev|none|shm)$/;

export interface DfRow {
  filesystem: string;
  mount: string;
  parts: string[];
}

export interface DiskFilesystem {
  filesystem: string;
  mount: string;
  percent: number | null;
  usedHuman: string | null;
  totalHuman: string | null;
  availableHuman: string | null;
  usedBytes: number | null;
  totalBytes: number | null;
  availableBytes: number | null;
}

export function parseDfLines(output: string): DfRow[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return { filesystem: parts[0] || "", mount: parts[5] || "", parts };
    })
    .filter(
      (row) => row.parts.length >= 6 && !PSEUDO_FS_RE.test(row.filesystem),
    );
}

// Finds the index of the most-utilized real filesystem in a `df -B1`-style
// row set (parts[1] = total bytes, parts[2] = used bytes), so a nearly-full
// secondary mount (e.g. /data) isn't hidden behind a healthy root filesystem.
export function findWorstMountIndex(bytesRows: DfRow[]): {
  index: number;
  usedBytes: number;
  totalBytes: number;
} {
  let worstIndex = -1;
  let worstUsedBytes = -1;
  let worstTotalBytes = 0;

  bytesRows.forEach((row, index) => {
    const totalBytes = Number(row.parts[1]);
    const usedBytes = Number(row.parts[2]);
    if (
      !Number.isFinite(totalBytes) ||
      !Number.isFinite(usedBytes) ||
      totalBytes <= 0
    ) {
      return;
    }
    const usedRatio = usedBytes / totalBytes;
    const worstRatio =
      worstTotalBytes > 0 ? worstUsedBytes / worstTotalBytes : -1;
    if (usedRatio > worstRatio) {
      worstIndex = index;
      worstUsedBytes = usedBytes;
      worstTotalBytes = totalBytes;
    }
  });

  return {
    index: worstIndex,
    usedBytes: worstUsedBytes,
    totalBytes: worstTotalBytes,
  };
}

// Merges the `df -B1` and `df -h` row sets into one filesystem list. Byte rows
// drive the maths; human rows only supply the display strings, matched by mount
// point so a mismatched row count can't shift the columns.
export function buildFilesystemList(
  bytesRows: DfRow[],
  humanRows: DfRow[],
): DiskFilesystem[] {
  const aligned = humanRows.length === bytesRows.length;

  return bytesRows
    .map((row, index) => {
      const totalBytes = Number(row.parts[1]);
      const usedBytes = Number(row.parts[2]);
      const availableBytes = Number(row.parts[3]);
      if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;

      const humanRow = aligned
        ? humanRows[index]
        : humanRows.find((h) => h.mount === row.mount);

      const percent = Number.isFinite(usedBytes)
        ? Math.max(0, Math.min(100, (usedBytes / totalBytes) * 100))
        : null;

      return {
        filesystem: row.filesystem,
        mount: row.mount,
        percent: toFixedNum(percent, 0),
        usedHuman: humanRow?.parts[2] || null,
        totalHuman: humanRow?.parts[1] || null,
        availableHuman: humanRow?.parts[3] || null,
        usedBytes: Number.isFinite(usedBytes) ? usedBytes : null,
        totalBytes,
        availableBytes: Number.isFinite(availableBytes) ? availableBytes : null,
      };
    })
    .filter((fs): fs is DiskFilesystem => fs !== null);
}

// The headline disk figure should be the root filesystem - that is what users
// mean by "the server's disk". Only when there is no root mount (containers,
// chroots) do we fall back to the most-utilized mount.
export function selectPrimaryFilesystem(
  filesystems: DiskFilesystem[],
): DiskFilesystem | null {
  if (filesystems.length === 0) return null;

  const root = filesystems.find((fs) => fs.mount === "/");
  if (root) return root;

  let best = filesystems[0];
  for (const fs of filesystems) {
    const ratio = (fs.usedBytes ?? 0) / (fs.totalBytes || 1);
    const bestRatio = (best.usedBytes ?? 0) / (best.totalBytes || 1);
    if (ratio > bestRatio) best = fs;
  }
  return best;
}

export async function collectDiskMetrics(client: Client): Promise<{
  percent: number | null;
  usedHuman: string | null;
  totalHuman: string | null;
  availableHuman: string | null;
  mount: string | null;
  filesystems: DiskFilesystem[];
}> {
  try {
    const [diskOutHuman, diskOutBytes] = await Promise.all([
      execCommand(client, "df -h -P | tail -n +2"),
      execCommand(client, "df -B1 -P | tail -n +2"),
    ]);

    const humanRows = parseDfLines(diskOutHuman.stdout);
    const bytesRows = parseDfLines(diskOutBytes.stdout);
    const filesystems = buildFilesystemList(bytesRows, humanRows);
    const primary = selectPrimaryFilesystem(filesystems);

    return {
      percent: primary?.percent ?? null,
      usedHuman: primary?.usedHuman ?? null,
      totalHuman: primary?.totalHuman ?? null,
      availableHuman: primary?.availableHuman ?? null,
      mount: primary?.mount ?? null,
      filesystems,
    };
  } catch {
    return {
      percent: null,
      usedHuman: null,
      totalHuman: null,
      availableHuman: null,
      mount: null,
      filesystems: [],
    };
  }
}
