import type { Client } from "ssh2";
import { execCommand, toFixedNum } from "../widgets/common-utils.js";
import { isSafeNodeName } from "../../proxmox-shared.js";

export interface ProxmoxGuestSummaryEntry {
  vmid: number;
  name: string;
  type: "qemu" | "lxc";
  status: string;
  cpuPercent: number | null;
  memPercent: number | null;
  memUsedGiB: number | null;
  memTotalGiB: number | null;
  diskPercent: number | null;
  diskUsedGiB: number | null;
  diskTotalGiB: number | null;
  uptimeSeconds: number | null;
}

export interface ProxmoxGuestsSummaryResult {
  guests: ProxmoxGuestSummaryEntry[];
  counts: { running: number; stopped: number; total: number };
}

const EMPTY_RESULT: ProxmoxGuestsSummaryResult = {
  guests: [],
  counts: { running: 0, stopped: 0, total: 0 },
};

function bytesToGiB(bytes: number): number {
  return bytes / (1024 * 1024 * 1024);
}

export async function collectProxmoxGuestsSummary(
  client: Client,
  nodeName: string,
): Promise<ProxmoxGuestsSummaryResult> {
  if (!isSafeNodeName(nodeName)) {
    return EMPTY_RESULT;
  }

  try {
    const { stdout, code } = await execCommand(
      client,
      "pvesh get /cluster/resources --output-format json",
      25000,
    );
    if (code !== 0) {
      return EMPTY_RESULT;
    }

    const resources = JSON.parse(stdout);
    if (!Array.isArray(resources)) {
      return EMPTY_RESULT;
    }

    const guests: ProxmoxGuestSummaryEntry[] = [];
    for (const r of resources as Array<Record<string, unknown>>) {
      const type = r.type;
      if (type !== "qemu" && type !== "lxc") continue;
      if (r.node !== nodeName) continue;
      if (r.template === true || r.template === 1) continue;

      const cpuFraction = typeof r.cpu === "number" ? r.cpu : null;
      const mem = typeof r.mem === "number" ? r.mem : null;
      const maxmem = typeof r.maxmem === "number" ? r.maxmem : null;
      const memPercent =
        mem !== null && maxmem !== null && maxmem > 0
          ? Math.max(0, Math.min(100, (mem / maxmem) * 100))
          : null;

      const disk = typeof r.disk === "number" ? r.disk : null;
      const maxdisk = typeof r.maxdisk === "number" ? r.maxdisk : null;
      // QEMU guests without a running agent report maxdisk: 0 - a false 0%
      // is worse than an honest "unknown", so treat that as no data at all.
      const hasDiskData = maxdisk !== null && maxdisk > 0;
      const diskPercent =
        hasDiskData && disk !== null
          ? Math.max(0, Math.min(100, (disk / maxdisk) * 100))
          : null;

      guests.push({
        vmid: typeof r.vmid === "number" ? r.vmid : Number(r.vmid),
        name:
          typeof r.name === "string" && r.name ? r.name : String(r.vmid ?? ""),
        type,
        status: typeof r.status === "string" ? r.status : "unknown",
        cpuPercent: toFixedNum(
          cpuFraction !== null ? cpuFraction * 100 : null,
          0,
        ),
        memPercent: toFixedNum(memPercent, 0),
        memUsedGiB: mem !== null ? toFixedNum(bytesToGiB(mem), 2) : null,
        memTotalGiB: maxmem !== null ? toFixedNum(bytesToGiB(maxmem), 2) : null,
        diskPercent: toFixedNum(diskPercent, 0),
        diskUsedGiB:
          hasDiskData && disk !== null ? toFixedNum(bytesToGiB(disk), 2) : null,
        diskTotalGiB: hasDiskData ? toFixedNum(bytesToGiB(maxdisk), 2) : null,
        uptimeSeconds: typeof r.uptime === "number" ? r.uptime : null,
      });
    }

    const running = guests.filter((g) => g.status === "running").length;
    const stopped = guests.filter((g) => g.status !== "running").length;

    return {
      guests,
      counts: { running, stopped, total: guests.length },
    };
  } catch {
    return EMPTY_RESULT;
  }
}
