import type { Client } from "ssh2";
import { execCommand, toFixedNum } from "../widgets/common-utils.js";
import { isSafeNodeName } from "../../proxmox-shared.js";

export interface ProxmoxStoragePoolEntry {
  name: string;
  type: string;
  active: boolean;
  enabled: boolean;
  usedGiB: number | null;
  totalGiB: number | null;
  availGiB: number | null;
  percent: number | null;
}

export interface ProxmoxStorageResult {
  pools: ProxmoxStoragePoolEntry[];
}

const EMPTY_RESULT: ProxmoxStorageResult = { pools: [] };

function bytesToGiB(bytes: number): number {
  return bytes / (1024 * 1024 * 1024);
}

export async function collectProxmoxStorage(
  client: Client,
  nodeName: string,
): Promise<ProxmoxStorageResult> {
  if (!isSafeNodeName(nodeName)) {
    return EMPTY_RESULT;
  }

  try {
    const { stdout, code } = await execCommand(
      client,
      `pvesh get /nodes/${nodeName}/storage --output-format json`,
      25000,
    );
    if (code !== 0) {
      return EMPTY_RESULT;
    }

    const data = JSON.parse(stdout);
    if (!Array.isArray(data)) {
      return EMPTY_RESULT;
    }

    const pools: ProxmoxStoragePoolEntry[] = (
      data as Array<Record<string, unknown>>
    ).map((entry) => {
      const used = typeof entry.used === "number" ? entry.used : null;
      const total = typeof entry.total === "number" ? entry.total : null;
      const avail = typeof entry.avail === "number" ? entry.avail : null;
      const percent =
        used !== null && total !== null && total > 0
          ? Math.max(0, Math.min(100, (used / total) * 100))
          : null;

      return {
        name: typeof entry.storage === "string" ? entry.storage : "",
        type: typeof entry.type === "string" ? entry.type : "unknown",
        active: entry.active === 1 || entry.active === true,
        enabled: entry.enabled === 1 || entry.enabled === true,
        usedGiB: used !== null ? toFixedNum(bytesToGiB(used), 2) : null,
        totalGiB: total !== null ? toFixedNum(bytesToGiB(total), 2) : null,
        availGiB: avail !== null ? toFixedNum(bytesToGiB(avail), 2) : null,
        percent: toFixedNum(percent, 0),
      };
    });

    return { pools };
  } catch {
    return EMPTY_RESULT;
  }
}
