import type { Client } from "ssh2";
import { execCommand } from "../widgets/common-utils.js";

export interface ProxmoxClusterNodeEntry {
  name: string;
  online: boolean;
  local: boolean;
  ip: string | null;
}

export type ProxmoxClusterHealthResult =
  | { clustered: false }
  | {
      clustered: true;
      quorate: boolean;
      clusterName: string | null;
      nodes: ProxmoxClusterNodeEntry[];
    };

const EMPTY_RESULT: ProxmoxClusterHealthResult = { clustered: false };

export async function collectProxmoxClusterHealth(
  client: Client,
): Promise<ProxmoxClusterHealthResult> {
  try {
    const { stdout, code } = await execCommand(
      client,
      "pvesh get /cluster/status --output-format json",
      15000,
    );
    if (code !== 0) {
      return EMPTY_RESULT;
    }

    const data = JSON.parse(stdout);
    if (!Array.isArray(data)) {
      return EMPTY_RESULT;
    }

    const entries = data as Array<Record<string, unknown>>;
    const clusterEntry = entries.find((e) => e.type === "cluster");
    if (!clusterEntry) {
      return EMPTY_RESULT;
    }

    const nodes: ProxmoxClusterNodeEntry[] = entries
      .filter((e) => e.type === "node")
      .map((e) => ({
        name: typeof e.name === "string" ? e.name : "",
        online: e.online === 1 || e.online === true,
        local: e.local === 1 || e.local === true,
        ip: typeof e.ip === "string" && e.ip ? e.ip : null,
      }));

    return {
      clustered: true,
      quorate: clusterEntry.quorate === 1 || clusterEntry.quorate === true,
      clusterName:
        typeof clusterEntry.name === "string" && clusterEntry.name
          ? clusterEntry.name
          : null,
      nodes,
    };
  } catch {
    return EMPTY_RESULT;
  }
}
