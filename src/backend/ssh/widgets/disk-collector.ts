import type { Client } from "ssh2";
import { execCommand, toFixedNum } from "./common-utils.js";

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
      execCommand(client, "df -h -P / | tail -n +2"),
      execCommand(client, "df -B1 -P / | tail -n +2"),
    ]);

    const humanLine =
      diskOutHuman.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)[0] || "";
    const bytesLine =
      diskOutBytes.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)[0] || "";

    const humanParts = humanLine.split(/\s+/);
    const bytesParts = bytesLine.split(/\s+/);

    if (humanParts.length >= 6 && bytesParts.length >= 6) {
      totalHuman = humanParts[1] || null;
      usedHuman = humanParts[2] || null;
      availableHuman = humanParts[3] || null;

      const totalBytes = Number(bytesParts[1]);
      const usedBytes = Number(bytesParts[2]);

      if (
        Number.isFinite(totalBytes) &&
        Number.isFinite(usedBytes) &&
        totalBytes > 0
      ) {
        diskPercent = Math.max(
          0,
          Math.min(100, (usedBytes / totalBytes) * 100),
        );
      }
    }
  } catch (e) {
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
