import type { Client } from "ssh2";
import { execCommand, toFixedNum } from "./common-utils.js";

function parseCpuLine(
  cpuLine: string,
): { total: number; idle: number } | undefined {
  const parts = cpuLine.trim().split(/\s+/);
  if (parts[0] !== "cpu") return undefined;
  const nums = parts
    .slice(1)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));
  if (nums.length < 4) return undefined;
  const idle = (nums[3] ?? 0) + (nums[4] ?? 0);
  const total = nums.reduce((a, b) => a + b, 0);
  return { total, idle };
}

export async function collectCpuMetrics(client: Client): Promise<{
  percent: number | null;
  cores: number | null;
  load: [number, number, number] | null;
}> {
  let cpuPercent: number | null = null;
  let cores: number | null = null;
  let loadTriplet: [number, number, number] | null = null;

  try {
    const [stat1, loadAvgOut, coresOut] = await Promise.race([
      Promise.all([
        execCommand(client, "cat /proc/stat"),
        execCommand(client, "cat /proc/loadavg"),
        execCommand(
          client,
          "nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo",
        ),
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("CPU metrics collection timeout")),
          25000,
        ),
      ),
    ]);

    await new Promise((r) => setTimeout(r, 500));
    const stat2 = await execCommand(client, "cat /proc/stat");

    const cpuLine1 = (
      stat1.stdout.split("\n").find((l) => l.startsWith("cpu ")) || ""
    ).trim();
    const cpuLine2 = (
      stat2.stdout.split("\n").find((l) => l.startsWith("cpu ")) || ""
    ).trim();
    const a = parseCpuLine(cpuLine1);
    const b = parseCpuLine(cpuLine2);
    if (a && b) {
      const totalDiff = b.total - a.total;
      const idleDiff = b.idle - a.idle;
      const used = totalDiff - idleDiff;
      if (totalDiff > 0)
        cpuPercent = Math.max(0, Math.min(100, (used / totalDiff) * 100));
    }

    const laParts = loadAvgOut.stdout.trim().split(/\s+/);
    if (laParts.length >= 3) {
      loadTriplet = [
        Number(laParts[0]),
        Number(laParts[1]),
        Number(laParts[2]),
      ].map((v) => (Number.isFinite(v) ? Number(v) : 0)) as [
        number,
        number,
        number,
      ];
    }

    const coresNum = Number((coresOut.stdout || "").trim());
    cores = Number.isFinite(coresNum) && coresNum > 0 ? coresNum : null;
  } catch (e) {
    cpuPercent = null;
    cores = null;
    loadTriplet = null;
  }

  return {
    percent: toFixedNum(cpuPercent, 0),
    cores,
    load: loadTriplet,
  };
}
