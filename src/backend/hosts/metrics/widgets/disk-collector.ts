import type { Client } from "ssh2";
import {
  execCommand,
  execPowerShell,
  toFixedNum,
  type HostPlatform,
} from "./common-utils.js";

const PSEUDO_FS_RE = /^(tmpfs|devtmpfs|overlay|udev|none|shm)$/;

export interface DfRow {
  filesystem: string;
  type: string;
  mount: string;
  parts: string[];
}

export interface DiskFilesystem {
  filesystem: string;
  type: string;
  mount: string;
  percent: number | null;
  usedHuman: string | null;
  totalHuman: string | null;
  availableHuman: string | null;
  usedBytes: number | null;
  totalBytes: number | null;
  availableBytes: number | null;
  label?: string;
}

export interface MonitoredMount {
  path: string;
  label?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Parses `df -T -P`-style output: Filesystem, Type, then the size columns,
// with Mounted-on last. The Type column (e.g. ext4, nfs4, cifs) is what lets
// callers filter network shares out by filesystem type rather than guessing
// from the source path.
export function parseDfLines(output: string): DfRow[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return {
        filesystem: parts[0] || "",
        type: parts[1] || "",
        mount: parts[6] || "",
        parts,
      };
    })
    .filter((row) => row.parts.length >= 7 && !PSEUDO_FS_RE.test(row.type));
}

// Finds the index of the most-utilized real filesystem in a GNU `df -TkP`-style
// row set (parts[2] = total KB, parts[3] = used KB), so a nearly-full
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
    const totalBytes = Number(row.parts[2]);
    const usedBytes = Number(row.parts[3]);
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

