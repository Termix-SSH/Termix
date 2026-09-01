import type { Client } from "ssh2";
import { execCommand, toFixedNum } from "../widgets/common-utils.js";
import { isSafeNodeName } from "../../proxmox-shared.js";

export interface ProxmoxNodeStatusResult {
  cpu: {
    percent: number | null;
    cores: number | null;
    load: [number, number, number] | null;
  };
  memory: {
    percent: number | null;
    usedGiB: number | null;
    totalGiB: number | null;
  };
  disk: {
    percent: number | null;
    usedGiB: number | null;
    totalGiB: number | null;
  };
  uptime: {
    seconds: number | null;
    formatted: string | null;
  };
  system: {
    hostname: string | null;
    kernel: string | null;
    pveVersion: string | null;
  };
}

const EMPTY_RESULT: ProxmoxNodeStatusResult = {
  cpu: { percent: null, cores: null, load: null },
  memory: { percent: null, usedGiB: null, totalGiB: null },
  disk: { percent: null, usedGiB: null, totalGiB: null },
  uptime: { seconds: null, formatted: null },
  system: { hostname: null, kernel: null, pveVersion: null },
};

function bytesToGiB(bytes: number): number {
  return bytes / (1024 * 1024 * 1024);
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

export async function collectProxmoxNodeStatus(
  client: Client,
  nodeName: string,
): Promise<ProxmoxNodeStatusResult> {
  if (!isSafeNodeName(nodeName)) {
    return EMPTY_RESULT;
  }

  try {
    const { stdout, code } = await execCommand(
      client,
      `pvesh get /nodes/${nodeName}/status --output-format json`,
      25000,
    );
    if (code !== 0) {
      return EMPTY_RESULT;
    }

    const data = JSON.parse(stdout) as Record<string, unknown>;

    const cpuFraction = typeof data.cpu === "number" ? data.cpu : null;
    const cpuinfo = (data.cpuinfo as Record<string, unknown>) || {};
    const cores = typeof cpuinfo.cores === "number" ? cpuinfo.cores : null;
    const loadavgRaw = data.loadavg;
    let load: [number, number, number] | null = null;
    if (Array.isArray(loadavgRaw) && loadavgRaw.length >= 3) {
      const parsed = loadavgRaw
        .slice(0, 3)
        .map((v) => Number(v))
        .map((v) => (Number.isFinite(v) ? v : 0));
      load = parsed as [number, number, number];
    }

    const memory = (data.memory as Record<string, unknown>) || {};
    const memUsed = typeof memory.used === "number" ? memory.used : null;
    const memTotal = typeof memory.total === "number" ? memory.total : null;
    const memPercent =
      memUsed !== null && memTotal !== null && memTotal > 0
        ? Math.max(0, Math.min(100, (memUsed / memTotal) * 100))
        : null;

    const rootfs = (data.rootfs as Record<string, unknown>) || {};
    const diskUsed = typeof rootfs.used === "number" ? rootfs.used : null;
    const diskTotal = typeof rootfs.total === "number" ? rootfs.total : null;
    const diskPercent =
      diskUsed !== null && diskTotal !== null && diskTotal > 0
        ? Math.max(0, Math.min(100, (diskUsed / diskTotal) * 100))
        : null;

    const uptimeSeconds = typeof data.uptime === "number" ? data.uptime : null;

    return {
      cpu: {
        percent: toFixedNum(cpuFraction !== null ? cpuFraction * 100 : null, 0),
        cores,
        load,
      },
      memory: {
        percent: toFixedNum(memPercent, 0),
        usedGiB: memUsed !== null ? toFixedNum(bytesToGiB(memUsed), 2) : null,
        totalGiB:
          memTotal !== null ? toFixedNum(bytesToGiB(memTotal), 2) : null,
      },
      disk: {
        percent: toFixedNum(diskPercent, 0),
        usedGiB: diskUsed !== null ? toFixedNum(bytesToGiB(diskUsed), 2) : null,
        totalGiB:
          diskTotal !== null ? toFixedNum(bytesToGiB(diskTotal), 2) : null,
      },
      uptime: {
        seconds: uptimeSeconds,
        formatted: uptimeSeconds !== null ? formatUptime(uptimeSeconds) : null,
      },
      system: {
        hostname:
          typeof data.hostname === "string" && data.hostname
            ? data.hostname
            : null,
        kernel:
          typeof data.kversion === "string" && data.kversion
            ? data.kversion
            : null,
        pveVersion:
          typeof data.pveversion === "string" && data.pveversion
            ? data.pveversion
            : null,
      },
    };
  } catch {
    return EMPTY_RESULT;
  }
}
