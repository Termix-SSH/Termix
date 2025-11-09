import type { Client } from "ssh2";
import { execCommand, toFixedNum, kibToGiB } from "./common-utils.js";

export async function collectMemoryMetrics(client: Client): Promise<{
  percent: number | null;
  usedGiB: number | null;
  totalGiB: number | null;
}> {
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
  } catch (e) {
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