// Merges a GNU `df -TkP` size-row set (parts[2..4] in `blockSizeBytes` units)
// and a `df -hT -P` human-row set into one filesystem list. Byte rows drive
// the maths; human rows only supply the display strings, matched by mount
// point so a mismatched row count can't shift the columns.
export function buildFilesystemList(
  bytesRows: DfRow[],
  humanRows: DfRow[],
  blockSizeBytes = 1,
): DiskFilesystem[] {
  const aligned = humanRows.length === bytesRows.length;

  return bytesRows
    .map((row, index) => {
      const totalBytes = Number(row.parts[2]) * blockSizeBytes;
      const usedBytes = Number(row.parts[3]) * blockSizeBytes;
      const availableBytes = Number(row.parts[4]) * blockSizeBytes;
      if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;

      const humanRow = aligned
        ? humanRows[index]
        : humanRows.find((h) => h.mount === row.mount);

      const percent = Number.isFinite(usedBytes)
        ? Math.max(0, Math.min(100, (usedBytes / totalBytes) * 100))
        : null;

      return {
        filesystem: row.filesystem,
        type: row.type,
        mount: row.mount,
        percent: toFixedNum(percent, 0),
        usedHuman: humanRow?.parts[3] || null,
        totalHuman: humanRow?.parts[2] || null,
        availableHuman: humanRow?.parts[4] || null,
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

// Excluded mounts are user-configured per host: an exact mount-path match
// (e.g. "/mnt/nas") or a filesystem-type substring match (e.g. "nfs" matches
// nfs/nfs4, "cifs" matches cifs/smb3), so network shares can be dropped from
// the headline percent and the filesystem list without hiding local disks.
export function filterExcludedFilesystems(
  filesystems: DiskFilesystem[],
  excludedMounts?: string[] | null,
): DiskFilesystem[] {
  if (!excludedMounts || excludedMounts.length === 0) return filesystems;

  const normalized = excludedMounts
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length === 0) return filesystems;

  return filesystems.filter((fs) => {
    const mount = fs.mount.toLowerCase();
    const type = fs.type.toLowerCase();
    return !normalized.some(
      (entry) => mount === entry || (type && type.includes(entry)),
    );
  });
}

export function mergeMonitoredFilesystems(
  filesystems: DiskFilesystem[],
  monitored: MonitoredMount[],
  customFilesystems: Array<DiskFilesystem | null>,
): DiskFilesystem[] {
  const result = [...filesystems];
  monitored.forEach((entry, index) => {
    const path = entry.path.trim();
    const custom = customFilesystems[index];
    if (!path || !custom) return;

    const existing = result.find((fs) => fs.mount === path);
    if (existing) {
      existing.label = entry.label?.trim() || undefined;
      return;
    }
    result.push({
      ...custom,
      mount: path,
      label: entry.label?.trim() || undefined,
    });
  });
  return result;
}

function humanizeBytes(bytes: number): string {
  const units = ["B", "K", "M", "G", "T", "P"];
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const rounded =
    unitIndex > 0 && value < 10 ? value.toFixed(1) : Math.round(value);
  return `${rounded}${units[unitIndex]}`;
}

// BSD/macOS `df -T` takes a filesystem-type argument to *filter* by, unlike
// GNU `df -T` which *prints* a type column - so macOS needs its own command
// (`df -Pk`, no type column) and gets the type separately from `mount`.
const DARWIN_SKIP_MOUNT_RE =
  /^\/System\/Volumes\/(VM|Preboot|Update|xarts|iSCPreboot|Hardware)(\/|$)/;
const DARWIN_SKIP_TYPE_RE = /^(devfs|autofs)$/;

export function parseDarwinMountTypes(output: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of output.split("\n")) {
    // Device names can contain spaces (e.g. autofs's "map auto_home"), so
    // match the literal " on " / " (" separators rather than a single token.
    const match = line.match(/^.+? on (.+?) \(([^,)]+)/);
    if (match) map.set(match[1], match[2].trim());
  }
  return map;
}

export function parseDarwinDfRows(
  output: string,
  typeByMount: Map<string, string>,
): DiskFilesystem[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      if (parts.length < 6) return null;

      const filesystem = parts[0];
      const totalKb = Number(parts[1]);
      const usedKb = Number(parts[2]);
      const availableKb = Number(parts[3]);
      const mount = parts.slice(5).join(" ");
      if (!Number.isFinite(totalKb) || totalKb <= 0) return null;
      if (DARWIN_SKIP_MOUNT_RE.test(mount)) return null;

      const type = typeByMount.get(mount) || "";
      if (DARWIN_SKIP_TYPE_RE.test(type)) return null;

      const totalBytes = totalKb * 1024;
      const usedBytes = Number.isFinite(usedKb) ? usedKb * 1024 : null;
      const availableBytes = Number.isFinite(availableKb)
        ? availableKb * 1024
        : null;
      const percent =
        usedBytes !== null
          ? Math.max(0, Math.min(100, (usedBytes / totalBytes) * 100))
          : null;

      return {
        filesystem,
        type,
        mount,
        percent: toFixedNum(percent, 0),
        usedHuman: usedBytes !== null ? humanizeBytes(usedBytes) : null,
        totalHuman: humanizeBytes(totalBytes),
        availableHuman:
          availableBytes !== null ? humanizeBytes(availableBytes) : null,
        usedBytes,
        totalBytes,
        availableBytes,
      };
    })
    .filter((fs): fs is DiskFilesystem => fs !== null);
}

