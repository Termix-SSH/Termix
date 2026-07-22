import type { Client } from "ssh2";
import { execCommand, toFixedNum } from "./common-utils.js";

const PSEUDO_FS_RE = /^(tmpfs|devtmpfs|overlay|udev|none|shm)$/;

export interface DfRow {
  filesystem: string;
  mount: string;
  parts: string[];
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

export async function collectDiskMetrics(client: Client): Promise<{
  percent: number | null;
  usedHuman: string | null;
  totalHuman: string | null;
  availableHuman: string | null;
}> {
  let diskPercent: number | null = null;
  let usedHuman: string | null = null;
  let totalHuman: string | null = null;
  let availableHuman: string | null = null;

  try {
    const [diskOutHuman, diskOutBytes] = await Promise.all([
      execCommand(client, "df -h -P | tail -n +2"),
      execCommand(client, "df -B1 -P | tail -n +2"),
    ]);

    const humanRows = parseDfLines(diskOutHuman.stdout);
    const bytesRows = parseDfLines(diskOutBytes.stdout);
    const worst = findWorstMountIndex(bytesRows);

    if (worst.totalBytes > 0) {
      diskPercent = Math.max(
        0,
        Math.min(100, (worst.usedBytes / worst.totalBytes) * 100),
      );

      const humanRow =
        humanRows.length === bytesRows.length
          ? humanRows[worst.index]
          : humanRows.find((row) => row.mount === bytesRows[worst.index].mount);
      if (humanRow) {
        totalHuman = humanRow.parts[1] || null;
        usedHuman = humanRow.parts[2] || null;
        availableHuman = humanRow.parts[3] || null;
      }
    }
  } catch {
    diskPercent = null;
    usedHuman = null;
    totalHuman = null;
    availableHuman = null;
  }

  return {
    percent: toFixedNum(diskPercent, 0),
    usedHuman,
    totalHuman,
    availableHuman,
  };
}
