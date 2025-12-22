import type { Client } from "ssh2";
import { execCommand } from "./common-utils.js";
import { statsLogger } from "../../utils/logger.js";

export async function collectProcessesMetrics(client: Client): Promise<{
  total: number | null;
  running: number | null;
  top: Array<{
    pid: string;
    user: string;
    cpu: string;
    mem: string;
    command: string;
  }>;
}> {
  let totalProcesses: number | null = null;
  let runningProcesses: number | null = null;
  const topProcesses: Array<{
    pid: string;
    user: string;
    cpu: string;
    mem: string;
    command: string;
  }> = [];

  try {
    const psOut = await execCommand(client, "ps aux --sort=-%cpu | head -n 11");
    const psLines = psOut.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (psLines.length > 1) {
      for (let i = 1; i < Math.min(psLines.length, 11); i++) {
        const parts = psLines[i].split(/\s+/);
        if (parts.length >= 11) {
          const cpuVal = Number(parts[2]);
          const memVal = Number(parts[3]);
          topProcesses.push({
            pid: parts[1],
            user: parts[0],
            cpu: Number.isFinite(cpuVal) ? cpuVal.toString() : "0",
            mem: Number.isFinite(memVal) ? memVal.toString() : "0",
            command: parts.slice(10).join(" ").substring(0, 50),
          });
        }
      }
    }

    const procCount = await execCommand(client, "ps aux | wc -l");
    const runningCount = await execCommand(client, "ps aux | grep -c ' R '");

    const totalCount = Number(procCount.stdout.trim()) - 1;
    totalProcesses = Number.isFinite(totalCount) ? totalCount : null;

    const runningCount2 = Number(runningCount.stdout.trim());
    runningProcesses = Number.isFinite(runningCount2) ? runningCount2 : null;
  } catch (e) {
    statsLogger.debug("Failed to collect process stats", {
      operation: "process_stats_failed",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return {
    total: totalProcesses,
    running: runningProcesses,
    top: topProcesses,
  };
}
