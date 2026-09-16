import type { Client } from "ssh2";
import {
  execCommand,
  execPowerShell,
  toFixedNum,
  type HostPlatform,
} from "./common-utils.js";

export function parseCpuLine(
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

// Parses macOS `top -l 1 -n 0` output, e.g.
// "CPU usage: 12.34% user, 5.67% sys, 81.99% idle"
export function parseDarwinCpuUsageLine(
  line: string,
): { percent: number } | undefined {
  const match = line.match(
    /([\d.]+)%\s*user,\s*([\d.]+)%\s*sys,\s*([\d.]+)%\s*idle/i,
  );
  if (!match) return undefined;
  const user = Number(match[1]);
  const sys = Number(match[2]);
  if (!Number.isFinite(user) || !Number.isFinite(sys)) return undefined;
  return { percent: Math.max(0, Math.min(100, user + sys)) };
}

async function collectDarwinCpuMetrics(client: Client): Promise<{
  percent: number | null;
  cores: number | null;
  load: [number, number, number] | null;
}> {
  let cpuPercent: number | null = null;
  let cores: number | null = null;
  let loadTriplet: [number, number, number] | null = null;

  try {
    const [topOut, coresOut, loadOut] = await Promise.race([
      Promise.all([
        execCommand(client, "top -l 1 -n 0"),
        execCommand(client, "sysctl -n hw.ncpu"),
        execCommand(client, "sysctl -n vm.loadavg"),
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("CPU metrics collection timeout")),
          25000,
        ),
      ),
    ]);

    const usageLine = topOut.stdout
      .split("\n")
      .find((l) => l.includes("CPU usage:"));
    const parsed = usageLine ? parseDarwinCpuUsageLine(usageLine) : undefined;
    if (parsed) cpuPercent = parsed.percent;

    const coresNum = Number((coresOut.stdout || "").trim());
    cores = Number.isFinite(coresNum) && coresNum > 0 ? coresNum : null;

    // sysctl -n vm.loadavg -> "{ 1.23 1.45 1.67 }"
    const loadMatch = loadOut.stdout.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    if (loadMatch) {
      loadTriplet = [
        Number(loadMatch[1]),
        Number(loadMatch[2]),
        Number(loadMatch[3]),
      ].map((v) => (Number.isFinite(v) ? Number(v) : 0)) as [
        number,
        number,
        number,
      ];
    }
  } catch {
    cpuPercent = null;
    loadTriplet = null;
  }

  return {
    percent: toFixedNum(cpuPercent, 0),
    cores,
    load: loadTriplet,
  };
}

// No POSIX-style load average exists on Windows, so `load` always stays null.
async function collectWindowsCpuMetrics(client: Client): Promise<{
  percent: number | null;
  cores: number | null;
  load: [number, number, number] | null;
}> {
  let cpuPercent: number | null = null;
  let cores: number | null = null;

  try {
    const { stdout } = await execPowerShell(
      client,
      "$cpu=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; $cores=(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors; [PSCustomObject]@{cpu=$cpu; cores=$cores} | ConvertTo-Json -Compress",
      25000,
    );
    const parsed = JSON.parse(stdout.trim());
    const cpuNum = Number(parsed?.cpu);
    const coresNum = Number(parsed?.cores);
    cpuPercent = Number.isFinite(cpuNum)
      ? Math.max(0, Math.min(100, cpuNum))
      : null;
    cores = Number.isFinite(coresNum) && coresNum > 0 ? coresNum : null;
  } catch {
    cpuPercent = null;
  }

  return {
    percent: toFixedNum(cpuPercent, 0),
    cores,
    load: null,
  };
}

export async function collectCpuMetrics(
  client: Client,
  platform?: HostPlatform,
): Promise<{
  percent: number | null;
  cores: number | null;
  load: [number, number, number] | null;
}> {
  if (platform === "darwin") {
    return collectDarwinCpuMetrics(client);
  }
  if (platform === "windows") {
    return collectWindowsCpuMetrics(client);
  }

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
  } catch {
    cpuPercent = null;
    loadTriplet = null;
  }

  return {
    percent: toFixedNum(cpuPercent, 0),
    cores,
    load: loadTriplet,
  };
}
