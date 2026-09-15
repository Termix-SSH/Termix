import type { Client } from "ssh2";
import {
  execCommand,
  execPowerShell,
  type HostPlatform,
} from "./common-utils.js";

function formatUptime(uptimeSeconds: number): string {
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

async function collectDarwinUptimeMetrics(client: Client): Promise<{
  seconds: number | null;
  formatted: string | null;
}> {
  let uptimeSeconds: number | null = null;
  let uptimeFormatted: string | null = null;

  try {
    const bootTimeOut = await execCommand(client, "sysctl -n kern.boottime");
    // "{ sec = 1700000000, usec = 123456 } Thu Nov 16 ..."
    const match = bootTimeOut.stdout.match(/sec\s*=\s*(\d+)/);
    if (match) {
      const bootSeconds = Number(match[1]);
      if (Number.isFinite(bootSeconds)) {
        uptimeSeconds = Math.max(0, Date.now() / 1000 - bootSeconds);
        uptimeFormatted = formatUptime(uptimeSeconds);
      }
    }
  } catch {
    // expected
  }

  return {
    seconds: uptimeSeconds,
    formatted: uptimeFormatted,
  };
}

async function collectWindowsUptimeMetrics(client: Client): Promise<{
  seconds: number | null;
  formatted: string | null;
}> {
  let uptimeSeconds: number | null = null;
  let uptimeFormatted: string | null = null;

  try {
    const { stdout } = await execPowerShell(
      client,
      "$os=Get-CimInstance Win32_OperatingSystem; [PSCustomObject]@{seconds=((Get-Date) - $os.LastBootUpTime).TotalSeconds} | ConvertTo-Json -Compress",
    );
    const parsed = JSON.parse(stdout.trim());
    const seconds = Number(parsed?.seconds);
    if (Number.isFinite(seconds)) {
      uptimeSeconds = Math.max(0, seconds);
      uptimeFormatted = formatUptime(uptimeSeconds);
    }
  } catch {
    // expected
  }

  return {
    seconds: uptimeSeconds,
    formatted: uptimeFormatted,
  };
}

export async function collectUptimeMetrics(
  client: Client,
  platform?: HostPlatform,
): Promise<{
  seconds: number | null;
  formatted: string | null;
}> {
  if (platform === "darwin") {
    return collectDarwinUptimeMetrics(client);
  }
  if (platform === "windows") {
    return collectWindowsUptimeMetrics(client);
  }

  let uptimeSeconds: number | null = null;
  let uptimeFormatted: string | null = null;

  try {
    const uptimeOut = await execCommand(client, "cat /proc/uptime");
    const uptimeParts = uptimeOut.stdout.trim().split(/\s+/);
    if (uptimeParts.length >= 1) {
      uptimeSeconds = Number(uptimeParts[0]);
      if (Number.isFinite(uptimeSeconds)) {
        uptimeFormatted = formatUptime(uptimeSeconds);
      }
    }
  } catch {
    // expected
  }

  return {
    seconds: uptimeSeconds,
    formatted: uptimeFormatted,
  };
}