async function collectDarwinDiskMetrics(
  client: Client,
  excludedMounts?: string[] | null,
  monitoredMounts?: MonitoredMount[] | null,
): Promise<{
  percent: number | null;
  usedHuman: string | null;
  totalHuman: string | null;
  availableHuman: string | null;
  mount: string | null;
  filesystems: DiskFilesystem[];
}> {
  try {
    const [dfOut, mountOut] = await Promise.all([
      execCommand(client, "df -Pk | tail -n +2"),
      execCommand(client, "mount"),
    ]);

    const typeByMount = parseDarwinMountTypes(mountOut.stdout);
    let detected = parseDarwinDfRows(dfOut.stdout, typeByMount);

    const monitored = (monitoredMounts ?? []).filter((entry) =>
      Boolean(entry.path.trim()),
    );
    if (monitored.length > 0) {
      const customFilesystems = await Promise.all(
        monitored.map(async (entry) => {
          const path = shellQuote(entry.path.trim());
          try {
            const custom = await execCommand(
              client,
              `df -Pk -- ${path} | tail -n +2`,
            );
            return parseDarwinDfRows(custom.stdout, typeByMount)[0] ?? null;
          } catch {
            return null;
          }
        }),
      );
      detected = mergeMonitoredFilesystems(
        detected,
        monitored,
        customFilesystems,
      );
    }

    const filesystems = filterExcludedFilesystems(detected, excludedMounts);
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

interface WindowsDiskRow {
  drive: string;
  total: number;
  free: number;
}

const WINDOWS_DISK_SCRIPT =
  'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {' +
  " [PSCustomObject]@{drive=$_.DeviceID; total=$_.Size; free=$_.FreeSpace}" +
  " } | ConvertTo-Json -Compress";

export function parseWindowsDiskJson(output: string): WindowsDiskRow[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .filter((row): row is Record<string, unknown> => Boolean(row?.drive))
      .map((row) => ({
        drive: String(row.drive),
        total: Number(row.total),
        free: Number(row.free),
      }))
      .filter((row) => Number.isFinite(row.total) && row.total > 0);
  } catch {
    return [];
  }
}

async function collectWindowsDiskMetrics(
  client: Client,
  excludedMounts?: string[] | null,
): Promise<{
  percent: number | null;
  usedHuman: string | null;
  totalHuman: string | null;
  availableHuman: string | null;
  mount: string | null;
  filesystems: DiskFilesystem[];
}> {
  try {
    const { stdout } = await execPowerShell(client, WINDOWS_DISK_SCRIPT);
    const rows = parseWindowsDiskJson(stdout);

    const filesystems: DiskFilesystem[] = rows.map((row) => {
      const usedBytes = row.total - row.free;
      const percent = Math.max(0, Math.min(100, (usedBytes / row.total) * 100));
      return {
        filesystem: row.drive,
        type: "NTFS",
        mount: row.drive,
        percent: toFixedNum(percent, 0),
        usedHuman: humanizeBytes(usedBytes),
        totalHuman: humanizeBytes(row.total),
        availableHuman: humanizeBytes(row.free),
        usedBytes,
        totalBytes: row.total,
        availableBytes: row.free,
      };
    });

    const filtered = filterExcludedFilesystems(filesystems, excludedMounts);
    const primary =
      filtered.find((fs) => fs.mount.toUpperCase().startsWith("C")) ??
      filtered[0] ??
      null;

    return {
      percent: primary?.percent ?? null,
      usedHuman: primary?.usedHuman ?? null,
      totalHuman: primary?.totalHuman ?? null,
      availableHuman: primary?.availableHuman ?? null,
      mount: primary?.mount ?? null,
      filesystems: filtered,
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

export async function collectDiskMetrics(
  client: Client,
  excludedMounts?: string[] | null,
  monitoredMounts?: MonitoredMount[] | null,
  platform?: HostPlatform,
): Promise<{
  percent: number | null;
  usedHuman: string | null;
  totalHuman: string | null;
  availableHuman: string | null;
  mount: string | null;
  filesystems: DiskFilesystem[];
}> {
  if (platform === "windows") {
    return collectWindowsDiskMetrics(client, excludedMounts);
  }
  if (platform === "darwin") {
    return collectDarwinDiskMetrics(client, excludedMounts, monitoredMounts);
  }

  try {
    const [diskOutHuman, diskOutBytes] = await Promise.all([
      execCommand(client, "df -hT -P | tail -n +2"),
      execCommand(client, "df -TkP | tail -n +2"),
    ]);

    const humanRows = parseDfLines(diskOutHuman.stdout);
    const bytesRows = parseDfLines(diskOutBytes.stdout);
    let detected = buildFilesystemList(bytesRows, humanRows, 1024);
    const monitored = (monitoredMounts ?? []).filter((entry) =>
      Boolean(entry.path.trim()),
    );
    if (monitored.length > 0) {
      const customFilesystems = await Promise.all(
        monitored.map(async (entry) => {
          const path = shellQuote(entry.path.trim());
          try {
            const [customHuman, customBytes] = await Promise.all([
              execCommand(client, `df -hT -P -- ${path} | tail -n +2`),
              execCommand(client, `df -TkP -- ${path} | tail -n +2`),
            ]);
            return (
              buildFilesystemList(
                parseDfLines(customBytes.stdout),
                parseDfLines(customHuman.stdout),
                1024,
              )[0] ?? null
            );
          } catch {
            return null;
          }
        }),
      );
      detected = mergeMonitoredFilesystems(
        detected,
        monitored,
        customFilesystems,
      );
    }
    const filesystems = filterExcludedFilesystems(detected, excludedMounts);
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
