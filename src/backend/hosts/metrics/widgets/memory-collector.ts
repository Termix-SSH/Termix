import type { Client } from "ssh2";
import {
  execCommand,
  execPowerShell,
  toFixedNum,
  kibToGiB,
  type HostPlatform,
} from "./common-utils.js";

async function collectDarwinMemoryMetrics(client: Client): Promise<{
  percent: number | null;
  usedGiB: number | null;
  totalGiB: number | null;
}> {
  let memPercent: number | null = null;
  let usedGiB: number | null = null;
  let totalGiB: number | null = null;

  try {
    const [vmStatOut, memSizeOut] = await Promise.all([
      execCommand(client, "vm_stat"),
      execCommand(client, "sysctl -n hw.memsize"),
    ]);

    const totalBytes = Number((memSizeOut.stdout || "").trim());
    const pageSizeMatch = vmStatOut.stdout.match(/page size of (\d+) bytes/);
    const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 4096;

    const getPages = (key: string): number | null => {
      const line = vmStatOut.stdout
        .split("\n")
        .find((l) => l.trim().startsWith(key));
      if (!line) return null;
      const m = line.match(/(\d+)\./);
      return m ? Number(m[1]) : null;
    };

    const active = getPages("Pages active");
    const wired = getPages("Pages wired down");
    const compressed = getPages("Pages occupied by compressor");

    if (
      Number.isFinite(totalBytes) &&
      totalBytes > 0 &&
      active !== null &&
      wired !== null
    ) {
      const usedPages = active + wired + (compressed ?? 0);
      const usedBytes = usedPages * pageSize;
      memPercent = Math.max(0, Math.min(100, (usedBytes / totalBytes) * 100));
      usedGiB = kibToGiB(usedBytes / 1024);
      totalGiB = kibToGiB(totalBytes / 1024);
    }
  } catch {
    memPercent = null;
    usedGiB = null;
    totalGiB = null;
  }

  return {
    percent: toFixedNum(memPercent, 0),
    usedGiB: usedGiB ? toFixedNum(usedGiB, 2) : null,
    totalGiB: totalGiB ? toFixedNum(totalGiB, 2) : null,
  };
}

// Win32_OperatingSystem reports TotalVisibleMemorySize/FreePhysicalMemory in KB.
async function collectWindowsMemoryMetrics(client: Client): Promise<{
  percent: number | null;
  usedGiB: number | null;
  totalGiB: number | null;
}> {
  let memPercent: number | null = null;
  let usedGiB: number | null = null;
  let totalGiB: number | null = null;

  try {
    const { stdout } = await execPowerShell(
      client,
      "$os=Get-CimInstance Win32_OperatingSystem; [PSCustomObject]@{total=$os.TotalVisibleMemorySize; free=$os.FreePhysicalMemory} | ConvertTo-Json -Compress",
    );
    const parsed = JSON.parse(stdout.trim());
    const totalKb = Number(parsed?.total);
    const freeKb = Number(parsed?.free);
    if (Number.isFinite(totalKb) && Number.isFinite(freeKb) && totalKb > 0) {
      const usedKb = totalKb - freeKb;
      memPercent = Math.max(0, Math.min(100, (usedKb / totalKb) * 100));
      usedGiB = kibToGiB(usedKb);
      totalGiB = kibToGiB(totalKb);
    }
  } catch {
    memPercent = null;
    usedGiB = null;
    totalGiB = null;
  }

  return {
    percent: toFixedNum(memPercent, 0),
    usedGiB: usedGiB ? toFixedNum(usedGiB, 2) : null,
    totalGiB: totalGiB ? toFixedNum(totalGiB, 2) : null,
  };
}

export async function collectMemoryMetrics(
  client: Client,
  platform?: HostPlatform,
): Promise<{
  percent: number | null;
  usedGiB: number | null;
  totalGiB: number | null;
}> {
  if (platform === "darwin") {
    return collectDarwinMemoryMetrics(client);
  }
  if (platform === "windows") {
    return collectWindowsMemoryMetrics(client);
  }

  let memPercent: number | null = null;
  let usedGiB: number | null = null;
  let totalGiB: number | null = null;

  try {
    const memInfo = await execCommand(client, "cat /proc/meminfo");
    const lines = memInfo.stdout.split("\n");
    const getVal = (key: string) => {
      const line = lines.find((l) => l.startsWith(key));
      if (!line) return null;
      const m = line.match(/\d+/);
      return m ? Number(m[0]) : null;
    };
    const totalKb = getVal("MemTotal:");
    const availKb = getVal("MemAvailable:");
    if (totalKb && availKb && totalKb > 0) {
      const usedKb = totalKb - availKb;
      memPercent = Math.max(0, Math.min(100, (usedKb / totalKb) * 100));
      usedGiB = kibToGiB(usedKb);
      totalGiB = kibToGiB(totalKb);
    }
  } catch {
    memPercent = null;
    usedGiB = null;
    totalGiB = null;
  }

  return {
    percent: toFixedNum(memPercent, 0),
    usedGiB: usedGiB ? toFixedNum(usedGiB, 2) : null,
    totalGiB: totalGiB ? toFixedNum(totalGiB, 2) : null,
  };
}
