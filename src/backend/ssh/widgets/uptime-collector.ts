import type { Client } from "ssh2";
import { execCommand } from "./common-utils.js";
import { statsLogger } from "../../utils/logger.js";

export async function collectUptimeMetrics(client: Client): Promise<{
  seconds: number | null;
  formatted: string | null;
}> {
  let uptimeSeconds: number | null = null;
  let uptimeFormatted: string | null = null;

  try {
    const uptimeOut = await execCommand(client, "cat /proc/uptime");
    const uptimeParts = uptimeOut.stdout.trim().split(/\s+/);
    if (uptimeParts.length >= 1) {
      uptimeSeconds = Number(uptimeParts[0]);
      if (Number.isFinite(uptimeSeconds)) {
        const days = Math.floor(uptimeSeconds / 86400);
        const hours = Math.floor((uptimeSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        uptimeFormatted = `${days}d ${hours}h ${minutes}m`;
      }
    }
  } catch (e) {
    statsLogger.debug("Failed to collect uptime", {
      operation: "uptime_failed",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return {
    seconds: uptimeSeconds,
    formatted: uptimeFormatted,
  };
}
